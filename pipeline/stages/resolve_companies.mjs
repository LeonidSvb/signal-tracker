#!/usr/bin/env node
// Match passed_icp job-board raw_signals -> companies table, with the SAME real
// screening classify_company.mjs gives Exa/news signals (C1,
// docs/HANDOFF_2026-07-15_scoring_two_channel.md). The pre-merge version of this
// file only name-matched-or-stub-created — since filter_icp.mjs's hard size gate
// was removed 2026-07-15, hiring companies were reaching this stage with ZERO real
// screening ever. This rewrite adds the same Layer 0 (sourcing.companies free
// lookup) -> Layer 1 (Blitz real data, or Exa domain-resolve fallback) ->
// classifyCompany() -> Layer 2 (write-back to sourcing) cascade classify_company.mjs
// already runs for news signals, minus entity extraction (job-board rows already
// arrive WITH a company name and often a companyLinkedinUrl/employee count from the
// board itself — extractEntities would be redundant spend).
//
// Safety: defaults to DRY RUN (counts/plan only, zero spend beyond the initial
// selectAllSourcing lightweight-column pull). Pass --live to actually call
// Blitz/Exa/OpenRouter and write results. Pass --legacy to run the OLD
// name-match-or-stub-create behavior verbatim (kept for one release for
// before/after comparison, delete after).
//
// Run: node --env-file=nextjs/.env.local pipeline/stages/resolve_companies.mjs [--live] [--limit=N] [--legacy]

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { selectAll, insert, upsert, patch } from '../lib/supabase.mjs';
import { getClientId, startRun, finishRun } from '../lib/log.mjs';
import { getSourcingClientId, startSourcingRun, finishSourcingRun, selectAllSourcing, upsertSourcingCompany } from '../lib/sourcing.mjs';
import { resolveDomain, fetchAbout } from '../lib/exaFinder.mjs';
import { classifyCompany, blacklistHit } from '../lib/companyClassifier.mjs';
import { lookupByDomain, matchesTarget, blitzEmployees } from '../lib/blitzEnrich.mjs';
import { loadCache, saveCache } from '../lib/exaCache.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const LEGACY = args.includes('--legacy');
const limitArg = args.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
const CONCURRENCY = 5; // matches classify_company.mjs's convention

const CACHE_DOMAIN = join(__dir, '../../exa/cache/company_resolve_cache.json');
const CACHE_ABOUT  = join(__dir, '../../exa/cache/company_about_cache.json');
const CACHE_BLITZ  = join(__dir, '../../exa/cache/blitz_lookup_cache.json');
// Separate cache for LinkedIn-URL-direct Blitz lookups (job-board rows that already
// carry companyLinkedinUrl skip domain resolution entirely) — keyed independently
// from CACHE_BLITZ's domain keys so the two never collide.
const CACHE_BLITZ_BY_LI = join(__dir, '../../exa/cache/blitz_lookup_by_linkedin_url_cache.json');

// ── Blitz-by-linkedin_url (job-board rows already have the URL, no domain-to-linkedin
// hop needed — same /v2/enrichment/company endpoint blitzEnrich.mjs's lookupByDomain
// calls after ITS domain-to-linkedin step, kept local here rather than editing
// blitzEnrich.mjs, which is Fable's file per the WP1-3 Blitz-harvest handoff split). ──
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
loadEnvFile(join(__dir, '../../../../../blitz/.env'));
const BLITZ_KEY = process.env.BLITZ_API_KEY;

async function blitzPost(path, body) {
  const res = await fetch(`https://api.blitz-api.ai${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': BLITZ_KEY },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function lookupByLinkedinUrl(linkedinUrl, cache) {
  const key = linkedinUrl.toLowerCase();
  if (cache[key] !== undefined) return cache[key];
  if (!BLITZ_KEY) throw new Error('BLITZ_API_KEY not set');
  const enrich = await blitzPost('/v2/enrichment/company', { company_linkedin_url: linkedinUrl });
  if (!enrich?.found) { cache[key] = null; return null; }
  const c = enrich.company;
  const result = {
    linkedinUrl,
    linkedinCompanyName: c.name,
    industry: c.industry || null,
    size: c.size || null,
    employeesOnLinkedin: c.employees_on_linkedin || null,
    about: c.about || null,
    hqCountry: c.hq?.country_code || null,
  };
  cache[key] = result;
  return result;
}

// ── Name normalization (same as before / classify_company.mjs) ───────────────
const ACCENT_MAP = { é:'e',è:'e',ê:'e',ë:'e',à:'a',â:'a',ü:'u',ö:'o',ä:'a',ß:'ss',ç:'c',û:'u',î:'i',ï:'i',ô:'o',œ:'oe',æ:'ae',ø:'o',å:'a' };
function norm(s) { return String(s||'').toLowerCase().replace(/[éèêëàâüöäßçûîïôœæøå]/g,c=>ACCENT_MAP[c]||c).replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); }
const STRIP = /\b(gmbh|ag|sa|nv|bv|srl|ltd|inc|corp|llc|sas|snc|ohg|kg|og|se|plc|co|cie|group|gruppe|holding|services|international|deutschland|france)\b/g;
function coreName(s) { return norm(s).replace(STRIP,' ').replace(/\s+/g,' ').trim().split(' ').slice(0,3).join(' '); }
function fuzzyMatch(a, b) { const ca=coreName(a), cb=coreName(b); return !!(ca && cb && (ca===cb || ca.includes(cb) || cb.includes(ca))); }
function normDomain(d) { if (!d) return ''; return String(d).toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/.*$/,'').trim(); }

// ── LEGACY path — verbatim old behavior, kept for one release for comparison ──
async function runLegacy(clientId, runId) {
  const signals = await selectAll('raw_signals', { client_id: clientId, status: 'passed_icp' });
  console.log(`passed_icp signals: ${signals.length}`);

  const byName = new Map();
  for (const s of signals) {
    const name = s.company_name;
    if (!name) continue;
    const cur = byName.get(name) || { name, linkedin_url: null, country: null, employees: null };
    if (!cur.linkedin_url && s.raw_data?.companyLinkedinUrl) cur.linkedin_url = s.raw_data.companyLinkedinUrl;
    if (!cur.country && s.country) cur.country = s.country;
    if (!cur.employees && s.raw_data?.companyEmployeesCount) cur.employees = s.raw_data.companyEmployeesCount;
    byName.set(name, cur);
  }
  console.log(`unique company names: ${byName.size}`);

  const existing = await selectAll('companies', { client_id: clientId });
  console.log(`existing companies in DB: ${existing.length}`);

  const byLinkedIn = new Map(existing.filter(c => c.linkedin_url).map(c => [c.linkedin_url, c]));
  const toCreate = [];
  let matched = 0;
  for (const [name, info] of byName) {
    if (info.linkedin_url && byLinkedIn.has(info.linkedin_url)) { matched++; continue; }
    if (existing.some(c => norm(c.name) === norm(name))) { matched++; continue; }
    if (existing.some(c => fuzzyMatch(name, c.name))) { matched++; continue; }
    toCreate.push(info);
  }
  console.log(`matched: ${matched}  to create: ${toCreate.length}`);

  let pushed = 0;
  if (toCreate.length) {
    const existingNorms = new Set(existing.map(c => norm(c.name)));
    const fresh = toCreate.filter(r => !existingNorms.has(norm(r.name)));
    const withUrl = fresh.filter(r => r.linkedin_url).map(r => ({
      client_id: clientId, name: r.name, linkedin_url: r.linkedin_url,
      hq_country: r.country || null, employees: r.employees ? parseInt(r.employees) : null,
    }));
    const stubs = fresh.filter(r => !r.linkedin_url).map(r => ({
      client_id: clientId, name: r.name, hq_country: r.country || null,
      employees: r.employees ? parseInt(r.employees) : null,
    }));
    if (withUrl.length) { const ins = await upsert('companies', withUrl, 'client_id,linkedin_url'); pushed += ins.length; console.log(`upserted ${ins.length} companies with linkedin_url`); }
    if (stubs.length) { const ins = await insert('companies', stubs); pushed += ins.length; console.log(`created ${ins.length} stub companies (no linkedin_url)`); }
  }

  await finishRun(runId, { status: 'success', stats: { scraped: signals.length, pushed } });
  console.log('=== DONE (legacy) ===');
  return { matched, created: toCreate.length, pushed };
}

// ── New path ──────────────────────────────────────────────────────────────────
export async function run() {
  console.log(`\n=== resolve_companies.mjs === mode=${LEGACY ? 'LEGACY' : (LIVE ? 'LIVE (spends money)' : 'DRY RUN (no spend)')}`);

  const clientId = await getClientId(CLIENT_SLUG);
  // Dry runs must NOT write pipeline_runs rows — a dry run logged as 'success'
  // is exactly what made the 2026-07-15 run look like a real (broken) live pass.
  // finishRun() no-ops on a null runId, so gating startRun alone is sufficient.
  const runId = (LIVE || LEGACY) ? await startRun({ clientId, script: 'resolve_companies', source: LEGACY ? 'raw_signals_legacy' : 'raw_signals_job_boards' }) : null;

  if (LEGACY) return runLegacy(clientId, runId);

  let sourcingClientId = null, sourcingRunId = null;
  if (LIVE) {
    sourcingClientId = await getSourcingClientId(CLIENT_SLUG);
    sourcingRunId = await startSourcingRun(sourcingClientId, {
      run_type: 'resolve_companies_job_boards',
      run_tag: `resolve_jobs_${new Date().toISOString().slice(0, 19).replace(/[-:]/g, '')}`,
      config: { source: 'signal_monitoring.raw_signals (job boards)', mode: 'layer0_sourcing+layer1_blitz_or_exa_llm' },
    });
  }

  const domainCache = loadCache(CACHE_DOMAIN);
  const aboutCache  = loadCache(CACHE_ABOUT);
  const blitzCache  = loadCache(CACHE_BLITZ);
  const blitzLiCache = loadCache(CACHE_BLITZ_BY_LI);

  // Job-board rows only (source != 'exa') — the news path is classify_company.mjs's job.
  const allPassed = await selectAll('raw_signals', { client_id: clientId, status: 'passed_icp' });
  const rawSignals = allPassed.filter(s => s.source !== 'exa');
  console.log(`job-board passed_icp signals: ${rawSignals.length} (of ${allPassed.length} total passed_icp)`);

  const companies = await selectAll('companies', { client_id: clientId });
  const companyByDomain = new Map(companies.filter(c => c.domain).map(c => [normDomain(c.domain), c]));
  const companyByLinkedIn = new Map(companies.filter(c => c.linkedin_url).map(c => [c.linkedin_url, c]));
  const companyByCoreName = new Map(companies.map(c => [coreName(c.name), c]));

  console.log('[setup] fetching sourcing.companies (lightweight columns)...');
  const sourcing = LIVE ? await selectAllSourcing('companies', `client_id=eq.${sourcingClientId}&select=id,company_name,domain,icp_status,icp_reason,employees,hq_country,industry`) : [];
  const sourcingByDomain = new Map();
  const sourcingByCoreName = new Map();
  for (const c of sourcing) {
    const d = normDomain(c.domain);
    if (d) sourcingByDomain.set(d, c);
    const cn = coreName(c.company_name);
    if (cn && !sourcingByCoreName.has(cn)) sourcingByCoreName.set(cn, c);
  }
  console.log(`[setup] sourcing.companies loaded: ${sourcing.length}`);

  // Group raw_signals by unique company (linkedin_url first, else normalized name) —
  // job-board rows already carry a name and often companyLinkedinUrl/employees, so no
  // entity-extraction LLM call is needed (unlike classify_company.mjs's exa path).
  const byCompany = new Map(); // key -> { name, linkedinUrl, country, employees, signalIds }
  for (const s of rawSignals) {
    const name = s.company_name || s.raw_data?.company || s.raw_data?.companyName || null;
    if (!name) continue;
    const linkedinUrl = s.raw_data?.companyLinkedinUrl || null;
    const key = linkedinUrl || coreName(name);
    const cur = byCompany.get(key) || { name, linkedinUrl: null, country: null, employees: null, signalIds: [] };
    if (!cur.linkedinUrl && linkedinUrl) cur.linkedinUrl = linkedinUrl;
    if (!cur.country && s.country) cur.country = s.country;
    if (!cur.employees && s.raw_data?.companyEmployeesCount) cur.employees = s.raw_data.companyEmployeesCount;
    cur.signalIds.push(s.id);
    byCompany.set(key, cur);
  }
  console.log(`unique job-board companies: ${byCompany.size}`);

  const stats = {
    total: byCompany.size, blacklisted: 0,
    layer0Hit: 0, alreadyResolvedInCompanies: 0,
    layer1BlitzByLinkedin: 0, layer1BlitzByDomain: 0, layer1ExaLlm: 0, layer1Failed: 0,
    rejected: 0, needsWebsite: 0, pass: 0, classifyFailed: 0,
    errors: [],
  };

  const entries = [...byCompany.entries()].slice(0, LIMIT);

  async function resolveOne([, info]) {
    const { name, linkedinUrl, country } = info;
    const cn = coreName(name);

    if (blacklistHit(name)) {
      stats.blacklisted++;
      return { info, resolved: { cn, domain: null, icpStatus: 'reject', icpReason: 'Blacklisted company type (staffing/catering/executive-search)', via: 'blacklist' } };
    }

    // Already a companies row with a domain/linkedin_url we've fully resolved before —
    // no need to re-spend (companies table itself carries no icp_status, so "already
    // resolved" here just means we won't re-run Blitz/LLM against it again this run;
    // rank_leads.mjs's own ICP gate re-checks sourcing.icp_status every run regardless).
    const existingCompany = (linkedinUrl && companyByLinkedIn.get(linkedinUrl)) || companyByCoreName.get(cn);
    if (existingCompany?.domain || existingCompany?.linkedin_url) {
      stats.alreadyResolvedInCompanies++;
    }

    // Layer 0 — free sourcing.companies hit.
    const l0 = sourcingByCoreName.get(cn);
    if (l0) {
      stats.layer0Hit++;
      if (l0.icp_status && l0.icp_status !== 'unscored') {
        return {
          info, existingCompany,
          resolved: {
            cn, domain: l0.domain, employees: l0.employees, hqCountry: l0.hq_country, industry: l0.industry,
            icpStatus: l0.icp_status, icpReason: l0.icp_reason, via: 'layer0_sourcing',
          },
        };
      }
      // 'unscored' — still needs a real screen below, but we keep l0's domain as a head start.
    }

    if (!LIVE) {
      // Dry run stops here — we know whether this company is Layer-0-free or needs spend,
      // that's exactly what the manifest is for.
      return { info, existingCompany, resolved: null, wouldSpend: !l0 || l0.icp_status === 'unscored' };
    }

    // Layer 1 — Blitz-by-linkedin_url (job board gave us the URL directly, no domain hop
    // needed) else Blitz-by-domain (via Exa domain-resolve, same as classify_company.mjs).
    let evidence = { via: 'none' };
    let domain = l0?.domain || null;
    let blitzResult = null;

    if (linkedinUrl) {
      try {
        blitzResult = await lookupByLinkedinUrl(linkedinUrl, blitzLiCache);
      } catch (e) { stats.errors.push(`${name}: blitz-by-li ${e.message}`); }
      if (blitzResult && matchesTarget(blitzResult, name)) {
        stats.layer1BlitzByLinkedin++;
        evidence = { via: 'blitz', blitz: blitzResult };
        domain = domain || null; // Blitz-by-URL doesn't return a domain field
      } else {
        blitzResult = null;
      }
    }

    if (!blitzResult && !domain) {
      const dom = await resolveDomain(name, country, domainCache);
      if (dom.domain) domain = dom.domain;
    }

    if (!blitzResult && domain) {
      try {
        blitzResult = await lookupByDomain(domain, blitzCache);
      } catch (e) { stats.errors.push(`${name}: blitz-by-domain ${e.message}`); }
      if (blitzResult && matchesTarget(blitzResult, name)) {
        stats.layer1BlitzByDomain++;
        evidence = { via: 'blitz', blitz: blitzResult };
      } else {
        blitzResult = null;
      }
    }

    let aboutText = null, aboutTitle = null;
    if (!blitzResult) {
      if (domain) {
        const about = await fetchAbout(domain, name, aboutCache);
        aboutText = about.text; aboutTitle = about.title;
        stats.layer1ExaLlm++;
        evidence = { via: 'exa_about', aboutText, aboutTitle };
      } else {
        stats.layer1Failed++;
        evidence = { via: 'none' };
      }
    }

    const candidate = {
      name, role: null, domain,
      employees: blitzResult ? blitzEmployees(blitzResult) : null,
      hqCountry: blitzResult?.hqCountry || country,
      industry: blitzResult?.industry || null,
      companyLinkedinUrl: blitzResult?.linkedinUrl || linkedinUrl || null,
      about: blitzResult?.about || aboutText || null,
      evidence,
    };

    const cls = await classifyCompany({ headline: null, signalType: 'HIRING', country, pubDate: null, candidates: [candidate] });
    if (!cls) {
      stats.classifyFailed++;
      return { info, existingCompany, resolved: null };
    }
    if (cls.icpStatus === 'reject') stats.rejected++;
    else if (cls.icpStatus === 'needs_website') stats.needsWebsite++;
    else stats.pass++;

    return {
      info, existingCompany,
      resolved: {
        cn, domain: candidate.domain, employees: candidate.employees ?? cls.employeesEstimate ?? null,
        hqCountry: candidate.hqCountry, industry: candidate.industry,
        icpStatus: cls.icpStatus, icpReason: cls.icpReason, entityMismatch: cls.entityMismatch,
        companyLinkedinUrl: candidate.companyLinkedinUrl, about: candidate.about, via: evidence.via,
      },
    };
  }

  async function writeOne(result) {
    const { info, resolved } = result;
    if (!resolved) return;
    const cn = resolved.cn;

    // Layer 2 — permanent write-back to sourcing (skip if this run reused an
    // already-scored Layer-0 hit — nothing new learned, don't touch icp_status).
    if (resolved.via !== 'layer0_sourcing') {
      const freshHit = sourcingByCoreName.get(cn);
      if (!freshHit) {
        const row = await upsertSourcingCompany({
          client_id: sourcingClientId, domain: resolved.domain || null, company_name: info.name,
          company_linkedin_url: resolved.companyLinkedinUrl || null, hq_country: resolved.hqCountry || null,
          employees: resolved.employees || null, industry: resolved.industry || null, about: resolved.about || null,
          icp_status: resolved.icpStatus, icp_reason: resolved.icpReason,
          icp_scored_run_id: resolved.via !== 'blacklist' ? sourcingRunId : null,
          first_seen_via: 'signal_monitoring_jobs',
        });
        if (resolved.domain) sourcingByDomain.set(normDomain(resolved.domain), row);
        sourcingByCoreName.set(cn, row);
      }
    }

    // signal_monitoring.companies row (same create/update behavior as before).
    let companyRow = resolved.domain ? companyByDomain.get(normDomain(resolved.domain)) : companyByCoreName.get(cn);
    if (!companyRow && info.linkedinUrl) companyRow = companyByLinkedIn.get(info.linkedinUrl);

    if (!companyRow) {
      const [created] = await insert('companies', [{
        client_id: clientId, name: info.name, domain: resolved.domain || null,
        linkedin_url: resolved.companyLinkedinUrl || info.linkedinUrl || null,
        hq_country: resolved.hqCountry || info.country || null,
        employees: resolved.employees || (info.employees ? parseInt(info.employees) : null),
        about: resolved.about || null,
      }]);
      companyRow = created;
    } else {
      const patchData = {};
      if (!companyRow.domain && resolved.domain) patchData.domain = resolved.domain;
      if (!companyRow.employees && resolved.employees) patchData.employees = resolved.employees;
      if (!companyRow.about && resolved.about) patchData.about = resolved.about;
      if (Object.keys(patchData).length) await patch('companies', 'id', [companyRow.id], patchData);
    }

    if (companyRow) {
      if (companyRow.domain) companyByDomain.set(normDomain(companyRow.domain), companyRow);
      if (companyRow.linkedin_url) companyByLinkedIn.set(companyRow.linkedin_url, companyRow);
      companyByCoreName.set(cn, companyRow);
    }
  }

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    const analyzed = await Promise.allSettled(batch.map(resolveOne));

    for (const outcome of analyzed) {
      if (outcome.status === 'rejected') {
        stats.errors.push(String(outcome.reason?.message || outcome.reason));
        continue;
      }
      if (LIVE) {
        try { await writeOne(outcome.value); }
        catch (e) { stats.errors.push(`${outcome.value.info.name}: ${e.message}`); }
      }
    }
    if (LIVE) { saveCache(CACHE_DOMAIN, domainCache); saveCache(CACHE_ABOUT, aboutCache); saveCache(CACHE_BLITZ, blitzCache); saveCache(CACHE_BLITZ_BY_LI, blitzLiCache); }
    process.stdout.write(`\r  ${Math.min(i + CONCURRENCY, entries.length)}/${entries.length} processed`);
  }
  if (entries.length) console.log('');

  const wouldSpendCount = entries.filter(([, info]) => {
    const cn = coreName(info.name);
    const l0 = sourcingByCoreName.get(cn);
    return !blacklistHit(info.name) && (!l0 || l0.icp_status === 'unscored');
  }).length;

  console.log('\n=== STATS ===');
  console.log(JSON.stringify(stats, null, 2));
  if (!LIVE) {
    console.log(`\nWould spend Blitz/Exa/LLM calls on ~${wouldSpendCount} of ${entries.length} companies (rest are free Layer-0 sourcing hits or blacklisted). Re-run with --live after Leo says "запускай".`);
  }

  if (LIVE) {
    saveCache(CACHE_DOMAIN, domainCache); saveCache(CACHE_ABOUT, aboutCache); saveCache(CACHE_BLITZ, blitzCache); saveCache(CACHE_BLITZ_BY_LI, blitzLiCache);
    await finishSourcingRun(sourcingRunId, { status: stats.errors.length ? 'partial' : 'success', results: stats });
  }

  await finishRun(runId, { status: stats.errors.length ? 'partial' : 'success', stats: { scraped: stats.total, pushed: stats.pass + stats.needsWebsite }, errors: stats.errors });
  console.log('=== DONE ===');
  return stats;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error(e); process.exit(1); });
}
