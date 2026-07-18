// Two LLM calls used by the resolution cascade:
//   extractEntities — reads a news headline, returns EVERY company mentioned + role +
//     a provisional primary_target guess. Replaces the old single-name extractCompanyAndAngle:
//     53% of real Exa headlines name 2+ companies (measured 2026-07-15 across 320 signals),
//     so picking "the" name blindly was already silently wrong that often. Since the
//     2026-07-15 resolve-all redesign the primary_target here is only a HINT (candidate
//     ordering) — the real choice happens in classifyCompany below, with data in hand.
//   classifyCompany — THE single decision path (Q1+Q4 merge, 2026-07-15): given ALL
//     candidates from a signal, each already resolved (Blitz real LinkedIn data when
//     available, Exa about-text as fallback, or nothing), one call both picks the outreach
//     target and screens it against the ICP. Replaces the two divergent classifiers that
//     used to exist (deterministicClassify's hard numeric employee cutoff in blitzEnrich.mjs
//     — the Grolsch bug lived there — and the old classifyIcp that only ever saw about-text).
//     Leo's standing direction: no hard numeric cutoffs anywhere, AI judges always, data is
//     context; bias permissive when uncertain (false positives are reviewed by hand later,
//     false negatives are lost forever). Also flags entity_mismatch when the fetched page
//     describes a different entity than the news (found in testing: "Bleu-Blanc-Coeur Milk"
//     -> bleu-blanc-coeur.org, an association, not a producer).

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { fetchRetry } from './httpRetry.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));

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

const ICP_CFG = JSON.parse(readFileSync(join(__dir, '../config/icp_filter.json'), 'utf8'));

const ACCENT_MAP = { é:'e',è:'e',ê:'e',ë:'e',à:'a',â:'a',ü:'u',ö:'o',ä:'a',ß:'ss',ç:'c',û:'u',î:'i',ï:'i',ô:'o',œ:'oe',æ:'ae',ø:'o',å:'a' };
function norm(s) { return String(s||'').toLowerCase().replace(/[éèêëàâüöäßçûîïôœæøå]/g,c=>ACCENT_MAP[c]||c).replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); }

// Categorical exclusion (staffing/catering/exec-search), not a numeric cutoff — the one check
// that stays deterministic: it's a curated list, free, and saves an LLM call per hit.
export function blacklistHit(name) {
  const n = norm(name);
  return ICP_CFG.company_blacklist.find(b => n.includes(norm(b))) || null;
}

function parseJsonLoose(text) {
  if (!text) return null;
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

async function callLLM(prompt) {
  const res = await fetchRetry('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENROUTER_KEY}` },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

export async function extractEntities(signal, country, articleText = null) {
  if (!OPENROUTER_KEY) return null;
  const title = signal.raw_data?.title || '';
  if (!title) return null;

  const sourceBlock = articleText
    ? `News headline: "${title}"\nFull article text (headline alone didn't name a company — use this instead):\n"""\n${articleText.slice(0, 1500)}\n"""`
    : `News headline: "${title}"`;

  const prompt = `Philippe Bosquillon is a food industry executive search specialist with 30+ years as a food executive himself. He places senior roles (GM, Plant Manager, HR Director, Commercial Director) at food companies in DE/FR/NL/BE/LU/CH/AT, 50-10,000 employees.

${sourceBlock}
Country: ${country || 'unknown'}
Published: ${signal.pub_date || 'recently'}
Signal category: ${(signal.raw_data?.signal_type || 'NICHE')}

This may mention MORE THAN ONE company (e.g. an acquirer and a target, two partners in a
deal, or a certification body alongside the actual producer). List every distinct company/entity
named, then decide which ONE (if any) is the real outreach target for executive search.

Apply this heuristic, in order, and explain which rule you used in target_reasoning:
1. Never pick a label, industry association, or certification body (e.g. a "quality mark"
   collective) — it isn't a company. If both sides are non-company entities, primary_target=null.
2. If one side is a small brand being fully absorbed into a much larger group (brand discontinued,
   no independent operations going forward), it no longer needs its own executive team — prefer
   the OTHER side.
3. Otherwise, for most acquisitions prefer the ACQUIRER: buying another company is a growth/
   integration signal and the classic trigger for hiring a plant director, GM, or ops lead to run
   the newly expanded operation.
4. Exception to rule 3: if the acquirer is a very large multinational (thousands of employees,
   its own internal recruiting) and this deal is minor for them, they are not a realistic outreach
   target. In that case check whether the acquired company keeps some operational autonomy (its
   own site/brand/leadership) — if yes, target that company instead; if the brand is fully
   absorbed, primary_target=null.
5. For non-M&A signals (single company: leadership change, new plant, funding raised) there is
   usually exactly one real target — pick it.
6. Never list the news publisher/media outlet itself (e.g. a magazine or trade-press name) as a
   company in the "companies" list — it's the source reporting the story, not a party to it.

Respond with ONLY a JSON object, no other text:
{
  "companies": [{"name": "<exact name>", "role": "acquirer|target|partner|certifier_or_association|investor|other"}],
  "primary_target": "<exact name of the ONE company to pursue, or null if none qualifies>",
  "target_reasoning": "<one sentence — why this one, or why none qualifies>",
  "needs_review": <true if genuinely ambiguous between 2+ plausible targets, else false>,
  "angle": "<one sentence outreach angle for Philippe reaching out to primary_target, specific about the event and timing, no fluff — null if primary_target is null>"
}`;

  const text = await callLLM(prompt);
  const parsed = parseJsonLoose(text);
  if (!parsed) return null;
  return {
    companies: Array.isArray(parsed.companies) ? parsed.companies : [],
    primaryTarget: parsed.primary_target || null,
    targetReasoning: parsed.target_reasoning || null,
    needsReview: !!parsed.needs_review,
    angle: parsed.angle || null,
  };
}

// One evidence block per candidate, rendered for the prompt. evidence.via says what data
// exists: 'blitz' (real LinkedIn company data — strongest), 'sourcing' (our own TAM DB),
// 'exa_about' (a web page from the resolved domain — weakest, may be the wrong entity),
// 'none' (domain never resolved).
function renderCandidate(c, idx) {
  const lines = [`${idx + 1}. "${c.name}"${c.role ? ` (role in the news: ${c.role})` : ''}${c.domain ? ` — domain: ${c.domain}` : ' — NO DOMAIN COULD BE RESOLVED'}`];
  const ev = c.evidence || { via: 'none' };
  if (ev.via === 'blitz') {
    const b = ev.blitz;
    lines.push(`   REAL LinkedIn company data (reliable):`);
    lines.push(`   - LinkedIn page name: "${b.linkedinCompanyName || 'n/a'}"`);
    lines.push(`   - Size bracket: ${b.size || 'n/a'} (LinkedIn's estimate of real total headcount — PRIMARY size signal)`);
    lines.push(`   - Members on LinkedIn: ${b.employeesOnLinkedin ?? 'n/a'} (systematically UNDERCOUNTS — production/blue-collar staff rarely register; corroborating only, never let it override the size bracket)`);
    lines.push(`   - Industry: ${b.industry || 'n/a'}`);
    lines.push(`   - HQ country: ${b.hqCountry || 'unknown'}`);
    if (b.about) lines.push(`   - About: """${String(b.about).slice(0, 600)}"""`);
  } else if (ev.via === 'sourcing') {
    lines.push(`   Already in our own TAM database: employees ${ev.employees ?? 'n/a'}, industry ${ev.industry || 'n/a'}, HQ country ${ev.hqCountry || 'unknown'}${ev.priorIcpStatus && ev.priorIcpStatus !== 'unscored' ? `; prior ICP screen: ${ev.priorIcpStatus} ("${ev.priorIcpReason || 'no reason recorded'}")` : '; not yet ICP-screened'}`);
    if (ev.about) lines.push(`   About: """${String(ev.about).slice(0, 600)}"""`);
  } else if (ev.via === 'exa_about') {
    lines.push(`   Web page found on that domain (title: "${ev.aboutTitle || 'n/a'}") — weaker evidence, the page may describe a DIFFERENT entity than the news is about:`);
    lines.push(`   """${(ev.aboutText || '(no text found)').slice(0, 800)}"""`);
    if (ev.blitzNameMismatch) lines.push(`   WARNING: a LinkedIn lookup of this domain returned a company named "${ev.blitzNameMismatch}" — if that name is unrelated to "${c.name}", the domain resolution itself is probably wrong (entity_mismatch).`);
  } else {
    lines.push(`   No data found for this company.`);
  }
  return lines.join('\n');
}

// THE single classify/select decision. candidates = [{name, role, domain, evidence}], 1..N.
// With N=1 it's a pure ICP screen; with N>1 it also picks the outreach target — with real
// data in hand, unlike the blind headline-only guess extractEntities used to make final.
// Q6 in signals/TODO.txt: two different outlets covering the same real event ("Schouten Europe
// neemt Bobeldijk over" vs "Schouten Europe buys plant-based peer Bobeldijk") have different
// headlines, so the exact-title dedup in classify_company.mjs never catches them — each pays for
// its own extraction and can independently pick a different primary_target for the same event.
// This is the cheap pre-check: one call per CANDIDATE cluster (headlines that share enough words
// to be worth asking about), not per pair, so it doesn't multiply cost back up.
export async function sameEvent(headlines) {
  if (!OPENROUTER_KEY) return null;
  if (headlines.length < 2) return { sameEvent: true, groups: [headlines.map((_, i) => i)] };

  const prompt = `These news headlines were published around the same time and share enough words to possibly be about the same real-world event (e.g. the same acquisition, hire, or plant opening reported by different outlets in different languages).

${headlines.map((h, i) => `${i + 1}. "${h}"`).join('\n')}

Group the headline NUMBERS that describe the SAME real-world event together. Headlines about genuinely different events (even if they share a company name) go in separate groups.

Respond with ONLY a JSON object: {"groups": [[1,2], [3]]} — an array of arrays of 1-based headline numbers, covering every headline exactly once.`;

  const text = await callLLM(prompt);
  const parsed = parseJsonLoose(text);
  if (!parsed?.groups) return null;
  return { groups: parsed.groups };
}

export async function classifyCompany({ headline = null, signalType = null, country = null, pubDate = null, candidates }) {
  if (!OPENROUTER_KEY) return null;
  if (!candidates?.length) return null;
  const multi = candidates.length > 1;

  const contextBlock = headline
    ? `News signal: "${headline}"
Signal category: ${signalType || 'unknown'} | Country context: ${country || 'unknown'} | Published: ${pubDate || 'recently'}`
    : `No news context — this is a re-screen of an already-known company against fresh LinkedIn data.`;

  // Employee-count guidance per Leo's explicit 2026-07-15 direction: a hard numeric cutoff is
  // the wrong tool — a small food-industry startup can easily afford an €80K+/year senior hire
  // (Dry4Good, an INVEST signal, was wrongly rejected under the old flat rule). Merges the tone
  // of clients/philippe-bosquillon/prompts/icp_check_v3_small.txt (50-200) and
  // icp_check_v4_micro.txt (15-50) into one graduated judgment for EVERY signal type.
  // Deliberate bias: false positives are cheap (human review before outreach), false negatives
  // are forever. When genuinely uncertain, lean pass.
  const screenBlock = `${multi ? 'TASK 2 — screen the chosen company' : 'TASK — screen this company'} against the target market:
- Industry: food/beverage operations (${ICP_CFG.industry_keywords.slice(0, 12).join(', ')}, and similar). Adjacent B2B suppliers INTO the food industry (ingredients, food-grade packaging, food processing equipment) count as in-market; generic companies that merely sell to everyone do not.
- Geography: target region is ${ICP_CFG.countries.join('/')}. A company headquartered OUTSIDE these countries is out of market — UNLESS this very signal is about it building, buying, or expanding operations INSIDE the region (a US group opening a plant in Germany will need local executives — that is in-market). Trust the LinkedIn HQ country over guesses from page text.
- Size: employee count is a WEAK signal, not a hard cutoff — never reject just because a number looks small or is missing. What matters: does this look like a real, professional B2B operation that could plausibly afford a senior hire (€70-90K+/year: GM, Plant Manager, HR Director, Commercial Director)? A 20-person company that just raised funding, is building a plant, or clearly runs real commercial operations can justify that budget — in-range. Reject on size only for: a genuine micro/lifestyle business, a non-operating entity (holding shell, fund, association), or a company clearly over ~10,000 employees (multinationals run internal recruiting).
- EXCLUDE always: staffing/recruiting agencies, catering/facilities-services conglomerates (Sodexo, Compass Group, Elior, Sysco, Aramark and similar), executive search firms.
- entity_mismatch: if a candidate's only evidence is a web page and that page clearly describes a DIFFERENT entity than the news (an association, a retailer, an unrelated company on a coincidental domain), set entity_mismatch=true and do not trust that page's content.
- When truly uncertain either way, prefer "pass" over "reject" — a human reviews the shortlist before outreach, so borderline extras cost nothing; a wrongly rejected real target is gone for good. Use "needs_website" when there is no usable evidence at all.`;

  const selectionBlock = multi ? `TASK 1 — choose the ONE company to pursue. All candidates below were named in the same news; real data has been fetched for each. Rules, in order:
1. Never choose a label, industry association, certification body, investment fund, or media outlet — not companies to recruit for. If every candidate is one of these, chosen_company = null.
2. For acquisitions prefer the ACQUIRER (integration/growth = the classic trigger for hiring a plant director, GM, or ops lead) — UNLESS the data shows the acquirer is a very large multinational (thousands of employees: internal recruiting, unrealistic target); then prefer the acquired company if it keeps operational autonomy, else null.
3. A small brand being fully absorbed (no independent operations going forward) will not need its own executive team — prefer the other side.
4. Between two otherwise-plausible targets, prefer the one with real data. But if the genuinely correct target simply has no data, still choose it (its icp_status will be "needs_website").
` : '';

  const prompt = `You are working for Philippe Bosquillon, a food industry executive search specialist with 30+ years as a food executive himself. He places senior roles (GM, Plant Manager, HR Director, Commercial Director) at food companies in ${ICP_CFG.countries.join('/')}.

${contextBlock}

CANDIDATE${multi ? 'S' : ''}:
${candidates.map(renderCandidate).join('\n')}

${selectionBlock}${screenBlock}

Respond with ONLY a JSON object, no other text:
{"chosen_company": "<exact candidate name${multi ? ', or null if none qualifies' : ''}>", "chosen_reasoning": "<one sentence — why this one / why none>", "icp_status": "pass|reject|needs_website", "icp_reason": "<one sentence>", "entity_mismatch": true|false, "needs_review": ${multi ? '<true if genuinely ambiguous between 2+ plausible targets, else false>' : 'false'}, "employees_estimate": <int or null — best estimate of real total headcount from the evidence>}`;

  const text = await callLLM(prompt);
  const parsed = parseJsonLoose(text);
  if (!parsed) return null;
  return {
    chosenName: parsed.chosen_company || null,
    chosenReasoning: parsed.chosen_reasoning || null,
    icpStatus: ['pass', 'reject', 'needs_website'].includes(parsed.icp_status) ? parsed.icp_status : 'needs_website',
    icpReason: parsed.icp_reason || null,
    entityMismatch: !!parsed.entity_mismatch,
    needsReview: !!parsed.needs_review,
    employeesEstimate: Number.isFinite(parsed.employees_estimate) ? parsed.employees_estimate : null,
  };
}
