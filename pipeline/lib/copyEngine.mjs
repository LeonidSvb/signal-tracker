// Fills copy_templates.json (D3, HANDOFF_2026-07-15_scoring_two_channel.md) with
// per-lead variables and picks the right language frame. Per A6/D3: the templates
// themselves are VERBATIM (no rewriting here); the only generative step is ONE LLM
// call per lead to localize/interpolate the signal-fact hook line into fr/de/nl —
// everything else is straight {variable} substitution.
//
// Variant selection by rank (A6): rank >= 7 -> A, 5-7 -> B, else C (falls back to
// the closest variant a template actually has, since some types only ship A/B or
// a single variant).
//
// Language by country (A6): DE/AT/CH -> de, FR/LU -> fr, NL/BE -> nl, else en.

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '../../../../..');

const TEMPLATES = JSON.parse(readFileSync(join(__dir, '../config/copy_templates.json'), 'utf8'));
const TRANSLATIONS = readFileSync(join(__dir, '../../../copy/translations.jsonl'), 'utf8')
  .split('\n').filter(l => l.trim())
  .map(l => JSON.parse(l));
const TRANSLATIONS_BY_LANG = Object.fromEntries(TRANSLATIONS.map(t => [t.lang, t]));

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
loadEnvFile(join(REPO_ROOT, '.env'));

const OPENROUTER_KEY = process.env.OPENROUTER_KEY;
// 2026-07-17 (Leo, after research): swapped from openai/gpt-oss-120b to
// anthropic/claude-sonnet-4.5. Practitioner consensus (HN/r/LocalLLaMA-adjacent
// sources, filtered for SEO-content noise) is that gpt-oss-120b is noticeably
// weaker at natural, tone-preserving DE/FR/NL translation than frontier models —
// it tends to sound literally-translated rather than locally rewritten. At this
// project's volume (50-200 short translations/week) the cost difference is
// negligible ($3/$15 per 1M tokens vs gpt-oss's $0.15/$0.60 — a few cents/week
// either way), so Leo's call: optimize for quality, not cost, here.
const MODEL = 'anthropic/claude-sonnet-4.5';

// Country -> market_focus EN string. Matches translations.jsonl's market_names keys
// (France/Germany/the Netherlands/Belgium/Europe) — no separate "market_focus per
// client config" field exists in pipeline/clients/philippe-bosquillon.json yet, so
// this is derived from the company's country, falling back to "Europe" for
// LU/CH/AT and anything else in the ICP country list.
const COUNTRY_TO_MARKET_EN = {
  DE: 'Germany', FR: 'France', NL: 'the Netherlands', BE: 'Belgium',
  LU: 'Europe', CH: 'Europe', AT: 'Europe',
};

export function marketFocusForCountry(countryCode) {
  return COUNTRY_TO_MARKET_EN[countryCode] || 'Europe';
}

// A6: DE/AT/CH -> de, FR/LU -> fr, NL/BE -> nl, else en.
export function langForCountry(countryCode) {
  if (['DE', 'AT', 'CH'].includes(countryCode)) return 'de';
  if (['FR', 'LU'].includes(countryCode)) return 'fr';
  if (['NL', 'BE'].includes(countryCode)) return 'nl';
  return 'en';
}

// rank 0-10 (A2 formula) -> variant letter, degraded to whatever letters the
// template actually has (HIRING_SURGE/HIRING_STALE/INVEST/CONTRACT don't all ship
// A+B+C).
export function variantForRank(rank, availableLetters) {
  const preferred = rank >= 7 ? 'A' : (rank >= 5 ? 'B' : 'C');
  if (availableLetters.includes(preferred)) return preferred;
  // fall back to the nearest available (A > B > C order, since A is always the
  // strongest angle in the source playbook)
  for (const letter of ['A', 'B', 'C']) {
    if (availableLetters.includes(letter)) return letter;
  }
  return availableLetters[0] || null;
}

export function getTemplate(templateKey) {
  const t = TEMPLATES.templates[templateKey];
  if (!t) throw new Error(`[copyEngine] unknown template key: ${templateKey}`);
  return t;
}

function fillPlaceholders(text, vars) {
  if (!text) return text;
  return text.replace(/\{(\w+)\}/g, (match, key) => (vars[key] !== undefined && vars[key] !== null ? vars[key] : match));
}

function variantBody(variant) {
  return typeof variant === 'string' ? variant : variant.body;
}

// One LLM call: translate/localize ONLY the hook line (the fact-specific opener,
// e.g. "saw {company} is looking for a {exact_job_title}") into the target
// language, using translations.jsonl's phrase-level cheat sheet as grounding so the
// LLM isn't inventing tone from scratch. Returns the EN text unchanged if no
// OPENROUTER_KEY, no translation frame for that language, or lang === 'en'.
// Register-by-country guidance (2026-07-17, per research on B2B outreach norms):
// German business outreach defaults formal (Sie) unless the target's own profile
// signals otherwise; French keeps "vous" for a first cold touch; Dutch business
// culture tolerates a more direct/informal register than DE/FR. Fed to the model
// as an explicit instruction, not left for it to guess.
const REGISTER_BY_LANG = {
  de: 'formal register (Sie, not du) — this is a first cold touch to a senior exec',
  fr: 'formal register (vous, not tu) — this is a first cold touch to a senior exec',
  nl: 'direct, pragmatic register is fine and expected — Dutch business culture reads overly formal phrasing as stiff',
};

async function localizeHookLine(hookLineEn, lang, cacheKey, cache) {
  if (lang === 'en') return hookLineEn;
  if (cache[cacheKey]) return cache[cacheKey];
  const frame = TRANSLATIONS_BY_LANG[lang];
  if (!OPENROUTER_KEY || !frame) return hookLineEn; // no key or no frame — safer to leave EN than invent copy

  const prompt = `Localize (do NOT translate word-for-word) this single cold-outreach opening line from English into natural, native-sounding ${lang.toUpperCase()} for a food-industry executive search message. A native speaker in this industry should read it and not suspect it was translated — rephrase freely to hit the same meaning and tone rather than mapping each word. Register: ${REGISTER_BY_LANG[lang] || 'natural business register'}. Keep it terse, lowercase style (no capital first letter unless a proper noun), same {variable} placeholders untouched exactly as written. Match this project's established phrasing style — for reference here is how this project renders the equivalent connector phrase "saw that": "${frame.saw_equivalent}".

Line: "${hookLineEn}"

Respond with ONLY the localized line, no quotes, no explanation.`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENROUTER_KEY}` },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await res.json();
    const translated = data.choices?.[0]?.message?.content?.trim();
    if (translated) { cache[cacheKey] = translated; return translated; }
  } catch { /* fall through to EN */ }
  return hookLineEn;
}

// Splits a body into [hookLine, ...rest] — the hook line is always the first
// non-empty line per the playbook's own principle ("Первая строка = конкретный
// факт из сигнала"). Only that first line gets localized; the rest of the body's
// boilerplate is left as EN unless a future translations.jsonl frame covers it
// (see _meta note in copy_templates.json — HIRING_* and INVEST/CONTRACT currently
// have no fr/de/nl frames at all, only the exa-signal types do).
function splitHookLine(body) {
  const lines = body.split('\n');
  const idx = lines.findIndex(l => l.trim().length > 0);
  if (idx === -1) return { hook: body, rest: '' };
  return { hook: lines[idx], restLines: lines, hookIdx: idx };
}

async function localizeBody(body, lang, vars, cache) {
  if (!body) return body;
  if (lang === 'en') return fillPlaceholders(body, vars);
  const { hook, restLines, hookIdx } = splitHookLine(body);
  const filledHook = fillPlaceholders(hook, vars);
  const cacheKey = `${lang}::${hook}`;
  const localizedHook = await localizeHookLine(filledHook, lang, cacheKey, cache);
  const out = [...restLines];
  out[hookIdx] = localizedHook;
  return fillPlaceholders(out.join('\n'), vars);
}

// fill({templateKey, variant?, rank?, lang, vars, hookCache?})
// -> { subject_line, body_1, body_2..N (followups in order), li_connection_note,
//      li_first_message, variantUsed, lang, missingFollowups: [...] }
// hookCache: pass a shared object across a batch run to avoid re-translating an
// identical hook line for two leads at the same company/event (persist it to disk
// per stage the same way exa/cache/*.json caches work if you want it durable).
// CLEVEL ships two LinkedIn variants (write to the appointee vs write to HR/CEO
// nearby, copy_signals_linkedin.txt БЛОК 2) instead of one flat li_connection_note
// — every other template has the flat shape. liVariant selects which for CLEVEL,
// ignored elsewhere.
function resolveLinkedinCopy(t, liVariant) {
  if (t.li_connection_note !== undefined) {
    return { li_connection_note: t.li_connection_note, li_first_message: t.li_first_message };
  }
  const key = liVariant || 'li_variant_1_appointee';
  const block = t[key];
  if (!block) return { li_connection_note: null, li_first_message: null };
  return { li_connection_note: block.li_connection_note, li_first_message: block.li_first_message };
}

export async function fill({ templateKey, variant = null, rank = null, lang = 'en', vars = {}, hookCache = {}, liVariant = null }) {
  const t = getTemplate(templateKey);
  const availableLetters = Object.keys(t.variants || {});
  const chosenLetter = variant || variantForRank(rank ?? 5, availableLetters);
  const chosenVariant = t.variants[chosenLetter];
  if (!chosenVariant) throw new Error(`[copyEngine] template ${templateKey} has no variant ${chosenLetter}`);

  // {relevant_case} (2026-07-17, Leo) — a credibility line ideally picked by
  // Philippe/Leo per prospect (a real comparable placement, a story specific to
  // that company/region). NOT required though — if nothing specific comes to
  // mind, FALLBACK_RELEVANT_CASE below is honest and safe to send as-is (no
  // invented specifics, no "30 years" boilerplate). usedFallbackCase on the
  // return value lets callers (e.g. build_linkedin_queue.mjs's HTML export) flag
  // which rows are still on the generic fallback, so it's visible — not silent —
  // when a targeted line would likely convert better.
  const FALLBACK_RELEVANT_CASE = "I've placed similar roles at comparable food companies in the region.";
  const usedFallbackCase = vars.relevant_case === undefined || vars.relevant_case === null || vars.relevant_case === '';
  const filledVars = {
    market_focus: vars.market_focus,
    relevant_case: usedFallbackCase ? FALLBACK_RELEVANT_CASE : vars.relevant_case,
    ...vars,
  };

  const day0Body = await localizeBody(variantBody(chosenVariant), lang, filledVars, hookCache);

  const followupBodies = [];
  const missingFollowups = [];
  for (const step of t.followups || []) {
    if (!step.body) { missingFollowups.push({ day: step.day, note: step.note || 'no body in playbook' }); continue; }
    followupBodies.push({ day: step.day, breakup: !!step.breakup, body: await localizeBody(step.body, lang, filledVars, hookCache) });
  }

  const subjectLine = TEMPLATES._meta.subject_by_lang[lang] || TEMPLATES._meta.subject_by_lang.en;
  const li = resolveLinkedinCopy(t, liVariant);

  return {
    templateKey,
    variantUsed: chosenLetter,
    lang,
    subject_line: subjectLine,
    body_1: day0Body,
    followups: followupBodies,
    missingFollowups,
    li_connection_note: li.li_connection_note ? fillPlaceholders(li.li_connection_note, filledVars) : null,
    li_first_message: li.li_first_message ? fillPlaceholders(li.li_first_message, filledVars) : null,
    requiredVariables: t.required_variables || [],
    usedFallbackCase,
  };
}
