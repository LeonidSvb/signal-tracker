#!/usr/bin/env node
// Exa People Search fallback for companies where Blitz's waterfall-icp-keyword cascade
// (find_contacts.mjs) found ZERO people at all — not a replacement for Blitz, a second attempt
// for its blind spots. Recipe validated 2026-06-29 (exa/test_finder.cjs, 14/14 companies found
// execs — see exa/results/exa_finder_summary_2026-06-29.json): category:'linkedin profile'
// search, 3 seniority tiers (exec / plant-ops / HR). Cost ~$0.007/search call (Exa's documented
// $7/1k) + optional $0.001/call for the short text snippet used to derive a title.
//
// After finding a LinkedIn profile, tries Blitz's /v2/enrichment/email on it — validated
// 2026-06-29 (exa/results/blitz_email_test_2026-06-29.json) that Blitz can sometimes resolve an
// email for a person Exa found that Blitz's OWN search never surfaced.
//
// Safety: defaults to DRY RUN (lists target companies, zero spend). Pass --live to call Exa/
// Blitz and write contacts. Per project rule, only run --live after Leo says "запускай".
// --limit=N caps how many companies get processed, in insertion order — use it for the small
// test batch before scaling to the full backlog.
//
// --mode=gap (default) — companies with ZERO contacts at all (the original Q9/Q12(a) target).
// --mode=email_gap — companies that already have 1+ contact but NONE has an email. Seeds the
//   dedup set with already-known linkedin_urls (never re-adds the same person) and searches for
//   a small top-up (EMAIL_GAP_TOPUP new people) specifically hunting for a usable email, on top
//   of whatever's already there — not the same as the zero-contact cap, which caps the total.
//
// Run: node --env-file=nextjs/.env.local pipeline/stages/find_contacts_exa.mjs --live --limit=15

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { selectAll, insert } from '../lib/supabase.mjs';
import { getClientId, startRun, finishRun } from '../lib/log.mjs';
import { getSourcingClientId, selectAllSourcing } from '../lib/sourcing.mjs';
import { fetchRetry } from '../lib/httpRetry.mjs';
import { loadCache, saveCache } from '../lib/exaCache.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';
const CONCURRENCY = 5; // matches classify_company.mjs's convention for multi-call-per-item stages
// Same cap as find_contacts.mjs, same reasoning — data 2026-07-15 showed capping at 3 loses
// only 6pp of email-hit-rate vs uncapped (57% vs 63%) while cutting Exa spend on companies that
// would otherwise pull a contact from every tier separately.
const MAX_CONTACTS_PER_COMPANY = 3;

// Cache every Exa search / Blitz email lookup by exact request key — insurance against exactly
// what happened 2026-07-15: a schema bug on insert discarded 15 companies' worth of already-paid
// Exa+Blitz results. A rerun after a crash/bug now costs nothing for anything already fetched.
const CACHE_SEARCH = join(__dir, '../../exa/cache/people_search_cache.json');
const CACHE_EMAIL  = join(__dir, '../../exa/cache/people_email_cache.json');
const searchCache = loadCache(CACHE_SEARCH);
const emailCache  = loadCache(CACHE_EMAIL);

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const limitArg = args.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
const modeArg = args.find(a => a.startsWith('--mode='));
const MODE = modeArg ? modeArg.split('=')[1] : 'gap'; // 'gap' | 'email_gap'
const EMAIL_GAP_TOPUP = 2; // small top-up budget when hunting for just one usable email

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
loadEnvFile(join(__dir, '../../../../../blitz/.env'));

const EXA_KEY = process.env.EXA_API_KEY;
const BLITZ_KEY = process.env.BLITZ_API_KEY;

async function exaSearch(query) {
  if (searchCache[query] !== undefined) return searchCache[query];
  const res = await fetchRetry('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': EXA_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query, numResults: 5, category: 'linkedin profile',
      contents: { text: { maxCharacters: 250 } },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`[exa] search ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  const result = (json.results || []).map(r => ({ url: r.url, title: r.title, text: r.text || '' }));
  searchCache[query] = result;
  return result;
}

async function blitzEmail(personLinkedinUrl) {
  if (emailCache[personLinkedinUrl] !== undefined) return emailCache[personLinkedinUrl];
  const res = await fetchRetry('https://api.blitz-api.ai/v2/enrichment/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': BLITZ_KEY },
    body: JSON.stringify({ person_linkedin_url: personLinkedinUrl }),
  });
  const data = await res.json();
  const email = data?.found ? data.email : null;
  emailCache[personLinkedinUrl] = email;
  return email;
}

// Same 3-tier recipe as the validated 2026-06-29 test — exec / plant-ops / HR decision makers,
// the same title universe find_contacts.mjs's Blitz cascade targets.
function tiersFor(companyName) {
  return [
    { tier: 'exec', query: `${companyName} CEO OR "Managing Director" OR "Directeur Général" OR "Geschäftsführer" site:linkedin.com/in` },
    { tier: 'ops', query: `${companyName} "Plant Director" OR "Werksleiter" OR "Directeur Usine" OR "Operations Director" site:linkedin.com/in` },
    { tier: 'hr', query: `${companyName} "HR Director" OR "DRH" OR "Personalleiter" OR "HRD" site:linkedin.com/in` },
  ];
}

function normalizeLinkedinUrl(url) { return url.replace(/^http:\/\//, 'https://').replace(/\/$/, ''); }
function normDomain(d) { if (!d) return ''; return String(d).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim(); }

const ACCENT_MAP = { é:'e',è:'e',ê:'e',ë:'e',à:'a',â:'a',ü:'u',ö:'o',ä:'a',ß:'ss',ç:'c',û:'u',î:'i',ï:'i',ô:'o',œ:'oe',æ:'ae',ø:'o',å:'a' };
function norm(s) { return String(s||'').toLowerCase().replace(/[éèêëàâüöäßçûîïôœæøå]/g,c=>ACCENT_MAP[c]||c).replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); }

// `.title` is almost always just the person's name (rarely "Name | CEO"). The real current
// title/headline lives in `.text`, right after the markdown "# Name" heading — found live
// 2026-07-15 auditing a first test batch: naive `.title` parsing left title=null for the vast
// majority of results (only caught the rare "Name | Title" case), throwing away data that was
// sitting right there in the text snippet the whole time.
function parseNameTitle(result) {
  const full_name = String(result.title || '').split(/\s+-\s+|\s*\|\s*/)[0].trim() || null;
  const segments = String(result.text || '').split('\n\n').map(s => s.trim()).filter(Boolean);
  let title = segments[1] || null; // segments[0] = "# Name" heading
  if (title && /^#/.test(title)) title = null;
  return { full_name, title };
}

// Exa's search is keyword text-matching, not entity resolution — a short/generic company name
// (Acomo, Fage) collides with unrelated people whose NAME happens to contain that string, or
// with a different company that happens to share the name. Found live 2026-07-15: "Acomo CEO"
// matched a Ugandan school founder named "Acomo Alice" (the company word only ever appears as
// part of her own name, never in her actual headline). Heuristic filter: keep a result only if
// the company's core name actually appears in the person's HEADLINE (text segment 1), not just
// somewhere in the full profile blob — cuts the clearest false positives for ~free. Does not
// catch same-name-different-company collisions (a "Fage limited" car dealership in Kenya vs the
// Greek dairy Fage both legitimately have "Fage" in their headline) — that residual noise still
// needs a human glance at the shortlist before outreach, same as every other source here.
function mentionsCompany(result, companyName) {
  const needle = norm(companyName).split(' ')[0];
  if (!needle || needle.length < 3) return true; // name too generic/short to filter on safely
  const segments = String(result.text || '').split('\n\n').map(s => s.trim()).filter(Boolean);
  const headline = norm(segments[1] || '');
  return headline.includes(needle);
}

async function processCompany(company, existingLinkedinUrls = []) {
  const seen = new Set(existingLinkedinUrls.map(normalizeLinkedinUrl));
  const rows = [];
  let filteredOut = 0;
  const cap = MODE === 'email_gap' ? EMAIL_GAP_TOPUP : MAX_CONTACTS_PER_COMPANY;
  for (const { tier, query } of tiersFor(company.name)) {
    // Cap at MAX_CONTACTS_PER_COMPANY (see find_contacts.mjs for the data behind this number) —
    // skip remaining tiers entirely once reached, saving their Exa search cost too, not just
    // the Blitz email lookups. In email_gap mode the cap is a small top-up budget instead
    // (existing contacts already cover the seniority, we're only hunting for one email).
    if (rows.length >= cap) break;
    const results = await exaSearch(query);
    for (const r of results) {
      if (rows.length >= cap) break;
      const url = normalizeLinkedinUrl(r.url);
      if (seen.has(url)) continue;
      seen.add(url);
      if (!mentionsCompany(r, company.name)) { filteredOut++; continue; }
      const { full_name, title } = parseNameTitle(r);
      const email = await blitzEmail(url).catch(() => null);
      // contacts table has no `tier` column (checked live schema 2026-07-15 after a failed
      // insert) — fold it into `source` instead, matches the only text field available.
      rows.push({
        company_id: company.id, full_name, title, linkedin_url: url,
        email: email || null, email_status: email ? 'inferred' : 'pending',
        is_primary: rows.length === 0, source: `exa_${tier}`,
      });
    }
  }
  return { rows, filteredOut };
}

export async function run() {
  console.log(`\n=== find_contacts_exa.mjs === mode=${LIVE ? 'LIVE (spends money)' : 'DRY RUN (no spend)'}`);
  if (LIVE && (!EXA_KEY || !BLITZ_KEY)) throw new Error('EXA_API_KEY or BLITZ_API_KEY not set');

  const clientId = await getClientId(CLIENT_SLUG);
  const runId = await startRun({ clientId, script: 'find_contacts_exa', source: 'exa' });

  const [companies, contacts, signals] = await Promise.all([
    selectAll('companies', { client_id: clientId }),
    selectAll('contacts', { client_id: clientId }),
    selectAll('signals', { client_id: clientId, source: 'exa' }),
  ]);
  const exaCompanyIds = new Set(signals.filter(s => s.company_id).map(s => s.company_id));
  const contactsByCompany = new Map();
  for (const c of contacts) { if (!contactsByCompany.has(c.company_id)) contactsByCompany.set(c.company_id, []); contactsByCompany.get(c.company_id).push(c); }

  // Three gaps this stage covers (Q9/Q12(a), Q12(b), Q12(c) in signals/TODO.txt):
  //   gap             — exa-signal companies with a real company linkedin_url but ZERO contacts.
  //   no_linkedin_gap — companies where Blitz never resolved a company linkedin_url at all (so
  //                     find_contacts.mjs's cascade never even ran) — the person-search query
  //                     only ever used company.name as text, never linkedin_url, so this works
  //                     the same way, just without the extra confidence a confirmed company page
  //                     gives. Q12(b) research question: does Exa recover companies Blitz missed?
  //   email_gap       — companies that already have 1+ contact but none has an email; existing
  //                     contacts' linkedin_urls seed the dedup set so this never re-adds someone
  //                     already known, just tops up a couple more hoping one has an email.
  const candidates = companies.filter(c => {
    if (!exaCompanyIds.has(c.id)) return false;
    const existing = contactsByCompany.get(c.id) || [];
    if (MODE === 'email_gap') return c.linkedin_url && existing.length > 0 && !existing.some(x => x.email);
    if (MODE === 'no_linkedin_gap') return !c.linkedin_url && existing.length === 0;
    return c.linkedin_url && existing.length === 0;
  });

  // icp_status doesn't live on signal_monitoring.companies (see classify_company.mjs's note) —
  // cross-reference sourcing.companies by domain so this stage never spends Exa credits on a
  // company already known 'reject' (found live 2026-07-15: 48 of the first 84 candidates were
  // reject, 34 pass, 2 needs_website — spending on all 84 blind would have wasted ~57% of the
  // budget on companies Philippe will never pursue). Run reclassify_via_blitz.mjs first if
  // sourcing verdicts might be stale — this stage trusts whatever's there, doesn't recompute it.
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

  console.log(`mode: ${MODE}`);
  console.log(`candidates: ${candidates.length}`);
  console.log(`skipped as icp reject: ${skippedReject.length}`);
  console.log(`targets after reject-filter: ${targets.length}${LIMIT < Infinity ? ` (capped at --limit=${LIMIT})` : ''}`);
  if (!LIVE) {
    console.log(targets.slice(0, 20).map(c => c.name));
    await finishRun(runId, { status: 'success', stats: { scraped: targets.length, pushed: 0 } });
    return { targets: targets.length, dryRun: true };
  }

  const stats = { companies: targets.length, companiesWithHit: 0, contactsFound: 0, withEmail: 0, withTitle: 0, filteredOutNoise: 0, errors: [] };

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(c =>
      processCompany(c, MODE === 'email_gap' ? (contactsByCompany.get(c.id) || []).map(x => x.linkedin_url).filter(Boolean) : [])
    ));
    for (let j = 0; j < batch.length; j++) {
      const outcome = results[j];
      if (outcome.status === 'rejected') {
        stats.errors.push(`${batch[j].name}: ${outcome.reason?.message || outcome.reason}`);
        continue;
      }
      const { rows, filteredOut } = outcome.value;
      stats.filteredOutNoise += filteredOut;
      if (!rows.length) continue;
      stats.companiesWithHit++;
      stats.contactsFound += rows.length;
      stats.withEmail += rows.filter(r => r.email).length;
      stats.withTitle += rows.filter(r => r.title).length;
      // In email_gap mode the company already has a primary contact — these are top-ups only.
      const insertRows = rows.map(r => ({ client_id: clientId, ...r, is_primary: MODE === 'email_gap' ? false : r.is_primary }));
      try {
        await insert('contacts', insertRows);
      } catch (e) {
        stats.errors.push(`${batch[j].name} (insert): ${e.message}`);
      }
    }
    saveCache(CACHE_SEARCH, searchCache);
    saveCache(CACHE_EMAIL, emailCache);
    process.stdout.write(`\r  ${Math.min(i + CONCURRENCY, targets.length)}/${targets.length} companies done`);
  }
  console.log('');

  console.log('\n=== STATS ===');
  console.log(JSON.stringify(stats, null, 2));
  await finishRun(runId, {
    status: stats.errors.length ? 'partial' : 'success',
    stats: { scraped: targets.length, pushed: stats.contactsFound },
    errors: stats.errors,
  });
  console.log('=== DONE ===');
  return stats;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error(e); process.exit(1); });
}
