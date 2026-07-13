#!/usr/bin/env node
// Score passed_icp raw_signals (rule-based) + LLM angle.
// Creates signal records in signals table. Skips already-processed signals.
// Run: node --env-file=nextjs/.env.local pipeline/stages/05_score_llm.mjs

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { selectAll, insert, patch } from '../lib/supabase.mjs';
import { getClientId, startRun, finishRun } from '../lib/log.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';
const CONCURRENCY = 10;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Load OPENROUTER_KEY from root .env ────────────────────────────────────────
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

const OPENROUTER_KEY = process.env.OPENROUTER_KEY;
const MODEL = 'openai/gpt-oss-120b';

// ── Name matching (same as stage 03) ─────────────────────────────────────────
const ACCENT_MAP = { é:'e',è:'e',ê:'e',ë:'e',à:'a',â:'a',ü:'u',ö:'o',ä:'a',ß:'ss',ç:'c',û:'u',î:'i',ï:'i',ô:'o',œ:'oe',æ:'ae',ø:'o',å:'a' };
function norm(s) {
  return String(s||'').toLowerCase()
    .replace(/[éèêëàâüöäßçûîïôœæøå]/g, c => ACCENT_MAP[c]||c)
    .replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
}
const STRIP = /\b(gmbh|ag|sa|nv|bv|srl|ltd|inc|corp|llc|sas|snc|ohg|kg|og|se|plc|co|cie|group|gruppe|holding|services|international|deutschland|france)\b/g;
function coreName(s) { return norm(s).replace(STRIP,' ').replace(/\s+/g,' ').trim().split(' ').slice(0,3).join(' '); }
function fuzzy(a,b) { const ca=coreName(a),cb=coreName(b); return !!(ca&&cb&&(ca===cb||ca.includes(cb)||cb.includes(ca))); }

function resolveCompany(companyName, linkedinUrl, companies) {
  if (linkedinUrl) {
    const byUrl = companies.find(c => c.linkedin_url === linkedinUrl);
    if (byUrl) return byUrl;
  }
  const byExact = companies.find(c => norm(c.name) === norm(companyName));
  if (byExact) return byExact;
  return companies.find(c => fuzzy(companyName, c.name)) || null;
}

// ── Scoring ───────────────────────────────────────────────────────────────────
const EXEC_HIGH = /ceo|chief executive|managing director|geschäftsführer|directeur g[eé]n[eé]ral|g[eé]rant|general manager|plant manager|werksleiter|directeur usine|pdg|président directeur/i;
const EXEC_MED  = /hr director|drh|directeur des ressources humaines|personalleiter|chro|chief human resources|chief people|operations director|commercial director|coo|cfo|directeur des opérations/i;
const EXEC_LOW  = /head of hr|head of people|vp |vice president|director|directeur|leiter|directrice|responsable/i;

function execScore(title) {
  if (!title) return 1;
  if (EXEC_HIGH.test(title)) return 5;
  if (EXEC_MED.test(title))  return 4;
  if (EXEC_LOW.test(title))  return 2;
  return 1;
}

function freshScore(pubDate) {
  if (!pubDate) return 0;
  const days = (Date.now() - new Date(pubDate).getTime()) / 86_400_000;
  if (days <= 7)  return 3;
  if (days <= 14) return 2;
  if (days <= 30) return 1;
  return 0;
}

// News scoring bonus by signal_type — matches PRD's intended weighting (Sec. "Scoring формула"):
// MA/CLEVEL are the strongest buy signals, EXPAND/INVEST next, the rest (CONTRACT/NICHE/SECTOR)
// still worth a base bump for being a real news hit at all.
function newsTypeScore(signalType) {
  if (signalType === 'MA' || signalType === 'CLEVEL')   return 3;
  if (signalType === 'EXPAND' || signalType === 'INVEST') return 2;
  return 1;
}

// exec-keyword regex (execScore) only makes sense against a job-posting TITLE (e.g. "Plant
// Manager — Neuburg site"). News headlines ("Rauch übernimmt Kloster Kitchen") almost never
// contain an exec-level keyword, so every Exa signal was silently scoring ~1-4/10 regardless of
// how strong the story actually was — found 2026-07-13, fixed by branching on source_type instead
// of running the same regex over both.
function calcScore(signal, multiSignalBonus = 0) {
  if (signal.source_type === 'news') {
    const signalType = (signal.raw_data?.signal_type || 'NICHE').toUpperCase();
    return Math.min(10, 1 + freshScore(signal.pub_date) + newsTypeScore(signalType) + multiSignalBonus);
  }
  const title = signal.raw_data?.title || signal.raw_data?.positionName || '';
  return Math.min(10, execScore(title) + freshScore(signal.pub_date));
}

function calcExpires(signal) {
  const base = signal.pub_date ? new Date(signal.pub_date) : new Date();
  const days = signal.source_type === 'news' ? 30 : 90;
  return new Date(base.getTime() + days * 86_400_000).toISOString();
}

function daysAgo(pubDate) {
  if (!pubDate) return null;
  return Math.round((Date.now() - new Date(pubDate).getTime()) / 86_400_000);
}

// ── LLM angle ─────────────────────────────────────────────────────────────────
async function generateAngle(signal, companyName, country) {
  if (!OPENROUTER_KEY) return null;
  const title  = signal.raw_data?.title || signal.raw_data?.positionName || 'senior role';
  const source = signal.source;
  const prompt = `Philippe Bosquillon is a food industry executive search specialist with 30+ years as a food executive himself. He places senior roles (GM, Plant Manager, HR Director, Commercial Director) at food companies in DE/FR/NL/BE.

Signal: ${companyName} (${country || '?'}) posted "${title}" on ${source}
Published: ${signal.pub_date || 'recently'}

Write ONE sentence outreach angle for Philippe reaching out to this company. Be specific about the role and timing. No fluff.`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_KEY}` },
      body:    JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch { return null; }
}

function parseJsonLoose(text) {
  if (!text) return null;
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

// News signals never carry a structured company_name (Exa returns a headline, not an entity —
// see docs/EXA_INTEGRATION.md) — found 2026-07-13: every Exa signal's company_name was landing
// null, so resolveCompany() was searching against '' and 03_resolve_companies.mjs was skipping
// them outright (`if (!name) continue`). One LLM call now extracts the company name AND writes
// the angle at the same time, since both need the same headline anyway.
async function extractCompanyAndAngle(signal, country) {
  const title = signal.raw_data?.title || '';
  if (!OPENROUTER_KEY || !title) return { companyName: '', angle: null };

  const prompt = `Philippe Bosquillon is a food industry executive search specialist with 30+ years as a food executive himself. He places senior roles (GM, Plant Manager, HR Director, Commercial Director) at food companies in DE/FR/NL/BE.

News headline: "${title}"
Country: ${country || 'unknown'}
Published: ${signal.pub_date || 'recently'}
Signal category: ${(signal.raw_data?.signal_type || 'NICHE')}

Respond with ONLY a JSON object, no other text: {"company": "<the single food/beverage company this news is primarily about, exact name as it would appear in a business database>", "angle": "<one sentence outreach angle for Philippe reaching out to this company, specific about the event and timing, no fluff>"}`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_KEY}` },
      body:    JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await res.json();
    const parsed = parseJsonLoose(data.choices?.[0]?.message?.content?.trim());
    return { companyName: parsed?.company || '', angle: parsed?.angle || null };
  } catch { return { companyName: '', angle: null }; }
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function run() {
  console.log('\n=== 05_score_llm.mjs ===');
  const clientId = await getClientId(CLIENT_SLUG);
  const runId    = await startRun({ clientId, script: '05_score_llm', source: 'llm_scoring' });

  const rawSignals = await selectAll('raw_signals', { client_id: clientId, status: 'passed_icp' });
  console.log(`passed_icp signals: ${rawSignals.length}`);

  const existingSignals = await selectAll('signals', { client_id: clientId });
  const processedIds    = new Set(existingSignals.filter(s => s.raw_signal_id).map(s => s.raw_signal_id));
  console.log(`already processed: ${processedIds.size}`);

  const toProcess = rawSignals.filter(s => !processedIds.has(s.id));
  console.log(`to score: ${toProcess.length}`);

  if (!toProcess.length) {
    await finishRun(runId, { status: 'success', stats: { scraped: 0, pushed: 0 } });
    console.log('nothing to process — DONE');
    return { pushed: 0 };
  }

  const companies = await selectAll('companies', { client_id: clientId });

  const existingState    = await selectAll('app_state', { client_id: clientId });
  const stateCompanyIds  = new Set(existingState.map(s => s.company_id));
  const newCompanyIds    = new Set();

  // Multi-signal bonus (PRD: "+2 если у компании 2+ сигналов") — only computable now that
  // migration 004 preserves one raw_signals row per (monitor, url) instead of collapsing
  // cross-monitor duplicates to whichever arrived first. Built from what's already in memory
  // (rawSignals, this run's full passed_icp set), no extra query needed.
  const monitorsByUrl = new Map();
  for (const s of rawSignals) {
    if (s.source !== 'exa' || !s.source_url) continue;
    const set = monitorsByUrl.get(s.source_url) || new Set();
    set.add(s.monitor_label);
    monitorsByUrl.set(s.source_url, set);
  }
  function multiSignalBonus(s) {
    if (s.source !== 'exa') return 0;
    const set = monitorsByUrl.get(s.source_url);
    return set && set.size > 1 ? 2 : 0;
  }

  const signalRows   = [];
  const appStateRows = [];
  const companyNameUpdates = []; // raw_signals.company_name backfill, so future runs skip re-extracting

  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    const batch = toProcess.slice(i, i + CONCURRENCY);

    // Step 1 — LLM calls run concurrently (I/O bound, no shared state touched here).
    const analyzed = await Promise.all(batch.map(async s => {
      const isNews = s.source_type === 'news';
      const knownName = s.company_name || s.raw_data?.companyName || '';

      let companyName = knownName;
      let angle = null;
      if (isNews && !knownName) {
        const extracted = await extractCompanyAndAngle(s, s.country);
        companyName = extracted.companyName;
        angle = extracted.angle;
      } else {
        angle = await generateAngle(s, companyName, s.country);
      }

      return { s, companyName, angle };
    }));

    // Step 2 — company resolution/creation runs sequentially so two signals in the same batch
    // that both discover the same brand-new company don't race and create two stub rows for it.
    for (const { s, companyName, angle } of analyzed) {
      const linkedinUrl = s.raw_data?.companyLinkedinUrl || null;
      let company = resolveCompany(companyName, linkedinUrl, companies);

      if (!company && companyName) {
        const [created] = await insert('companies', [{
          client_id: clientId, name: companyName, hq_country: s.country || null,
        }]);
        if (created) { companies.push(created); company = created; }
      }

      if (companyName && companyName !== (s.company_name || '')) {
        companyNameUpdates.push({ id: s.id, company_name: companyName });
      }

      const score = calcScore(s, multiSignalBonus(s));
      const title = s.raw_data?.title || s.raw_data?.positionName || null;
      const signalType = s.source_type === 'news'
        ? ((s.raw_data?.signal_type || 'NICHE').toUpperCase())
        : 'HIRING';

      signalRows.push({
        client_id:      clientId,
        company_id:     company?.id || null,
        raw_signal_id:  s.id,
        signal_type:    signalType,
        title,
        source:         s.source,
        source_url:     s.source_url,
        pub_date:       s.pub_date,
        days_ago:       daysAgo(s.pub_date),
        country:        s.country,
        score,
        freshness_score: freshScore(s.pub_date),
        status:         'active',
        expires_at:     calcExpires(s),
        narrative:      null,
        angle,
      });

      const companyId = company?.id || null;
      if (companyId && !stateCompanyIds.has(companyId) && !newCompanyIds.has(companyId)) {
        newCompanyIds.add(companyId);
        appStateRows.push({ client_id: clientId, company_id: companyId, status: 'new', updated_by: 'leo' });
      }
    }

    process.stdout.write(`\r  ${Math.min(i + CONCURRENCY, toProcess.length)}/${toProcess.length} scored`);
    await sleep(200);
  }
  console.log('');

  if (companyNameUpdates.length) {
    for (const { id, company_name } of companyNameUpdates) {
      await patch('raw_signals', 'id', [id], { company_name });
    }
    console.log(`raw_signals.company_name backfilled: ${companyNameUpdates.length}`);
  }

  const inserted = await insert('signals', signalRows);
  console.log(`signals created: ${inserted.length}`);

  if (appStateRows.length) {
    const stateIns = await insert('app_state', appStateRows, 'client_id,company_id');
    console.log(`app_state created: ${stateIns.length}`);
  }

  await finishRun(runId, { status: 'success', stats: { scraped: toProcess.length, pushed: inserted.length } });
  console.log('=== DONE ===');
  return { pushed: inserted.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error(e); process.exit(1); });
}
