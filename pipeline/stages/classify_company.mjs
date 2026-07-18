// Resolution cascade for Exa news signals that never got a usable company_id.
// Cost cascade (2026-07-14 decision, see PRD.md "SESSION ADDENDUM — Resolution Layer"):
//   Layer 0 (free)   — match against sourcing.companies (11.8k TAM base, outer repo)
//   Layer 1 (~$0.03-0.04/company) — Exa Finder (domain + about) + LLM ICP classify
//   Layer 2 (free, permanent) — write the Layer-1 result back into sourcing.companies,
//                                so every future duplicate hits Layer 0 for free.
//
// Safety: defaults to DRY RUN (counts/plan only, zero spend). Pass --live to actually call
// Exa/OpenRouter and write results. Per project rule, only run --live after Leo says "запускай".
//
// Run: node --env-file=nextjs/.env.local pipeline/stages/classify_company.mjs [--live] [--limit=N]

import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { selectAll, insert, patch } from '../lib/supabase.mjs';
import { getClientId, startRun, finishRun } from '../lib/log.mjs';
import { getSourcingClientId, startSourcingRun, finishSourcingRun, selectAllSourcing, upsertSourcingCompany } from '../lib/sourcing.mjs';
import { resolveDomain, fetchAbout, fetchArticleText } from '../lib/exaFinder.mjs';
import { extractEntities, classifyCompany, blacklistHit, sameEvent } from '../lib/companyClassifier.mjs';
import { lookupByDomain, matchesTarget, blitzEmployees } from '../lib/blitzEnrich.mjs';
import { loadCache, saveCache } from '../lib/exaCache.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';

const args  = process.argv.slice(2);
const LIVE  = args.includes('--live');
const limitArg = args.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
const CONCURRENCY = 5; // matches find_contacts.mjs's convention for multi-call-per-item stages

const CACHE_DOMAIN  = join(__dir, '../../exa/cache/company_resolve_cache.json');
const CACHE_ABOUT   = join(__dir, '../../exa/cache/company_about_cache.json');
const CACHE_ENTITY  = join(__dir, '../../exa/cache/entity_extract_cache.json');
const CACHE_ARTICLE = join(__dir, '../../exa/cache/article_text_cache.json');
const CACHE_BLITZ   = join(__dir, '../../exa/cache/blitz_lookup_cache.json');

const ACCENT_MAP = { é:'e',è:'e',ê:'e',ë:'e',à:'a',â:'a',ü:'u',ö:'o',ä:'a',ß:'ss',ç:'c',û:'u',î:'i',ï:'i',ô:'o',œ:'oe',æ:'ae',ø:'o',å:'a' };
function norm(s) { return String(s||'').toLowerCase().replace(/[éèêëàâüöäßçûîïôœæøå]/g,c=>ACCENT_MAP[c]||c).replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); }
const STRIP = /\b(gmbh|ag|sa|nv|bv|srl|ltd|inc|corp|llc|sas|snc|ohg|kg|og|se|plc|co|cie|group|gruppe|holding|services|international|deutschland|france)\b/g;
function coreName(s) { return norm(s).replace(STRIP,' ').replace(/\s+/g,' ').trim().split(' ').slice(0,3).join(' '); }
function normDomain(d) { if (!d) return ''; return String(d).toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/.*$/,'').trim(); }

export async function run() {
  console.log(`\n=== classify_company.mjs === mode=${LIVE ? 'LIVE (spends money)' : 'DRY RUN (no spend)'}`);

  const clientId = await getClientId(CLIENT_SLUG);
  // Dry runs don't log to pipeline_runs (finishRun no-ops on null runId).
  const runId = LIVE ? await startRun({ clientId, script: 'classify_company', source: 'exa_finder+llm' }) : null;

  let sourcingClientId = null, sourcingRunId = null;
  if (LIVE) {
    console.log('[setup] resolving sourcing client_id...');
    sourcingClientId = await getSourcingClientId(CLIENT_SLUG);
    console.log('[setup] starting sourcing run row...');
    sourcingRunId = await startSourcingRun(sourcingClientId, {
      run_type: 'exa_finder_classify',
      run_tag: `exa_classify_${new Date().toISOString().slice(0, 19).replace(/[-:]/g, '')}`,
      config: { source: 'signal_monitoring.raw_signals (exa)', mode: 'layer0_sourcing+layer1_exa_llm' },
    });
  }

  const domainCache  = loadCache(CACHE_DOMAIN);
  const aboutCache   = loadCache(CACHE_ABOUT);
  const entityCache  = loadCache(CACHE_ENTITY);
  const articleCache = loadCache(CACHE_ARTICLE);
  const blitzCache   = loadCache(CACHE_BLITZ);

  // Every exa signal that passed ICP filtering — this is the pool needing resolution.
  console.log('[setup] fetching raw_signals...');
  const rawSignals = await selectAll('raw_signals', { client_id: clientId, source: 'exa', status: 'passed_icp' });
  console.log(`exa passed_icp raw_signals: ${rawSignals.length}`);

  console.log('[setup] fetching signals...');
  const existingSignals = await selectAll('signals', { client_id: clientId, source: 'exa' });
  const signalByRawId = new Map(existingSignals.filter(s => s.raw_signal_id).map(s => [s.raw_signal_id, s]));

  console.log('[setup] fetching companies...');
  const companies = await selectAll('companies', { client_id: clientId });
  const companyByDomain = new Map(companies.filter(c => c.domain).map(c => [normDomain(c.domain), c]));
  const companyByCoreName = new Map(companies.map(c => [coreName(c.name), c]));

  // Lightweight columns only for the full 11.8k table — about/website_summary are large text
  // blobs and only matter for the handful of rows that actually Layer-0-hit, so those are
  // fetched lazily per-hit below instead of bulk-loaded for all 11,793 rows (the original
  // bulk about/website_summary select is what stalled the connection on 2026-07-14).
  console.log('[setup] fetching sourcing.companies (11.8k, paginated, lightweight columns)...');
  const sourcing = LIVE ? await selectAllSourcing('companies', `client_id=eq.${sourcingClientId}&select=id,company_name,domain,icp_status,icp_reason,employees,hq_country,industry`) : [];
  console.log(`[setup] sourcing.companies loaded: ${sourcing.length}`);
  const sourcingByDomain = new Map();
  const sourcingByCoreName = new Map();
  for (const c of sourcing) {
    const d = normDomain(c.domain);
    if (d) sourcingByDomain.set(d, c);
    const cn = coreName(c.company_name);
    if (cn && !sourcingByCoreName.has(cn)) sourcingByCoreName.set(cn, c);
  }

  const stats = {
    total: 0, alreadyResolved: 0, noEntityExtracted: 0, needsReview: 0,
    layer0Hit: 0, layer1BlitzResolved: 0, layer1Resolved: 0, layer1Failed: 0, rejected: 0, entityMismatch: 0,
    fallbackB_articleFetch: 0, fallbackB_recovered: 0,
    candidatesResolved: 0, alternatesWrittenBack: 0, blacklistedCandidates: 0,
    noTargetChosen: 0, classifyFailed: 0,
    nearDupClustersFound: 0, nearDupMerged: 0, nearDupSignalsSkipped: 0,
    errors: [],
  };
  let processed = 0;

  // Layer 0/1 DATA resolution for ONE candidate name — no classification here. Since the
  // 2026-07-15 resolve-all redesign (Q4), every plausible candidate in a signal goes through
  // this, and the pass/reject + target choice happen afterwards in ONE classifyCompany call
  // with all the resolved data on the table (instead of trusting a blind headline-only guess
  // and only ever resolving that one name — which left 41% of all company mentions, 223 of
  // 538, never looked up at all).
  async function resolveCandidate(name, role, country) {
    const cn = coreName(name);
    const l0 = sourcingByCoreName.get(cn);
    if (l0) {
      let about = null;
      if (LIVE) {
        const [full] = await selectAllSourcing('companies', `id=eq.${l0.id}&select=about,website_summary`);
        about = full?.about || full?.website_summary || null;
      }
      return {
        name, role, cn, l0, domain: l0.domain, about,
        employees: l0.employees, hqCountry: l0.hq_country, industry: l0.industry,
        via: 'layer0_sourcing',
        evidence: { via: 'sourcing', employees: l0.employees, industry: l0.industry, hqCountry: l0.hq_country, about, priorIcpStatus: l0.icp_status, priorIcpReason: l0.icp_reason },
      };
    }
    const dom = await resolveDomain(name, country, domainCache);
    if (!dom.domain) {
      return { name, role, cn, l0: null, domain: null, via: 'layer1_exa_failed', evidence: { via: 'none' } };
    }

    // Blitz-first (2026-07-15 redesign, see PRD.md): once Exa has found a candidate domain,
    // try real Blitz/LinkedIn data BEFORE spending on an Exa about-fetch. Audited 2026-07-14:
    // the LLM's employee-count guess was only grounded in fetched text 32% of the time; Blitz
    // covers ~70% of companies with real data. Only trust Blitz when its own reported company
    // name matches what we're looking for (matchesTarget) — that gate is what stopped a
    // wrong-domain match (e.g. "OSI" resolving to osi.af.mil, the US Air Force) from being
    // trusted just because the employee count looked plausible for the wrong entity.
    const blitz = await lookupByDomain(dom.domain, blitzCache);
    if (blitz && matchesTarget(blitz, name)) {
      return {
        name, role, cn, l0: null, domain: dom.domain, about: blitz.about,
        employees: blitzEmployees(blitz), hqCountry: blitz.hqCountry || country, industry: blitz.industry,
        companyLinkedinUrl: blitz.linkedinUrl, via: 'layer1_blitz',
        evidence: { via: 'blitz', blitz },
      };
    }

    // Blitz didn't have it, or its match doesn't look like the same entity — Exa about-text
    // as the (weaker) evidence; classifyCompany's entity_mismatch check covers the wrong-page
    // risk.
    const about = await fetchAbout(dom.domain, name, aboutCache);
    return {
      name, role, cn, l0: null, domain: dom.domain, about: about.text,
      employees: null, hqCountry: country, industry: null, via: 'layer1_exa_llm',
      evidence: { via: 'exa_about', aboutText: about.text, aboutTitle: about.title, blitzNameMismatch: blitz?.linkedinCompanyName || null },
    };
  }

  // ── Phase 1 (per item, safe to run concurrently) — extraction + domain/about/classify.
  // Touches only per-item-keyed caches (entityCache/domainCache/aboutCache/articleCache) and
  // read-only lookups against sourcingByCoreName/companyByCoreName — no shared-map writes here,
  // so running several of these at once cannot corrupt anything. Mirrors score_signals.mjs's
  // "LLM calls run concurrently" step. ──
  async function analyzeOne(s) {
    const country = s.country;
    const signalType = (s.raw_data?.signal_type || 'NICHE').toUpperCase();
    const headline = s.raw_data?.title || '';
    const result = { s, country, signalType, headline, stats: {} };

    let entities = entityCache[s.id];
    if (!entities) {
      entities = LIVE ? await extractEntities(s, country) : { primaryTarget: '(dry-run, not extracted)', companies: [], needsReview: false };
      if (LIVE) entityCache[s.id] = entities;
    }

    // Fallback B: headline alone named no company — read the actual article and retry.
    if (LIVE && (!entities || !entities.primaryTarget) && s.source_url) {
      result.stats.fallbackB_articleFetch = 1;
      const article = await fetchArticleText(s.source_url, articleCache);
      if (article?.text) {
        const retried = await extractEntities(s, country, article.text);
        if (retried?.primaryTarget) {
          entities = retried;
          entityCache[s.id] = entities;
          result.stats.fallbackB_recovered = 1;
        }
      }
    }

    if (!entities || !entities.primaryTarget) {
      result.stats.noEntityExtracted = 1;
      return result;
    }
    if (entities.needsReview) result.stats.needsReview = 1;
    result.entities = entities;

    if (!LIVE) return result; // dry run stops here — no network spend beyond the above

    // Candidate set (Q4 redesign): every plausible target named in the signal, primary_target
    // first (it's still a useful prior), deduped by core name, capped to bound the spend on
    // aberrant many-name headlines. Associations/certifiers and investors are never outreach
    // targets; blacklisted names (staffing/catering/exec-search) are dropped before spending.
    const MAX_CANDIDATES = 4;
    const NON_TARGET_ROLES = new Set(['certifier_or_association', 'investor']);
    const roleByName = new Map((entities.companies || []).map(c => [c.name, c.role]));
    const seen = new Set();
    const candidateNames = [];
    let anyBlacklisted = false;
    for (const n of [entities.primaryTarget, ...(entities.companies || []).map(c => c.name)]) {
      if (!n) continue;
      const role = roleByName.get(n) || null;
      if (NON_TARGET_ROLES.has(role)) continue;
      const k = coreName(n);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      if (blacklistHit(n)) { anyBlacklisted = true; result.stats.blacklistedCandidates = (result.stats.blacklistedCandidates || 0) + 1; continue; }
      candidateNames.push({ name: n, role });
      if (candidateNames.length >= MAX_CANDIDATES) break;
    }

    if (!candidateNames.length) {
      if (anyBlacklisted) {
        // Every named company is a known staffing/catering/exec-search type — permanent reject.
        result.targetName = entities.primaryTarget;
        result.resolved = {
          cn: coreName(entities.primaryTarget), l0: null, domain: null, about: null,
          employees: null, hqCountry: country, industry: null,
          icpStatus: 'reject', icpReason: 'Blacklisted company type (staffing/catering/executive-search)',
          entityMismatch: false, via: 'blacklist',
        };
      } else {
        result.stats.noEntityExtracted = 1;
      }
      return result;
    }

    const resolvedCandidates = [];
    for (const c of candidateNames) {
      resolvedCandidates.push(await resolveCandidate(c.name, c.role, country));
    }
    result.stats.candidatesResolved = resolvedCandidates.length;

    // Free path preserved: a single candidate that Layer-0-hit our own TAM DB with a real
    // prior verdict — reuse it, no LLM call. 'unscored' rows (e.g. written back as a
    // not-chosen alternate of an earlier signal) still get a real screen below.
    let chosen = null, verdict = null;
    const single = resolvedCandidates.length === 1 ? resolvedCandidates[0] : null;
    if (single?.via === 'layer0_sourcing' && single.evidence.priorIcpStatus && single.evidence.priorIcpStatus !== 'unscored') {
      chosen = single;
      verdict = { icpStatus: single.evidence.priorIcpStatus, icpReason: single.evidence.priorIcpReason, entityMismatch: false };
    } else {
      const cls = await classifyCompany({ headline, signalType, country, pubDate: s.pub_date, candidates: resolvedCandidates });
      if (!cls) {
        result.stats.classifyFailed = 1;
        result.alternates = resolvedCandidates; // keep the resolved data anyway
        return result;
      }
      if (cls.needsReview) result.stats.needsReview = (result.stats.needsReview || 0) + 1;
      if (cls.chosenName) {
        const target = coreName(cls.chosenName);
        chosen = resolvedCandidates.find(rc => rc.name === cls.chosenName)
              || resolvedCandidates.find(rc => coreName(rc.name) === target)
              || resolvedCandidates.find(rc => coreName(rc.name).includes(target) || target.includes(coreName(rc.name)));
      }
      if (!chosen) {
        result.stats.noTargetChosen = 1;
        result.alternates = resolvedCandidates;
        return result;
      }
      verdict = cls;
    }
    if (verdict.entityMismatch) result.stats.entityMismatch = 1;

    result.targetName = chosen.name;
    result.resolved = {
      cn: chosen.cn, l0: chosen.l0, domain: chosen.domain, about: chosen.about ?? null,
      employees: chosen.employees ?? verdict.employeesEstimate ?? null,
      hqCountry: chosen.hqCountry || country, industry: chosen.industry || null,
      icpStatus: verdict.icpStatus, icpReason: verdict.icpReason,
      entityMismatch: !!verdict.entityMismatch, via: chosen.via,
      companyLinkedinUrl: chosen.companyLinkedinUrl || null,
    };
    result.alternates = resolvedCandidates.filter(rc => rc !== chosen);
    return result;
  }

  // ── Phase 2 (per item, MUST run sequentially within a batch) — the actual DB writes.
  // Two same-batch items resolving to the same company would otherwise both pass the
  // "does it exist yet?" check before either had written it, creating duplicate rows — this is
  // exactly the race score_signals.mjs's own comment warns about, avoided the same way: the
  // expensive concurrent phase does no shared-map mutation, only this phase does. ──
  async function writeOne(result) {
    const { s, country, resolved, targetName } = result;
    if (!resolved) return; // fallback B failed to find a company at all

    const cn = resolved.cn;
    const l0 = resolved.l0;

    if (resolved.via === 'layer0_sourcing') stats.layer0Hit++;
    if (resolved.icpStatus === 'reject') stats.rejected++;
    else if (resolved.via === 'layer1_blitz' && resolved.domain) stats.layer1BlitzResolved++;
    else if (resolved.via === 'layer1_exa_llm' && resolved.domain) stats.layer1Resolved++;
    else if (resolved.via === 'layer1_exa_failed') stats.layer1Failed++;

    // Layer 2 — permanent write-back to sourcing. Re-check sourcingByCoreName fresh (not the
    // analyze-time snapshot in `l0`) in case another item earlier in THIS batch already wrote it.
    const freshHit = sourcingByCoreName.get(cn);
    let sourcingRow = freshHit || l0 || null;
    if (resolved.via !== 'layer0_sourcing' && !freshHit) {
      sourcingRow = await upsertSourcingCompany({
        client_id: sourcingClientId,
        domain: resolved.domain || null,
        company_name: targetName,
        company_linkedin_url: resolved.companyLinkedinUrl || null,
        hq_country: resolved.hqCountry || country || null,
        employees: resolved.employees || null,
        industry: resolved.industry || null,
        about: resolved.about || null,
        icp_status: resolved.icpStatus,
        icp_reason: resolved.icpReason,
        icp_scored_run_id: (resolved.via === 'layer1_exa_llm' || resolved.via === 'layer1_blitz') ? sourcingRunId : null,
        first_seen_via: 'signal_monitoring_exa',
      });
      if (resolved.domain) sourcingByDomain.set(normDomain(resolved.domain), sourcingRow);
      sourcingByCoreName.set(cn, sourcingRow);
    }

    // Resolve/create the signal_monitoring.companies row for this target.
    // NOTE: docs/SCHEMA.md claims a `meta jsonb` column on both companies and signals — the
    // live DB has neither (verified 2026-07-14). icp_status/icp_reason/entity audit trail lives
    // in sourcing.companies + the local entity_extract_cache.json instead. See report to Leo.
    let companyRow = resolved.domain ? companyByDomain.get(normDomain(resolved.domain)) : companyByCoreName.get(cn);
    if (!companyRow) {
      const [created] = await insert('companies', [{
        client_id: clientId, name: targetName, domain: resolved.domain || null,
        linkedin_url: resolved.companyLinkedinUrl || null,
        hq_country: resolved.hqCountry || country || null, employees: resolved.employees || null,
        about: resolved.about || null,
      }]);
      companyRow = created;
      if (companyRow) {
        companies.push(companyRow);
        if (companyRow.domain) companyByDomain.set(normDomain(companyRow.domain), companyRow);
        companyByCoreName.set(cn, companyRow);
      }
    }

    const existingSignal = signalByRawId.get(s.id);
    if (existingSignal) {
      await patch('signals', 'id', [existingSignal.id], { company_id: companyRow?.id || null });
    }
    await patch('raw_signals', 'id', [s.id], { company_name: targetName });
  }

  const eligible = [];
  for (const s of rawSignals) {
    if (eligible.length >= LIMIT) break;
    const existingSignal = signalByRawId.get(s.id);
    if (existingSignal?.company_id) {
      const c = companies.find(x => x.id === existingSignal.company_id);
      if (c?.domain) { stats.alreadyResolved++; continue; }
    }
    eligible.push(s);
  }

  // Exact-title dedup — found 2026-07-14: 20% of entity-extraction LLM calls (42 of 211) were
  // spent re-analyzing a headline byte-identical to one already processed in the same run (e.g.
  // "LIVEKINDLY Collective Acquires..." picked up by 3 monitors verbatim). No NLP needed for
  // this subset — exact normalized-title match is free and catches the worst offenders. Fuzzier
  // near-duplicates (different headline, same event — e.g. Bobeldijk/Schouten from two outlets)
  // still each pay for their own extraction call, since matching those reliably needs an LLM
  // call anyway, defeating the purpose.
  const groups = new Map(); // normalized title -> [signals]
  for (const s of eligible) {
    const key = norm(s.raw_data?.title || s.id); // fall back to id so untitled rows don't collide
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  let representatives = [...groups.values()].map(group => group[0]);
  stats.exactTitleDupesSkipped = eligible.length - representatives.length;

  // Q6 near-dup clustering: different headlines, same real event (e.g. "Schouten Europe neemt
  // Bobeldijk over" vs "Schouten Europe buys plant-based peer Bobeldijk" — different outlets,
  // different language, same deal). Exact-title dedup above can't catch these. One LLM call per
  // cluster confirms/splits — one call per cluster, not per pair, so this can't multiply cost.
  //
  // 2026-07-17 (Leo): dropped the word-overlap (Jaccard>=0.3) pre-filter that used to gate which
  // pairs even reached the LLM. Found live on DMK Group: "invests €25m in lactoferrin production"
  // vs "invests in German dairy plant" is almost certainly the same story, but shares too few
  // significant words to pass the old filter — a silent recall miss, not a wrong verdict.
  // Accuracy over OpenRouter cost (cents) — the date window is now the only free gate.
  if (LIVE && representatives.length > 1) {
    const dayOf = s => (s.pub_date || '').slice(0, 10);

    const used = new Set();
    const clusters = [];
    for (const s of representatives) {
      if (used.has(s.id)) continue;
      const cluster = [s];
      for (const t of representatives) {
        if (t.id === s.id || used.has(t.id)) continue;
        if (Math.abs(new Date(dayOf(s)) - new Date(dayOf(t))) > 4 * 86_400_000) continue; // same week-ish
        cluster.push(t);
      }
      if (cluster.length > 1) { for (const c of cluster) used.add(c.id); clusters.push(cluster); }
    }

    let mergedGroups = 0, mergedSignals = 0;
    for (const cluster of clusters) {
      const verdict = await sameEvent(cluster.map(s => s.raw_data?.title || ''));
      if (!verdict?.groups) continue;
      for (const idxGroup of verdict.groups) {
        if (idxGroup.length < 2) continue;
        const members = idxGroup.map(i => cluster[i - 1]).filter(Boolean);
        if (members.length < 2) continue;
        // Merge into the representatives list: keep the first as the extraction representative,
        // fold the rest's raw_signals into its exact-title group so writeOne applies the same
        // resolved company to all of them (identical mechanism to exact-title dedup above).
        const keeper = members[0];
        const keeperKey = norm(keeper.raw_data?.title || keeper.id);
        for (const m of members.slice(1)) {
          const mKey = norm(m.raw_data?.title || m.id);
          const mGroup = groups.get(mKey) || [m];
          groups.get(keeperKey).push(...mGroup);
          groups.delete(mKey);
          representatives = representatives.filter(r => r.id !== m.id);
          mergedSignals += mGroup.length;
        }
        mergedGroups++;
      }
    }
    stats.nearDupClustersFound = clusters.length;
    stats.nearDupMerged = mergedGroups;
    stats.nearDupSignalsSkipped = mergedSignals;
  }

  for (let i = 0; i < representatives.length; i += CONCURRENCY) {
    const batch = representatives.slice(i, i + CONCURRENCY);

    const analyzed = await Promise.allSettled(batch.map(s => analyzeOne(s)));

    for (let j = 0; j < batch.length; j++) {
      const s = batch[j];
      const outcome = analyzed[j];
      const groupKey = norm(s.raw_data?.title || s.id);
      const groupMembers = groups.get(groupKey) || [s];
      processed += groupMembers.length;
      stats.total += groupMembers.length;

      if (outcome.status === 'rejected') {
        stats.errors.push(`${s.id}: ${outcome.reason?.message || outcome.reason}`);
        console.error(`  [error] raw_signal ${s.id}: ${outcome.reason?.message || outcome.reason}`);
        continue;
      }

      const result = outcome.value;
      for (const [k, v] of Object.entries(result.stats || {})) stats[k] = (stats[k] || 0) + v;

      if (!result.entities?.primaryTarget) continue;
      if (!LIVE) continue;

      // Resolved-but-not-chosen candidates: their data was paid for, keep it (the whole point
      // of resolve-all) — write NEW sourcing rows as 'unscored'; never touch an existing row's
      // icp_status from here. If such a company later fires its own signal, Layer 0 serves the
      // data free and the 'unscored' status routes it to a real screen.
      if (result.alternates?.length) {
        for (const alt of result.alternates) {
          if (!alt.domain || alt.l0) continue;
          if (sourcingByCoreName.get(alt.cn) || sourcingByDomain.get(normDomain(alt.domain))) continue;
          try {
            const row = await upsertSourcingCompany({
              client_id: sourcingClientId, domain: alt.domain, company_name: alt.name,
              company_linkedin_url: alt.companyLinkedinUrl || null,
              hq_country: alt.hqCountry || null, employees: alt.employees || null,
              industry: alt.industry || null, about: alt.about || null,
              icp_status: 'unscored', icp_reason: null, icp_scored_run_id: null,
              first_seen_via: 'signal_monitoring_exa',
            });
            sourcingByDomain.set(normDomain(alt.domain), row);
            sourcingByCoreName.set(alt.cn, row);
            stats.alternatesWrittenBack++;
          } catch (e) {
            stats.errors.push(`alternate ${alt.name}: ${e.message}`);
          }
        }
      }

      // Apply the SAME analysis result to every exact-title duplicate of this signal — no
      // re-extraction, just write the resolved company link for each raw_signal in the group.
      for (const member of groupMembers) {
        try {
          await writeOne({ ...result, s: member });
        } catch (e) {
          stats.errors.push(`${member.id}: ${e.message}`);
          console.error(`  [error] raw_signal ${member.id}: ${e.message}`);
        }
      }
    }

    if (LIVE) { saveCache(CACHE_DOMAIN, domainCache); saveCache(CACHE_ABOUT, aboutCache); saveCache(CACHE_ENTITY, entityCache); saveCache(CACHE_ARTICLE, articleCache); saveCache(CACHE_BLITZ, blitzCache); }
    process.stdout.write(`\r  ${Math.min(i + CONCURRENCY, representatives.length)}/${representatives.length} processed (${eligible.length} incl. exact-title dupes)`);
  }
  if (processed) console.log('');

  if (LIVE) {
    saveCache(CACHE_DOMAIN, domainCache);
    saveCache(CACHE_ABOUT, aboutCache);
    saveCache(CACHE_ENTITY, entityCache);
    saveCache(CACHE_ARTICLE, articleCache);
    saveCache(CACHE_BLITZ, blitzCache);
    await finishSourcingRun(sourcingRunId, { status: stats.errors.length ? 'partial' : 'success', results: stats });
  }

  console.log('\n=== STATS ===');
  console.log(JSON.stringify(stats, null, 2));

  const pushed = stats.total - stats.noEntityExtracted - stats.errors.length;
  await finishRun(runId, { status: stats.errors.length ? 'partial' : 'success', stats: { scraped: stats.total, pushed }, errors: stats.errors });
  console.log('=== DONE ===');
  return stats;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error(e); process.exit(1); });
}
