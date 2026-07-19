#!/usr/bin/env node
// rank_leads.mjs (B2, docs/HANDOFF_2026-07-15_scoring_two_channel.md) — the scoring
// stage that replaces the planned 06_recalc_scores. Runs daily (light) + weekly (full),
// last in the pipeline. Per client:
//   1. expire pass — active signals past their per-type staleness window → stale
//      (windows from pipeline/config/icp_filter.json via lib/staleness.mjs; also
//      recomputes expires_at, the F4 backfill — the old calcExpires hardcoded 30d).
//   2. event grouping per company (A1) — union-find over same-source_url +
//      same-norm-title, then Q6-style clusters (7-day window, NO text pre-filter —
//      the Jaccard>=0.3 gate was dropped 2026-07-17: it silently skipped
//      semantically-same headlines with too little word overlap, e.g. DMK's
//      "invests €25m in lactoferrin production" vs "invests in German dairy
//      plant" never even reached the LLM. Leo's call: accuracy over OpenRouter
//      cost, cents either way — every same-company pair inside the date window
//      now becomes a cluster candidate) each confirmed by ONE sameEvent() LLM
//      call, cache-first (exa/cache/same_event_cache.json, keyed by sorted
//      member signal ids).
//   3. event classification (A2 class table via lib/eventClass.mjs; HIRING splits
//      into EXEC/MID/STALE per posting band + age, 2+ open postings = HIRING_SURGE).
//   3b. event_summary (D3 in docs/adr/009-frontend-v2-concept.md, Q2 in
//      docs/PLAN_2026-07-19_react_migration_prep.md §0) — eager, cache-first
//      (exa/cache/event_summary_cache.json, keyed by sorted member ids), one
//      summarizeEvent() LLM call per event with >=2 unique source_urls that
//      doesn't already have an up-to-date summary. Single-source events and
//      already-summarized-and-unchanged events never reach the LLM.
//   4. ICP gate — sourcing.companies by domain: reject → tier NULL 'icp_reject';
//      unscored/needs_website/missing → tier NULL 'needs_screen'; only pass is tiered.
//   5. tier + rank per A2 → companies.tier/rank/tier_reason/ranked_at,
//      signals.event_key, signals.event_summary (migration 005/007 columns —
//      both live as of 2026-07-19).
//
// Modes:
//   (default)  DRY RUN — zero writes, zero LLM. Q6 clusters + event_summary use
//              CACHED verdicts only; uncached ones stay pending_llm.
//   --llm      dry run + sameEvent()/summarizeEvent() LLM calls for uncached
//              items (OpenRouter = paid → needs Leo's "запускай", cents-scale).
//   --live     everything: LLM + DB writes.
//
// Run from signals/: node --env-file=nextjs/.env.local pipeline/stages/rank_leads.mjs [--llm] [--live]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { selectAll, patch } from '../lib/supabase.mjs';
import { getClientId, startRun, finishRun } from '../lib/log.mjs';
import { getSourcingClientId, selectAllSourcing } from '../lib/sourcing.mjs';
import { expiresAt, isStale } from '../lib/staleness.mjs';
import {
  buildInitialGroups, findCandidateClusters, applySameEventGroups,
  finalizeEvents, classifyEvent, tierCompany,
  uniqueSourceCount, needsEventSummary,
} from '../lib/eventGrouping.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const LLM = LIVE || args.includes('--llm');

const RUN_DIR = join(__dir, `../runs/rank_leads_${new Date().toISOString().slice(0, 10)}`);
const CACHE_PATH = join(__dir, '../../exa/cache/same_event_cache.json');
const SUMMARY_CACHE_PATH = join(__dir, '../../exa/cache/event_summary_cache.json');

const normDomain = d => String(d || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim() || null;

function loadCache(path) {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}; } catch { return {}; }
}

function writeCheckpoint(state) {
  writeFileSync(join(RUN_DIR, 'checkpoint.json'), JSON.stringify({ ...state, at: new Date().toISOString() }, null, 2));
}

export async function run() {
  const now = Date.now();
  console.log(`\n=== rank_leads.mjs === mode=${LIVE ? 'LIVE' : LLM ? 'DRY RUN + LLM' : 'DRY RUN (cache-only, zero writes, zero LLM)'}`);

  mkdirSync(RUN_DIR, { recursive: true });
  writeFileSync(join(RUN_DIR, 'config.json'), JSON.stringify({
    mode: LIVE ? 'live' : LLM ? 'dry_llm' : 'dry_run', client: CLIENT_SLUG,
    cluster_window_days: 7, jaccard_filter: 'removed_2026-07-17', date: new Date().toISOString(),
  }, null, 2));

  const clientId = await getClientId(CLIENT_SLUG);
  const runId = LIVE ? await startRun({ clientId, script: 'rank_leads', source: 'scoring' }) : null;

  // Slim selects (F1): no raw_data, no 005 columns — dry runs work pre-migration.
  // event_summary added (007/D3/Q2) — needed to detect which events already have
  // one so we don't re-spend an LLM call on an unchanged event every run.
  const [allSignals, companies, contacts] = await Promise.all([
    selectAll('signals', { client_id: clientId }, { select: 'id,company_id,signal_type,title,source,source_url,pub_date,status,expires_at,event_summary' }),
    selectAll('companies', { client_id: clientId }, { select: 'id,name,domain,hq_country' }),
    selectAll('contacts', { client_id: clientId }, { select: 'id,company_id,email,linkedin_url' }),
  ]);
  const signals = allSignals.filter(s => s.status === 'active' || s.status === 'stale');
  console.log(`signals: ${signals.length} active|stale (of ${allSignals.length}) | companies: ${companies.length} | contacts: ${contacts.length}`);
  writeCheckpoint({ phase: 'loaded', signals: signals.length });

  // ── 1. expire pass (+ F4 expires_at recompute) ─────────────────────────────
  const newlyStale = signals.filter(s => s.status === 'active' && isStale(s.signal_type, s.pub_date, now));
  const expiresFix = [];
  for (const s of signals) {
    if (s.status !== 'active') continue;
    const want = expiresAt(s.signal_type, s.pub_date);
    if (!s.expires_at || Math.abs(new Date(s.expires_at) - new Date(want)) > 86_400_000) {
      expiresFix.push({ id: s.id, expires_at: want });
    }
  }
  console.log(`expire pass: ${newlyStale.length} active → stale | expires_at recompute needed: ${expiresFix.length}`);
  if (LIVE) {
    if (newlyStale.length) await patch('signals', 'id', newlyStale.map(s => s.id), { status: 'stale' });
    // group by identical recomputed value → one PATCH per distinct expires_at
    const byVal = new Map();
    for (const f of expiresFix) {
      if (!byVal.has(f.expires_at)) byVal.set(f.expires_at, []);
      byVal.get(f.expires_at).push(f.id);
    }
    for (const [val, ids] of byVal) await patch('signals', 'id', ids, { expires_at: val });
    for (const s of newlyStale) s.status = 'stale';
  }

  // ── 2. event grouping per company ──────────────────────────────────────────
  const byCompany = new Map();
  let noCompany = 0;
  for (const s of signals) {
    if (!s.company_id) { noCompany++; continue; }
    if (!byCompany.has(s.company_id)) byCompany.set(s.company_id, []);
    byCompany.get(s.company_id).push(s);
  }

  const cache = loadCache(CACHE_PATH);
  let cacheDirty = false;
  const clusterStats = { found: 0, fromCache: 0, llmCalls: 0, pendingLlm: 0 };
  let sameEventFn = null, summarizeEventFn = null;
  if (LLM) ({ sameEvent: sameEventFn, summarizeEvent: summarizeEventFn } = await import('../lib/companyClassifier.mjs'));

  const summaryCache = loadCache(SUMMARY_CACHE_PATH);
  let summaryCacheDirty = false;
  const summaryStats = { eligible: 0, fromCache: 0, llmCalls: 0, pendingLlm: 0, alreadyUpToDate: 0 };
  const companiesById = new Map(companies.map(c => [c.id, c]));

  const companyEvents = new Map(); // company_id -> classified events
  let companiesDone = 0;
  for (const [companyId, sigs] of byCompany) {
    const uf = buildInitialGroups(sigs);
    const clusters = findCandidateClusters(sigs, uf, { windowDays: 7 });
    clusterStats.found += clusters.length;
    for (const cluster of clusters) {
      const key = cluster.map(s => s.id).sort().join('|');
      let groups = cache[key] || null;
      if (groups) clusterStats.fromCache++;
      else if (sameEventFn) {
        const verdict = await sameEventFn(cluster.map(s => s.title || ''));
        if (verdict?.groups) {
          groups = verdict.groups;
          cache[key] = groups;
          cacheDirty = true;
          clusterStats.llmCalls++;
        }
      } else {
        clusterStats.pendingLlm++; // dry run without --llm: stays unmerged (conservative)
      }
      if (groups) applySameEventGroups(uf, cluster, groups);
    }
    const events = finalizeEvents(sigs, uf).map(ev => ({ ...ev, ...classifyEvent(ev, { now }) }));

    // ── 3. event_summary (D3/Q2) — eager, cache-first, per-event. Single-source
    // events (uniqueSourceCount < 2) never reach the LLM — frontend falls back to
    // the signal's own title for those, free. Events whose members already carry
    // one matching summary (needsEventSummary === false) are skipped too — no
    // point re-spending on an event nothing changed about since the last run.
    const company = companiesById.get(companyId);
    for (const ev of events) {
      if (uniqueSourceCount(ev.members) < 2) continue;
      if (!needsEventSummary(ev.members)) { summaryStats.alreadyUpToDate++; continue; }
      summaryStats.eligible++;
      const summaryKey = ev.memberIds.slice().sort().join('|');
      let summary = summaryCache[summaryKey]?.summary || null;
      if (summary) {
        summaryStats.fromCache++;
      } else if (summarizeEventFn && company) {
        const result = await summarizeEventFn(company.name, ev.members.map(m => ({ title: m.title, source: m.source, pub_date: m.pub_date })));
        if (result?.summary) {
          summary = result.summary;
          summaryCache[summaryKey] = { summary, at: new Date().toISOString() };
          summaryCacheDirty = true;
          summaryStats.llmCalls++;
        }
      } else {
        summaryStats.pendingLlm++; // dry run without --llm: no summary generated this run (conservative)
      }
      if (summary) ev.summary = summary;
    }

    companyEvents.set(companyId, events);
    if (++companiesDone % 50 === 0) writeCheckpoint({ phase: 'grouping', companiesDone, of: byCompany.size });
  }
  if (cacheDirty) writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  if (summaryCacheDirty) writeFileSync(SUMMARY_CACHE_PATH, JSON.stringify(summaryCache, null, 2));
  const totalEvents = [...companyEvents.values()].reduce((n, e) => n + e.length, 0);
  console.log(`events: ${signals.length - noCompany} signals (${noCompany} without company skipped) → ${totalEvents} events across ${byCompany.size} companies`);
  console.log(`Q6 clusters: ${clusterStats.found} found | ${clusterStats.fromCache} cached | ${clusterStats.llmCalls} LLM calls | ${clusterStats.pendingLlm} pending LLM (unmerged this run)`);
  console.log(`event_summary: ${summaryStats.eligible} eligible (>=2 sources) | ${summaryStats.alreadyUpToDate} already up to date | ${summaryStats.fromCache} cached | ${summaryStats.llmCalls} LLM calls | ${summaryStats.pendingLlm} pending LLM`);

  // ── 4. ICP gate via sourcing.companies ─────────────────────────────────────
  const sourcingClientId = await getSourcingClientId(CLIENT_SLUG);
  const sourcingRows = await selectAllSourcing('companies', `client_id=eq.${sourcingClientId}&select=domain,icp_status`);
  const icpByDomain = new Map();
  for (const r of sourcingRows) {
    const d = normDomain(r.domain);
    if (d && !icpByDomain.has(d)) icpByDomain.set(d, r.icp_status);
  }
  console.log(`sourcing ICP verdicts loaded: ${icpByDomain.size} domains`);

  const contactReady = new Set();
  for (const c of contacts) {
    if (c.company_id && (c.email || c.linkedin_url)) contactReady.add(c.company_id);
  }

  // ── 5. tier + rank ─────────────────────────────────────────────────────────
  const results = []; // { company, signalCount, events, gate, tier, rank, tierReason }
  const tierDist = { T1: 0, T2: 0, T3: 0, icp_reject: 0, needs_screen: 0, no_fresh_event: 0 };
  const classDist = {};
  const eventsPerCompany = {};

  for (const [companyId, events] of companyEvents) {
    const company = companies.find(c => c.id === companyId);
    if (!company) continue;
    const sigs = byCompany.get(companyId);
    eventsPerCompany[events.length] = (eventsPerCompany[events.length] || 0) + 1;
    for (const ev of events) classDist[ev.type] = (classDist[ev.type] || 0) + 1;

    const icp = icpByDomain.get(normDomain(company.domain));
    let gate = 'pass';
    if (icp === 'reject') gate = 'icp_reject';
    else if (icp !== 'pass') gate = 'needs_screen'; // unscored / needs_website / no domain / not in sourcing

    let tier = null, rank = null, tierReason = gate;
    if (gate === 'pass') {
      const t = tierCompany({ events, hasReadyContact: contactReady.has(companyId), now });
      tier = t.tier; rank = t.rank; tierReason = t.tierReason;
    }
    results.push({ company, signalCount: sigs.length, events, gate, tier, rank, tierReason });
  }
  // tally (kept out of the loop for clarity)
  for (const r of results) {
    if (r.tier) tierDist[r.tier]++;
    else if (r.gate !== 'pass') tierDist[r.gate]++;
    else tierDist.no_fresh_event++;
  }

  // ── 6. LIVE writes (migration-005/007 columns) ─────────────────────────────
  if (LIVE) {
    writeCheckpoint({ phase: 'writing', companies: results.length });
    let summariesWritten = 0;
    for (const [companyId, events] of companyEvents) {
      for (const ev of events) {
        const data = { event_key: ev.eventKey };
        if (ev.summary) { data.event_summary = ev.summary; summariesWritten++; }
        await patch('signals', 'id', ev.memberIds, data);
      }
    }
    const rankedAt = new Date().toISOString();
    for (const r of results) {
      await patch('companies', 'id', [r.company.id], { tier: r.tier, rank: r.rank, tier_reason: r.tierReason, ranked_at: rankedAt });
    }
    console.log(`LIVE: event_key written for ${totalEvents} events (${summariesWritten} with a fresh event_summary), tier/rank for ${results.length} companies`);
  }

  // ── 7. manifest + acceptance output ────────────────────────────────────────
  console.log('\ntier distribution:', JSON.stringify(tierDist));
  console.log('events per company:', JSON.stringify(Object.fromEntries(Object.entries(eventsPerCompany).sort((a, b) => a[0] - b[0]))));
  console.log('event types:', JSON.stringify(classDist));

  const topCollapses = [...results].sort((a, b) => b.signalCount - a.signalCount).slice(0, 15);
  console.log('\n=== signal → event collapse (top 15 by raw signal count) ===');
  console.table(topCollapses.map(r => ({
    company: r.company.name.slice(0, 40), signals: r.signalCount, events: r.events.length,
    types: [...new Set(r.events.map(e => e.type))].join(','), gate: r.gate, tier: r.tier || '-', rank: r.rank ?? '-',
  })));

  const ACCEPTANCE = /dmk|nestl|yfood|schiller|gausepohl/i;
  const acceptance = results.filter(r => ACCEPTANCE.test(r.company.name));
  console.log('=== acceptance check (A1: DMK / Nestlé-yfood / Schiller-Gausepohl) ===');
  console.table(acceptance.map(r => ({
    company: r.company.name, signals: r.signalCount, events: r.events.length,
    eventTypes: r.events.map(e => `${e.type}(${e.memberIds.length})`).join(' '), tier: r.tier || r.tierReason,
  })));
  const summarized = acceptance.flatMap(r => r.events.filter(e => e.summary));
  if (summarized.length) {
    console.log('=== event_summary sample (acceptance companies) ===');
    for (const e of summarized) console.log(`  [${e.type}] ${e.summary}`);
  }

  const manifest = {
    date: new Date().toISOString(), mode: LIVE ? 'live' : LLM ? 'dry_llm' : 'dry_run',
    signals_loaded: signals.length, signals_no_company: noCompany,
    expire_pass: { newly_stale: newlyStale.length, expires_at_recomputed: expiresFix.length, applied: LIVE },
    companies_with_signals: byCompany.size, events_total: totalEvents,
    events_per_company: eventsPerCompany, clusters: clusterStats,
    event_summary: summaryStats,
    tier_distribution: tierDist, event_type_distribution: classDist,
    acceptance: acceptance.map(r => ({ company: r.company.name, signals: r.signalCount, events: r.events.length, tier: r.tier, tier_reason: r.tierReason })),
    status: 'complete',
  };
  writeFileSync(join(RUN_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeCheckpoint({ phase: 'done' });

  if (LIVE) await finishRun(runId, { status: 'success', stats: { scraped: signals.length, pushed: results.length } });
  else console.log('\nDRY RUN — nothing written. --llm to confirm pending clusters (paid, cents), --live to write (needs migration 005 + Leo\'s go).');
  console.log('=== DONE ===');
  return { events: totalEvents, tiers: tierDist };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error(e); process.exit(1); });
}
