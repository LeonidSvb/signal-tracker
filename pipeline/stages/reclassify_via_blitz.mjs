// Re-classify every domain-resolved sourcing.companies row using Blitz's real LinkedIn data as
// the evidence — replaces the earlier verify_via_blitz.mjs, which only annotated disagreements
// without applying them. Applies the new verdict WHENEVER Blitz's own reported company name
// matches the target we were looking for (nameSimilar check in blitzEnrich.mjs) — that gate is
// what makes auto-applying safe: it's what caught "OSI" -> osi.af.mil (US Air Force, name
// mismatch, correctly skipped) after the first, unguarded version of this script nearly
// overwrote a correct reject with Blitz's real-but-irrelevant employee count for the wrong entity.
//
// 2026-07-15 (Q1 merge): the verdict now comes from companyClassifier.mjs classifyCompany()
// (one LLM call per company, Blitz profile as evidence) instead of the old deterministicClassify
// hard employee-count cutoff — per Leo's "no hard numeric cutoffs, AI judges always, permissive
// when uncertain" direction. The Grolsch case (size "501-1000" but employees_on_linkedin 37,
// auto-rejected by the old numeric rule) is exactly what this fixes. So this script now spends
// OpenRouter (gpt-oss-120b, fractions of a cent per company) on top of Blitz.
//
// Concurrency: Blitz's real documented rate limit is 50 req/sec (docs/blitz-api/blitz-api-test-
// results.md) — CONCURRENCY=20 here (2 sequential Blitz calls + 1 LLM call per company) stays
// well under that with margin.
//
// Safety: defaults to DRY RUN. Pass --live to call Blitz and write updates.
// Run: node --env-file=nextjs/.env.local pipeline/stages/reclassify_via_blitz.mjs [--live] [--limit=N]

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { selectAllSourcing } from '../lib/sourcing.mjs';
import { lookupByDomain, matchesTarget, blitzEmployees } from '../lib/blitzEnrich.mjs';
import { classifyCompany, blacklistHit } from '../lib/companyClassifier.mjs';
import { loadCache, saveCache } from '../lib/exaCache.mjs';
import { fetchRetry } from '../lib/httpRetry.mjs';

const __dir = fileURLToPath(new URL('.', import.meta.url));
const CLIENT_ID_SOURCING = '9420de17-8a6f-4995-acb6-f80b678b157f';
const CACHE_BLITZ = join(__dir, '../../exa/cache/blitz_lookup_cache.json');
const CONCURRENCY = 20;

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const limitArg = args.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

const URL_BASE = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'Content-Profile': 'sourcing', 'Accept-Profile': 'sourcing' };
async function updateSourcingCompany(id, patch) {
  const res = await fetchRetry(`${URL_BASE}/rest/v1/companies?id=eq.${id}`, {
    method: 'PATCH', headers: { ...HEADERS, Prefer: 'return=minimal' }, body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`update ${id} -> ${res.status}: ${await res.text()}`);
}

export async function run() {
  console.log(`\n=== reclassify_via_blitz.mjs === mode=${LIVE ? 'LIVE' : 'DRY RUN'}`);

  const rows = await selectAllSourcing('companies', `client_id=eq.${CLIENT_ID_SOURCING}&first_seen_via=eq.signal_monitoring_exa&domain=not.is.null&select=id,company_name,domain,icp_status,icp_reason`);
  console.log(`companies to reclassify: ${rows.length}`);

  const blitzCache = loadCache(CACHE_BLITZ);
  const eligible = rows.slice(0, LIMIT);

  const stats = {
    total: 0, blitzFound: 0, blitzNotFound: 0, nameMismatch: 0,
    appliedPass: 0, appliedReject: 0, appliedNeedsWebsite: 0,
    statusChanged: 0, statusUnchanged: 0, errors: [],
  };
  const changes = [];
  const mismatches = [];
  let processed = 0;

  for (let i = 0; i < eligible.length; i += CONCURRENCY) {
    const batch = eligible.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(async r => {
      if (!LIVE) return { r, blitz: null, cls: null };
      const blitz = await lookupByDomain(r.domain, blitzCache);
      if (!blitz || !matchesTarget(blitz, r.company_name)) return { r, blitz, cls: null };
      const bl = blacklistHit(r.company_name);
      const cls = bl
        ? { icpStatus: 'reject', icpReason: `Blacklisted company type (staffing/catering/executive-search) — matched "${bl}"` }
        : await classifyCompany({ candidates: [{ name: r.company_name, role: null, domain: r.domain, evidence: { via: 'blitz', blitz } }] });
      return { r, blitz, cls };
    }));

    for (const outcome of results) {
      processed++;
      stats.total++;
      if (outcome.status === 'rejected') {
        stats.errors.push(outcome.reason?.message || String(outcome.reason));
        continue;
      }
      const { r, blitz, cls } = outcome.value;
      if (!LIVE) continue;

      if (!blitz) { stats.blitzNotFound++; continue; }
      stats.blitzFound++;

      if (!matchesTarget(blitz, r.company_name)) {
        stats.nameMismatch++;
        mismatches.push({ name: r.company_name, domain: r.domain, blitzName: blitz.linkedinCompanyName });
        continue; // don't trust data from a domain that resolved to a different entity
      }

      if (!cls) { stats.errors.push(`${r.company_name}: classifyCompany returned null (LLM failure)`); continue; }
      if (cls.icpStatus === 'pass') stats.appliedPass++;
      else if (cls.icpStatus === 'reject') stats.appliedReject++;
      else stats.appliedNeedsWebsite++;

      if (cls.icpStatus !== r.icp_status) {
        stats.statusChanged++;
        changes.push({ name: r.company_name, domain: r.domain, from: r.icp_status, to: cls.icpStatus, reason: cls.icpReason });
      } else {
        stats.statusUnchanged++;
      }

      try {
        await updateSourcingCompany(r.id, {
          icp_status: cls.icpStatus,
          icp_reason: cls.icpReason,
          employees: blitzEmployees(blitz),
          employee_bucket: blitz.size,
          industry: blitz.industry || undefined,
          company_linkedin_url: blitz.linkedinUrl,
        });
      } catch (e) {
        stats.errors.push(`${r.company_name}: ${e.message}`);
      }
    }

    if (LIVE) saveCache(CACHE_BLITZ, blitzCache);
    process.stdout.write(`\r  ${Math.min(i + CONCURRENCY, eligible.length)}/${eligible.length}`);
  }
  console.log('');

  console.log('\n=== STATS ===');
  console.log(JSON.stringify(stats, null, 2));
  if (changes.length) {
    console.log('\n=== STATUS CHANGES (applied — Blitz name-matched, real data used) ===');
    for (const c of changes) console.log(`  ${c.name} (${c.domain}): ${c.from} -> ${c.to}  [${c.reason}]`);
  }
  if (mismatches.length) {
    console.log('\n=== NAME MISMATCHES (domain likely wrong — status NOT touched) ===');
    for (const m of mismatches) console.log(`  "${m.name}" (${m.domain}) -> Blitz found "${m.blitzName}" instead — skipped`);
  }
  return stats;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error(e); process.exit(1); });
}
