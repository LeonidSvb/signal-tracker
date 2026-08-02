#!/usr/bin/env node
// Backfill companies.linkedin_url via Exa company-page search, for companies Blitz's own
// domain->LinkedIn match missed. Built 2026-07-31 after a live spot-check: 7/7 real companies
// (Findus Switzerland, SARIA France, Maïsadour, Nexira, Upside Foods, Vitamin Well Group,
// Agristo) had a real LinkedIn page findable on the first Exa query, none had linkedin_url set.
// Without this, those companies never become find_contacts_exa gap-mode candidates (that stage
// requires linkedin_url) — a closed loop that never self-heals on its own.
//
// Safety: defaults to DRY RUN (lists target companies, zero spend). Pass --live to call Exa
// and write linkedin_url. Per project rule, only run --live after Leo says "запускай".
// --limit=N caps how many companies get processed, in insertion order.
//
// Run: node --env-file=nextjs/.env.local pipeline/stages/resolve_linkedin.mjs --live --limit=15

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { selectAll, patch } from '../lib/supabase.mjs';
import { getClientId, startRun, finishRun } from '../lib/log.mjs';
import { getSourcingClientId, selectAllSourcing } from '../lib/sourcing.mjs';
import { resolveCompanyLinkedin } from '../lib/exaFinder.mjs';
import { loadCache, saveCache } from '../lib/exaCache.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';
const CONCURRENCY = 5; // same convention as find_contacts_exa.mjs / classify_company.mjs

const CACHE_LI = join(__dir, '../../exa/cache/company_linkedin_resolve_cache.json');
const liCache = loadCache(CACHE_LI);

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const limitArg = args.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) {
      const k = line.slice(0, i).trim();
      if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
    }
  }
}
loadEnvFile(join(__dir, '../../../../../.env'));

function normDomain(d) { if (!d) return ''; return String(d).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim(); }

export async function run() {
  console.log(`\n=== resolve_linkedin.mjs === mode=${LIVE ? 'LIVE (spends money)' : 'DRY RUN (no spend)'}`);

  const clientId = await getClientId(CLIENT_SLUG);
  const runId = LIVE ? await startRun({ clientId, script: 'resolve_linkedin', source: 'exa' }) : null;

  const companies = await selectAll('companies', { client_id: clientId }, { timeoutMs: 120_000 });

  // Candidates: real domain known, LinkedIn company page not. Companies with no domain at all
  // aren't in scope here — that's a resolve_companies/classify_company problem, not this stage's.
  const candidates = companies.filter(c => c.domain && !c.linkedin_url);

  // Same free pre-filter as find_contacts_exa.mjs — never spend Exa credits resolving LinkedIn
  // for a company sourcing already knows is a reject.
  const sourcingClientId = await getSourcingClientId(CLIENT_SLUG);
  const sourcing = await selectAllSourcing('companies', `client_id=eq.${sourcingClientId}&select=domain,icp_status`);
  const statusByDomain = new Map();
  for (const s of sourcing) { const d = normDomain(s.domain); if (d && !statusByDomain.has(d)) statusByDomain.set(d, s.icp_status); }

  const skippedReject = [];
  const targets = [];
  for (const c of candidates) {
    const status = statusByDomain.get(normDomain(c.domain));
    if (status === 'reject') { skippedReject.push(c.name); continue; }
    targets.push(c);
    if (targets.length >= LIMIT) break;
  }

  console.log(`candidates (domain known, linkedin_url missing): ${candidates.length}`);
  console.log(`skipped as icp reject: ${skippedReject.length}`);
  console.log(`targets: ${targets.length}${LIMIT < Infinity ? ` (capped at --limit=${LIMIT})` : ''}`);

  if (!LIVE) {
    console.log(targets.slice(0, 20).map(c => c.name));
    await finishRun(runId, { status: 'success', stats: { scraped: targets.length, pushed: 0 } });
    return { targets: targets.length, dryRun: true };
  }

  const stats = { companies: targets.length, resolved: 0, noMatch: 0, errors: [] };

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(c => resolveCompanyLinkedin(c.name, c.domain, liCache)));

    for (let j = 0; j < batch.length; j++) {
      const c = batch[j];
      const outcome = results[j];
      if (outcome.status === 'rejected') {
        stats.errors.push(`${c.name}: ${outcome.reason?.message || outcome.reason}`);
        continue;
      }
      const { linkedinUrl } = outcome.value;
      if (!linkedinUrl) { stats.noMatch++; continue; }
      try {
        await patch('companies', 'id', [c.id], { linkedin_url: linkedinUrl });
        stats.resolved++;
      } catch (e) {
        stats.errors.push(`${c.name} (patch): ${e.message}`);
      }
    }
    saveCache(CACHE_LI, liCache);
    process.stdout.write(`\r  ${Math.min(i + CONCURRENCY, targets.length)}/${targets.length} companies done`);
  }
  console.log('');

  console.log('\n=== STATS ===');
  console.log(JSON.stringify(stats, null, 2));
  await finishRun(runId, {
    status: stats.errors.length ? 'partial' : 'success',
    stats: { scraped: targets.length, pushed: stats.resolved },
    errors: stats.errors,
  });
  console.log('=== DONE ===');
  return stats;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error(e); process.exit(1); });
}
