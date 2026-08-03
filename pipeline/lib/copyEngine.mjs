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
import { createHash } from 'crypto';
import { fetchRetry } from './httpRetry.mjs';

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
// Hook/bridge generation is on gpt-oss-120b (same model as the rest of this pipeline's
// classification/scoring LLM calls, already proven adequate for this in a live 27-case
// A/B test 2026-08-02) — the sonnet-4.5 swap above was specifically about translation
// quality, not English generation quality.
const HOOK_MODEL = 'openai/gpt-oss-120b';
// Temperatures per Reply Agent's proven split (server/modules/reply-agent/followup/
// generation.ts, 2026-08-02 context) — LOCALIZE_TEMPERATURE=0.2 for faithful translation
// (low variance, don't improvise), FOLLOW_UP_TEMPERATURE=0.45 for constrained creative
// generation (some room to phrase naturally, but not wandering). Neither localize
// function here had an explicit temperature before — defaulted to whatever OpenRouter's
// per-model default is, unset.
const LOCALIZE_TEMPERATURE = 0.2;
const HOOK_TEMPERATURE = 0.45;

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

// Found live 2026-08-03/04: market_focus was always the EN string above, filled into
// filledVars and substituted AFTER translation (fillPlaceholders runs post-localizeMessage
// everywhere in this file, by design — see buildLinkedInCopy's own comment on why fill-after
// is required) — so a DE/FR/NL message read fine except for one stray English "Germany"/
// "Europe" sitting mid-sentence. translations.jsonl already ships real localized market
// names (market_names, per-lang) — this was simply never wired to actually use them. Same
// reasoning gives FALLBACK_LOCALIZED_RELEVANT_CASE below: the generic {relevant_case}
// fallback (used whenever nobody's hand-picked one) was English-only and, like market_focus,
// got substituted after translation — the ONE other place a translated message could end up
// mixed-language. Hand-translated once (a fixed sentence, not worth an LLM call per send)
// rather than run through localizeMessage() at request time.
export function localizeMarketFocus(marketFocusEn, lang) {
  if (lang === 'en') return marketFocusEn;
  return TRANSLATIONS_BY_LANG[lang]?.market_names?.[marketFocusEn] || marketFocusEn;
}

const FALLBACK_RELEVANT_CASE_BY_LANG = {
  en: "I've placed similar roles at comparable food companies in the region.",
  de: 'Ich habe ähnliche Positionen bei vergleichbaren Lebensmittelunternehmen in der Region besetzt.',
  fr: "J'ai placé des profils similaires dans des entreprises alimentaires comparables de la région.",
  nl: 'Ik heb vergelijkbare functies ingevuld bij soortgelijke voedingsbedrijven in de regio.',
};

// Casual display name for a company in email body text — real names come straight from
// Blitz/Exa as either ALL CAPS ("ACP ATLANTIQUE") or with a legal suffix ("Dmk Deutsches
// Milchkontor Gmbh"), found live 2026-08-02 while reviewing real mockups. Word-length
// heuristic on the caps-fix: words <=4 chars are left as-is (likely a real acronym like
// "DMK"/"ACP"), longer all-caps words get title-cased (likely just shouty formatting,
// not an intentional acronym) — imperfect but safer than guessing which specific letters
// are an acronym. Legal-suffix stripping is a fixed word list, not heuristic.
const LEGAL_SUFFIX_RE = /[,]?\s*\b(gmbh(?:\s*&?\s*co\.?\s*kg)?|ag|s\.?a\.?(?:r\.?l\.?)?|nv|bv|srl|ltd\.?|inc\.?(?:orporated)?|corp\.?(?:oration)?|llc|sas|snc|ohg|se|plc|cie|holding)\.?\s*$/i;

function smartCaseWord(w) {
  const letters = w.replace(/[^A-Za-z]/g, '');
  if (letters.length > 0 && letters.length <= 4 && w === w.toUpperCase()) return w;
  return w.replace(/\p{L}+/gu, seg => seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase());
}

export function casualCompanyName(name) {
  if (!name) return name;
  let out = name.trim();
  if (out === out.toUpperCase() && /[A-Za-z]/.test(out)) {
    out = out.split(' ').map(smartCaseWord).join(' ');
  }
  out = out.replace(LEGAL_SUFFIX_RE, '').trim();
  return out || name; // never return an empty string
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
    const res = await fetchRetry('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENROUTER_KEY}` },
      body: JSON.stringify({ model: MODEL, temperature: LOCALIZE_TEMPERATURE, messages: [{ role: 'user', content: prompt }] }),
    }, { timeoutMs: 60_000 });
    const data = await res.json();
    const translated = data.choices?.[0]?.message?.content?.trim();
    if (translated) { cache[cacheKey] = translated; return translated; }
  } catch { /* fall through to EN — a raw fetch() with no timeout here used to be able
    to hang the caller forever (same bug class fixed 2026-08-02 in score_signals.mjs) */ }
  return hookLineEn;
}

// hashCacheKey — sibling of the literal `${lang}::${hook}` key used above, but for
// localizeMessage()'s FULL-message cache (D5, docs/adr/009-frontend-v2-concept.md):
// "cache key = hash(text+lang) so identical step text across different
// events/companies dedupes automatically rather than keying on (event+step+lang)".
// A literal `${lang}::${text}` key would work identically for lookups (no collision
// risk either way) but a full LinkedIn message can run to several hundred characters
// — hashing keeps the cache file/object's keys short and stable-length regardless of
// message length, and matches the exact mechanism the ADR specifies.
export function hashCacheKey(text, lang) {
  return createHash('sha256').update(`${lang}::${text}`).digest('hex').slice(0, 24);
}

// localizeMessage — sibling of localizeHookLine() (D5). localizeHookLine() is
// prompt-shaped specifically for ONE short opening line (lowercase, terse); this
// handles a FULL multi-line message (LinkedIn first-message body, email follow-up
// body, etc.) — preserves line breaks, {placeholder} tokens, and literal bracketed
// tokens like [Calendly link] untouched (translated verbatim would break the
// frontend's later placeholder-fill step, which matches on the literal bracket
// text). Same REGISTER_BY_LANG map as localizeHookLine, same safe-fallback rule
// (no key/frame/lang==='en' -> return the EN text unchanged, never invent copy).
export async function localizeMessage(textEn, lang, cache = {}) {
  if (lang === 'en') return textEn;
  const cacheKey = hashCacheKey(textEn, lang);
  if (cache[cacheKey]) return cache[cacheKey];
  const frame = TRANSLATIONS_BY_LANG[lang];
  if (!OPENROUTER_KEY || !frame) return textEn;

  const prompt = `Localize (do NOT translate word-for-word) this full cold-outreach message from English into natural, native-sounding ${lang.toUpperCase()} for a food-industry executive search message. A native speaker in this industry should read it and not suspect it was translated — rephrase freely to hit the same meaning and tone rather than mapping each word. Register: ${REGISTER_BY_LANG[lang] || 'natural business register'}. Match this project's established phrasing style — for reference here is how this project renders the equivalent connector phrase "saw that": "${frame.saw_equivalent}".

Preserve EXACTLY, character-for-character, unchanged:
- Every {variable} placeholder (e.g. {first_name}, {company}) — do not translate or reword the text inside the braces.
- Every literal bracketed token like [Calendly link] — leave the brackets and the exact text inside them untouched.
- The line-break structure — same number of lines, blank lines in the same places.

Message:
"""
${textEn}
"""

Respond with ONLY the localized message, no quotes, no explanation, no extra commentary before or after.`;

  try {
    const res = await fetchRetry('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENROUTER_KEY}` },
      body: JSON.stringify({ model: MODEL, temperature: LOCALIZE_TEMPERATURE, messages: [{ role: 'user', content: prompt }] }),
    }, { timeoutMs: 60_000 });
    const data = await res.json();
    const translated = data.choices?.[0]?.message?.content?.trim();
    if (translated) { cache[cacheKey] = translated; return translated; }
  } catch { /* fall through to EN */ }
  return textEn;
}

// ── AI hook+bridge generation (2026-08-02) ──────────────────────────────────────
// Replaces the old static {variable}-filled opening line. Built after a real 27-case
// A/B test (Leo, 2026-08-02) found the static approach was flat-out BROKEN for
// MA/EXPAND/INVEST/CONTRACT — those templates reference {acquirer}/{target}/{location}/
// {project} vars route_email.mjs never filled, so real sends would have contained
// literal unfilled "{...}" text. Also covers NICHE/SECTOR (no template existed at all)
// and HIRING_* uniformly (Leo's call: one code path for every signal type, not a
// hardcode/AI split by type).
//
// Every rule below is a direct fix for a real failure mode hit during testing, not
// speculative hardening:
//   - banned corporate clichés — signals.angle (this project's older LLM-generated
//     field) reads exactly like this ("clearly prioritizing", "ideal time to connect
//     top talent") and Leo already flagged that same failure mode on the July LinkedIn
//     copy rewrite (ADR-005).
//   - no invented motive/reason beyond the general mechanism — model kept inventing
//     unstated specifics ("to align with the incoming CEO's vision", "to meet growing
//     production demands") that read as presumptuous guesses, not facts, if wrong.
//   - hook must not enumerate every item for HIRING_SURGE-shaped facts (multiple roles/
//     events) — naming all of them read like the company's careers page had been
//     catalogued, which felt invasive; caps at one named example + a general count.
//   - explicit ban on echoing "hey {first_name}" or "I know someone/exec search" inside
//     the generated text — that's the FIXED skeleton wrapped around this by the caller,
//     the model kept trying to write it itself.
const HOOK_BANNED_PHRASES = [
  'clearly prioritizing', 'ideal time', 'perfect time', "let's discuss", 'leverage',
  'seasoned', 'boasts', 'exciting', "here's how", 'game-chang', 'unlock', 'synerg', 'thrilled',
];

// context: free-text hint the CALLER builds from real per-type data it already has —
// e.g. "this exact role has been open 65 days" (HIRING_STALE), "4 other senior roles are
// also open right now" (HIRING_SURGE). Optional; omit for the common single-fact case.
export async function generateHookBridge({ company, fact, context = '', cacheKey, cache = {} }) {
  const key = cacheKey || `hookbridge::${company}::${fact}::${context}`;
  if (cache[key]) return cache[key];
  if (!OPENROUTER_KEY || !fact) return null; // caller falls back to a safe generic line

  const prompt = `You write TWO connected lines for a cold outreach email opener, in a casual "hey {first_name}, saw/noticed ..." voice. NOT corporate, NOT congratulatory, NOT a compliment — just a plain factual observation a person would actually notice and mention.

Company: ${company}
Real fact: "${fact}"${context ? `\nAdditional real context: ${context}` : ''}

Line 1 (hook): starts lowercase "saw..." or "noticed...", states the SPECIFIC real fact (numbers, names, locations, role titles). If the fact involves MULTIPLE items (several job openings, several outlets, etc.), name AT MOST ONE as a concrete anchor plus a general count ("...alongside a handful of others") — do NOT list every single one, that reads as if you catalogued their page. 12-22 words.
Line 2 (bridge): ONE sentence connecting that fact to a GENERAL, near-universally-true reason this TYPE of situation creates hiring need. Use ONLY the general mechanism (growth/investment -> needs more leaders to run it; M&A/ownership change -> integration needs leadership; new CEO/leadership appointment -> reshuffle below, NEVER "to align with their vision/agenda" — you don't know what they want; long-open search -> current approach may not be working). Do NOT invent a specific role, department, motive, or reason beyond that general mechanism. 10-18 words.

Rules:
- BANNED words/phrases: ${HOOK_BANNED_PHRASES.join(', ')}, "congrat*", any compliment/celebration framing.
- Line 2 must NEVER mention "exec search", "someone I know", "I know someone", recruiting, placing, hiring services, or Philippe — that sentence is added separately AFTER yours by a different part of the system.
- No exclamation marks, no emoji, no em-dashes (—) — use a plain hyphen (-) or a period if you need a break.
- Do NOT include "hey {first_name}" or any greeting — start directly with the hook.
- Output ONLY: line 1, then line 2, separated by a newline. Nothing else.`;

  try {
    const res = await fetchRetry('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENROUTER_KEY}` },
      body: JSON.stringify({ model: HOOK_MODEL, temperature: HOOK_TEMPERATURE, messages: [{ role: 'user', content: prompt }] }),
    }, { timeoutMs: 60_000 });
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return null; // malformed — caller falls back rather than send a 1-line fragment
    const result = { hook: lines[0], bridge: lines[1] };
    cache[key] = result;
    return result;
  } catch {
    return null; // caller falls back to a safe generic line rather than fail the whole email
  }
}

// Fixed offer+CTA closing, standardized across every signal type 2026-08-02 (Leo's
// call) — previously HIRING_* templates folded the "someone I know does exec search"
// offer INTO their hardcoded bridge sentence, while MA/CLEVEL/EXPAND/INVEST/CONTRACT
// had it as a separate paragraph. Now every type gets the same structure: AI hook+bridge,
// then this fixed connector-framing close. Keeps the "Leo = connector, Philippe not named
// in email 1" principle (copy_broad.txt's own framing rule) — untouched by the AI step.
export function offerCtaLine(marketFocus) {
  return `I know someone who specifically does exec search for food companies in ${marketFocus} - places senior roles in 2-3 weeks.\n\nworth an intro?`;
}

// ── LinkedIn AI hook+bridge (2026-08-03) ────────────────────────────────────────
// Reuses generateHookBridge() as-is (same prompt, same fact, same cache key as the
// email day0Body) — only the WRAPPING skeleton differs, for two real reasons:
//   1. li_connection_note has LinkedIn's own ~300-char platform cap — a full hook+bridge
//      pair (email gets both lines) doesn't reliably fit once name/positioning/CTA are
//      added, so the connection note gets HOOK ONLY. li_first_message (sent after accept,
//      no cap) gets the full pair, same as email.
//   2. Voice: email's offerCtaLine() is Leo-as-connector framing ("I know someone who...",
//      copy_broad.txt's rule that Philippe is never named in email 1). LinkedIn messages
//      go out from Philippe's OWN account — every hand-written li_* template already
//      speaks in his first person ("I place food execs..."), so the AI version keeps that
//      voice rather than reusing the email wrapper verbatim.
// Found live 2026-08-03: without this, MA/EXPAND/INVEST/CONTRACT li_connection_note/
// li_first_message sent literal unfilled "{acquirer}"/"{target}"/"{location}" text (188
// occurrences in that day's real queue) — the exact same unfilled-{variable} bug class the
// email side already fixed 2026-08-02, just never ported to the LinkedIn path until now.
function liPositioningLine(marketFocus) {
  return `I place food operations leadership, ${marketFocus}.`;
}

// noteMode ('with_note' default | 'no_note') — copy_templates.json's own _meta already
// flagged this as a planned A/B ("if accept rate with a note drops, send without one")
// but it was never wired into generation until 2026-08-03, found live: the connection
// note's hook line and the first message's opening line were IDENTICAL verbatim text —
// fine if no note was sent (first message is the recipient's first exposure to the fact),
// but reads as an obvious copy-paste when they've just read that exact sentence seconds
// earlier in the connect request. 'with_note': first message opens with the BRIDGE only
// (assumes the note already delivered the fact) and li_connection_note is populated.
// 'no_note': li_connection_note is null (nothing sent at connect time) and first message
// keeps the full hook+bridge — their only exposure to the fact.
async function buildLinkedInCopy({ t, filledVars, hookCache, company, fact, hookContext, lang, liVariant, noteMode = 'with_note' }) {
  if (fact) {
    const cacheKey = `hookbridge::${filledVars.market_focus}::${company}::${fact}::${hookContext}`;
    const generated = await generateHookBridge({ company, fact, context: hookContext, cacheKey, cache: hookCache });
    if (generated) {
      // Translate BEFORE filling {first_name}/{market_focus}/{relevant_case} — NOT after,
      // same order buildDay0Body() already uses for email. Found live 2026-08-03 building
      // this: filling first, then localizing, occasionally made the model hallucinate
      // "{first_name}" back into the DE/FR/NL output — localizeMessage()'s own prompt tells
      // it to preserve "{first_name}" placeholders verbatim (with that literal name as the
      // example), and it sometimes over-applied that to the ALREADY-substituted real name,
      // reverting "Anna" back to the placeholder token. Translating while the tokens are
      // still real {placeholders} (never a bare name) and filling only after removes the
      // ambiguity entirely.
      const connectionTemplate = `{first_name}, ${generated.hook} - ${liPositioningLine('{market_focus}')} Connect?`;
      const firstMsgTemplate = noteMode === 'no_note'
        ? `{first_name} — appreciate the connect.\n\n${generated.hook} -\n${generated.bridge}\n\n{relevant_case}\n\nWorth a quick chat if useful?`
        : `{first_name} — appreciate the connect.\n\n${generated.bridge}\n\n{relevant_case}\n\nWorth a quick chat if useful?`;
      const connectionLocalized = lang === 'en' ? connectionTemplate : await localizeMessage(connectionTemplate, lang, hookCache);
      const firstMsgLocalized = lang === 'en' ? firstMsgTemplate : await localizeMessage(firstMsgTemplate, lang, hookCache);
      const connectionOut = fillPlaceholders(connectionLocalized, filledVars);
      const firstMsgOut = fillPlaceholders(firstMsgLocalized, filledVars);
      if (connectionOut.length > 300) {
        console.log(`[copyEngine] WARN li_connection_note over LinkedIn's 300-char cap (${connectionOut.length} chars) for ${company} — review before sending`);
      }
      return { li_connection_note: noteMode === 'no_note' ? null : connectionOut, li_first_message: firstMsgOut };
    }
    // generation failed (no key, malformed output, network) — fall through to legacy static
  }
  const li = resolveLinkedinCopy(t, liVariant);
  return {
    li_connection_note: li.li_connection_note ? fillPlaceholders(li.li_connection_note, filledVars) : null,
    li_first_message: li.li_first_message ? fillPlaceholders(li.li_first_message, filledVars) : null,
  };
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

// fact/hookContext (2026-08-02): when fact is provided, body_1's opening gets the AI
// hook+bridge treatment (generateHookBridge) instead of the old hardcoded/{variable}
// opening — see that function's header for the full "why" (fixes the unfilled-{variable}
// bug in MA/EXPAND/INVEST/CONTRACT, covers NICHE/SECTOR which had no template at all,
// applied uniformly to every type per Leo's call). Falls back to the legacy static
// template body if fact is omitted, generation fails, or there's no OPENROUTER_KEY —
// never blocks on this, a slightly-generic email beats none at all.
async function buildDay0Body({ t, chosenVariant, lang, filledVars, hookCache, company, fact, hookContext }) {
  if (fact) {
    const cacheKey = `hookbridge::${filledVars.market_focus}::${company}::${fact}::${hookContext}`;
    const generated = await generateHookBridge({ company, fact, context: hookContext, cacheKey, cache: hookCache });
    if (generated) {
      // Hook and bridge stay on separate lines (matches every hand-written template's
      // own line-break style, and the real mockups Leo reviewed/approved 2026-08-02) —
      // NOT joined into one run-on line.
      const englishLine = `${generated.hook} -\n${generated.bridge}`;
      // localizeMessage(), not localizeHookLine() — the latter is prompt-shaped for
      // exactly ONE line, this is two (hook + bridge) and needs the line-break structure
      // preserved, which is localizeMessage()'s own explicit guarantee.
      const localizedLine = lang === 'en' ? englishLine : await localizeMessage(englishLine, lang, hookCache);
      const offer = fillPlaceholders(offerCtaLine('{market_focus}'), filledVars);
      return fillPlaceholders(`hey {first_name},\n\n${localizedLine}\n\n${offer}`, filledVars);
    }
    // generation failed (no key, malformed output, network) — fall through to legacy static body
  }
  return localizeBody(variantBody(chosenVariant), lang, filledVars, hookCache);
}

// skipEmailBody (2026-08-03): build_linkedin_queue.mjs only ever reads the li_* fields —
// computing body_1/followups for it was pure waste (an extra static fillPlaceholders call
// plus, once fact-driven generation is live for it too, would've been a second unwanted
// LLM path). true skips day0Body + followups entirely; li_* generation is unaffected
// either way (buildLinkedInCopy runs independently, sharing generateHookBridge's cache key
// with any email-side call for the same company+fact+context in the SAME fill() call).
export async function fill({ templateKey, variant = null, rank = null, lang = 'en', vars = {}, hookCache = {}, liVariant = null, fact = null, hookContext = '', skipEmailBody = false, noteMode = 'with_note' }) {
  const t = getTemplate(templateKey);
  const availableLetters = Object.keys(t.variants || {});
  const chosenLetter = variant || variantForRank(rank ?? 5, availableLetters);
  const chosenVariant = t.variants?.[chosenLetter];
  if (!chosenVariant && !fact && !skipEmailBody) throw new Error(`[copyEngine] template ${templateKey} has no variant ${chosenLetter}`);

  // {relevant_case} (2026-07-17, Leo) — a credibility line ideally picked by
  // Philippe/Leo per prospect (a real comparable placement, a story specific to
  // that company/region). NOT required though — if nothing specific comes to
  // mind, FALLBACK_RELEVANT_CASE below is honest and safe to send as-is (no
  // invented specifics, no "30 years" boilerplate). usedFallbackCase on the
  // return value lets callers (e.g. build_linkedin_queue.mjs's HTML export) flag
  // which rows are still on the generic fallback, so it's visible — not silent —
  // when a targeted line would likely convert better.
  const usedFallbackCase = vars.relevant_case === undefined || vars.relevant_case === null || vars.relevant_case === '';
  const filledVars = {
    ...vars,
    market_focus: localizeMarketFocus(vars.market_focus, lang),
    relevant_case: usedFallbackCase ? (FALLBACK_RELEVANT_CASE_BY_LANG[lang] || FALLBACK_RELEVANT_CASE_BY_LANG.en) : vars.relevant_case,
  };

  const day0Body = skipEmailBody ? null : await buildDay0Body({ t, chosenVariant, lang, filledVars, hookCache, company: vars.company, fact, hookContext });

  const followupBodies = [];
  const missingFollowups = [];
  if (!skipEmailBody) {
    for (const step of t.followups || []) {
      if (!step.body) { missingFollowups.push({ day: step.day, note: step.note || 'no body in playbook' }); continue; }
      followupBodies.push({ day: step.day, breakup: !!step.breakup, body: await localizeBody(step.body, lang, filledVars, hookCache) });
    }
  }

  const subjectLine = TEMPLATES._meta.subject_by_lang[lang] || TEMPLATES._meta.subject_by_lang.en;
  const li = await buildLinkedInCopy({ t, filledVars, hookCache, company: vars.company, fact, hookContext, lang, liVariant, noteMode });

  return {
    templateKey,
    variantUsed: chosenLetter,
    lang,
    subject_line: subjectLine,
    body_1: day0Body,
    followups: followupBodies,
    missingFollowups,
    li_connection_note: li.li_connection_note,
    li_first_message: li.li_first_message,
    requiredVariables: t.required_variables || [],
    usedFallbackCase,
  };
}
