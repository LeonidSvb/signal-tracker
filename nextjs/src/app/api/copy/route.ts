import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';

// Server-side cache (generated_copy table, migration 010) — 2026-08-17: this route
// was calling the LLM on EVERY contact-row open (7-13s each with the real prompt
// shape), with nothing persisted — same fact regenerated, paid for, and waited on
// again every page reload. The AI text is grounded in the COMPANY's fact, not the
// individual contact ({first_name} is filled in client-side, see ContactRow's
// activeText()), so one row per (company, channel, li_mode, fact) serves every
// contact at that company forever, until the underlying signal changes fact_hash.
const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, { db: { schema: 'signal_monitoring' } })
  : null;

function factHash(resolvedKey: string, fact: string, hookContext: string): string {
  return createHash('md5').update(`${resolvedKey}|${fact}|${hookContext}`).digest('hex');
}

// Real LinkedIn outreach copy for the frontend's per-contact Outreach panel
// (Stage 6, docs/HANDOFF_2026-07-19_frontend_build.md). Reads
// pipeline/config/copy_templates.json directly — plain JSON, safe to
// readFileSync at request time (unlike copyEngine.mjs itself: that's a .mjs
// module resolving paths via import.meta.url, which breaks once Next.js
// bundles it — same reasoning as /api/translate's build note). This route
// duplicates only the trivial parts of copyEngine.mjs's fill() (variant
// selection by rank, {placeholder} substitution, CLEVEL's two-variant
// li_ shape) — no LLM call here, this is pure template fill, not translation.
//
// IMPORTANT finding from Stage 3 (see ADR-009 D4, TODO.txt): the real
// LinkedIn playbook (v2, 2026-07-17) has NO step-3/follow-up script — "any
// reply routes to Leo, Philippe sends connection note + first message ONLY."
// This route therefore only ever returns `connect` (li_connection_note) and
// `qualify` (li_first_message) — never a "propose a call" message. The
// mockup's old `meeting` status copy was never backed by real data; the
// frontend's Outreach panel shows an honest note instead of calling this
// route for that state.

const TEMPLATES_PATH = join(process.cwd(), '../pipeline/config/copy_templates.json');
const EXAMPLES_PATH = join(process.cwd(), '../pipeline/config/copy_examples.json');

// AI hook+bridge (2026-08-03) — this route used to be pure static template fill ("no LLM
// call here" was the original design). Found live: HIRING_SURGE's static li_connection_note
// still has unfilled {role_1}/{role_2} (same class of bug MA/EXPAND/INVEST/CONTRACT had
// with {acquirer}/{target}/{location}, fixed everywhere else 2026-08-02/03) — this was the
// ONE place left generating that broken text, because it never got the AI treatment. Ported
// from pipeline/lib/copyEngine.mjs's generateHookBridge()/buildLinkedInCopy() — can't import
// the .mjs pipeline module directly here (see this file's own top note on why). Falls back
// to the static template below if fact is missing, OPENROUTER_KEY isn't set, or generation
// fails — never blocks the panel from showing SOMETHING.
const OPENROUTER_KEY = process.env.OPENROUTER_KEY;
// Model swap 2026-08-17: gpt-oss-120b measured 7-13s per call with this route's real
// prompt shape (5 live timed runs via OpenRouter, CoreWeave/DeepInfra backends) — with
// the generated_copy cache above that only hits once per company/channel/mode, but the
// FIRST hit (or any cache miss after a signal changes) still felt broken at that
// latency. gpt-4o-mini measured 1-3s on the same prompts AND — unlike
// meta-llama/llama-3.3-70b-instruct, also tested — preserves proper-noun capitalization
// (company/person names), which llama consistently lowercased (the exact class of bug
// capitalizeName() in helpers.ts fixes for scraped contact names — must not reintroduce
// it via the AI copy itself).
const HOOK_MODEL = 'openai/gpt-4o-mini';
const HOOK_TEMPERATURE = 0.45;
const HOOK_BANNED_PHRASES = [
  'clearly prioritizing', 'ideal time', 'perfect time', "let's discuss", 'leverage',
  'seasoned', 'boasts', 'exciting', "here's how", 'game-chang', 'unlock', 'synerg', 'thrilled',
];

async function generateHookBridge(company: string, fact: string, context: string): Promise<{ hook: string; bridge: string } | null> {
  if (!OPENROUTER_KEY || !fact) return null;
  const prompt = `You write TWO connected lines for a cold outreach email opener, in a casual "hey {first_name}, saw/noticed ..." voice. NOT corporate, NOT congratulatory, NOT a compliment — just a plain factual observation a person would actually notice and mention.

Company: ${company}
Real fact: "${fact}"${context ? `\nAdditional real context: ${context}` : ''}

hook: starts lowercase "saw..." or "noticed...", states the SPECIFIC real fact (numbers, names, locations, role titles). If the fact involves MULTIPLE items (several job openings, several outlets, etc.), name AT MOST ONE as a concrete anchor plus a general count ("...alongside a handful of others") — do NOT list every single one, that reads as if you catalogued their page. 12-22 words.
bridge: ONE sentence connecting that fact to a GENERAL, near-universally-true reason this TYPE of situation creates hiring need. Use ONLY the general mechanism (growth/investment -> needs more leaders to run it; M&A/ownership change -> integration needs leadership; new CEO/leadership appointment -> reshuffle below, NEVER "to align with their vision/agenda" — you don't know what they want; long-open search -> current approach may not be working). Do NOT invent a specific role, department, motive, or reason beyond that general mechanism. 10-18 words.

Rules:
- BANNED words/phrases: ${HOOK_BANNED_PHRASES.join(', ')}, "congrat*", any compliment/celebration framing.
- bridge must NEVER mention "exec search", "someone I know", "I know someone", recruiting, placing, hiring services, or Philippe — that sentence is added separately AFTER yours by a different part of the system.
- No exclamation marks, no emoji, no em-dashes (—) — use a plain hyphen (-) or a period if you need a break.
- Do NOT include "hey {first_name}" or any greeting in hook — start directly with the fact.
- Respond with ONLY a JSON object of the exact shape {"hook": "...", "bridge": "..."} — nothing else, no markdown fences.`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENROUTER_KEY}` },
      body: JSON.stringify({
        model: HOOK_MODEL, temperature: HOOK_TEMPERATURE,
        response_format: { type: 'json_object' }, // 2026-08-17: gpt-4o-mini doesn't reliably keep hook/bridge
        // on two separate newline-delimited lines the way gpt-oss-120b did — found live, every real call was
        // silently collapsing to the static fallback because the old newline-split parser saw 1 line, not 2.
        // JSON mode removes the ambiguity entirely instead of trying to parse free-form formatting.
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.hook || !parsed.bridge) return null;
    return { hook: String(parsed.hook).trim(), bridge: String(parsed.bridge).trim() };
  } catch {
    return null;
  }
}

function liPositioningLine(marketFocus: string) {
  return `I place food operations leadership, ${marketFocus}.`;
}

function fillPlaceholders(text: string | null | undefined, vars: Record<string, string>): string | null {
  if (!text) return null;
  return text.replace(/\{(\w+)\}/g, (match, key) => (vars[key] !== undefined ? vars[key] : match));
}

function variantForRank(rank: number | null, availableLetters: string[]): string | null {
  const r = rank ?? 5;
  const preferred = r >= 7 ? 'A' : r >= 5 ? 'B' : 'C';
  if (availableLetters.includes(preferred)) return preferred;
  for (const letter of ['A', 'B', 'C']) if (availableLetters.includes(letter)) return letter;
  return availableLetters[0] ?? null;
}

// Ported from pipeline/lib/eventGrouping.mjs's classifyEvent()/hiringExecBand() — can't
// import the .mjs pipeline module directly here (see this file's own top note on why).
// Found live 2026-08-03: signals.signal_type in the DB is only ever the coarse 'HIRING',
// never a real key in copy_templates.json (only EXEC/MID/STALE/SURGE/RECRUITER exist) —
// this route 404'd on every single HIRING lead (>half of real signal volume), and the
// frontend's ContactRow silently rendered an empty "READY TO SEND" box on that 404 with
// no visible error. Same bug class already fixed in route_email.mjs and
// build_linkedin_queue.mjs; this was the third, independent copy of the routing logic.
const TOP_BAND_RE = /\b(ceo|chief executive(?: officer)?|gf|gesch(?:a|ae)ftsf(?:u|ue)hrer(?:in)?|managing director|md|dg|directeur general(?:e)?|directrice generale|pdg|pr(?:a|e|ae)sident directeur|algemeen directeur|general manager)\b/;

function normTitleForExecCheck(s: string | null | undefined): string {
  const ACCENT_MAP: Record<string, string> = { 'é':'e','è':'e','ê':'e','ë':'e','à':'a','â':'a','ü':'u','ö':'o','ä':'a','ß':'ss','ç':'c','û':'u','î':'i','ï':'i','ô':'o','œ':'oe','æ':'ae','ø':'o','å':'a' };
  return String(s || '').toLowerCase()
    .replace(/[éèêëàâüöäßçûîïôœæøå]/g, (c) => ACCENT_MAP[c] || c)
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// hookContext mirrors route_email.mjs/build_linkedin_queue.mjs's own surge/stale strings —
// same real-fact grounding fed to generateHookBridge() below, not duplicated by the caller.
function resolveHiringTemplateKey(pubDate: string | null, activeHiringCount: number, jobTitle: string | undefined): { templateKey: string; hookContext: string } {
  if (activeHiringCount >= 2) {
    return { templateKey: 'HIRING_SURGE', hookContext: `there are ${activeHiringCount} distinct senior roles open at this company right now` };
  }
  const ageDays = pubDate ? (Date.now() - new Date(pubDate).getTime()) / 86_400_000 : 0;
  if (ageDays > 60) {
    return { templateKey: 'HIRING_STALE', hookContext: pubDate ? `this exact posting has been open for about ${Math.floor(ageDays)} days` : '' };
  }
  return { templateKey: TOP_BAND_RE.test(normTitleForExecCheck(jobTitle)) ? 'HIRING_EXEC' : 'HIRING_MID', hookContext: '' };
}

// GET — raw templates for the Settings > Templates panel (Stage 7). No fill,
// no variant selection: just the live copy_templates.json content, so that
// page is a true read-only mirror of the file the pipeline actually reads.
// `examples` (2026-08-03) — one PRE-GENERATED real AI hook+bridge example per signal type
// (pipeline/config/copy_examples.json), so the panel can show what actually gets sent
// alongside the static skeleton, without spending an LLM call on every page load. See that
// file's own _meta note for how/when to regenerate it.
export async function GET() {
  try {
    const templates = JSON.parse(readFileSync(TEMPLATES_PATH, 'utf8'));
    let examples = null;
    try { examples = JSON.parse(readFileSync(EXAMPLES_PATH, 'utf8')).examples; } catch { /* optional */ }
    return NextResponse.json({ ...templates, examples });
  } catch (e: any) {
    return NextResponse.json({ error: `could not read copy_templates.json: ${e.message}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: {
    signalType?: string; pubDate?: string | null; jobTitle?: string | null; activeHiringCount?: number;
    fact?: string | null; hookContext?: string;
    rank?: number | null; vars?: Record<string, string>; liVariant?: string;
    channel?: 'linkedin' | 'email';
    companyId?: string | null; // cache key — see generated_copy note above
    clientId?: string | null;
    // liMode (2026-08-17): per-CONTACT choice, not a client-wide config — LinkedIn
    // sometimes disables the note field (weekly invite limits), and not every contact
    // has Open Profile/accepts InMail. 'inmail' skips the connect/accept step entirely,
    // same shape as the email channel (initial/followup/replyQualify + subject) since
    // there's no "wait for accept" concept once you're messaging directly.
    liMode?: 'connect_note' | 'connect_no_note' | 'inmail';
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { signalType, pubDate = null, jobTitle = null, activeHiringCount = 0, fact = null, rank = null, vars = {}, liVariant, channel = 'linkedin', liMode = 'connect_note', companyId = null, clientId = null } = body;
  if (!signalType) return NextResponse.json({ error: 'signalType is required' }, { status: 400 });
  const isDirectMessage = channel === 'email' || liMode === 'inmail'; // no connect/accept gate — one message per stage
  const liModeKey = channel === 'linkedin' ? liMode : 'na';

  // signals.signal_type is only ever the coarse 'HIRING' in the DB — resolve to the real
  // EXEC/MID/STALE/SURGE template key it actually maps to (see resolveHiringTemplateKey's
  // header comment for the live bug this fixes).
  const isHiring = signalType === 'HIRING';
  const hiringResolved = isHiring ? resolveHiringTemplateKey(pubDate, activeHiringCount, jobTitle ?? undefined) : null;
  const resolvedKey = hiringResolved ? hiringResolved.templateKey : signalType;
  const hookContext = hiringResolved ? hiringResolved.hookContext : '';

  let templates: any;
  try {
    templates = JSON.parse(readFileSync(TEMPLATES_PATH, 'utf8'));
  } catch (e: any) {
    return NextResponse.json({ error: `could not read copy_templates.json: ${e.message}` }, { status: 500 });
  }

  const t = templates.templates?.[resolvedKey];
  if (!t) return NextResponse.json({ error: `unknown signalType: ${resolvedKey}` }, { status: 404 });

  const availableLetters = Object.keys(t.variants || {});
  const variantUsed = variantForRank(rank, availableLetters);

  const RELEVANT_CASE = "I've placed similar roles at comparable food companies in the region.";
  const SUBJECT = templates._meta?.subject_by_lang?.en || 'someone I\'d like to introduce';

  if (fact) {
    const hash = factHash(resolvedKey, fact, hookContext);

    // Cache read — one row per (company, channel, li_mode, fact) serves every contact
    // at that company. {first_name} is stored as a literal placeholder (never baked
    // in), filled client-side by ContactRow's activeText() — see top-of-file note.
    if (companyId && supabaseAdmin) {
      const { data: cached } = await supabaseAdmin
        .from('generated_copy')
        .select('*')
        .eq('company_id', companyId)
        .eq('channel', channel)
        .eq('li_mode', liModeKey)
        .eq('fact_hash', hash)
        .maybeSingle();
      if (cached) {
        return NextResponse.json({
          subject: cached.subject, connect: cached.connect, qualify: cached.qualify,
          initial: cached.initial, followup: cached.followup, replyQualify: cached.reply_qualify,
          variantUsed: cached.variant_used, requiredVariables: t.required_variables || [], source: cached.source, cached: true,
        });
      }
    }

    const generated = await generateHookBridge(vars.company || '', fact, hookContext);
    if (generated) {
      // company/market_focus filled, first_name deliberately NOT — see cache note above.
      const companyVars = { relevant_case: RELEVANT_CASE, company: vars.company || '', market_focus: vars.market_focus || '' };
      let toCache: Record<string, string | null> = {};

      // Direct message (email, or LinkedIn InMail — 2026-08-17): no connect/accept gate
      // to work around, so hook+bridge+positioning+case go out in ONE opener instead of
      // split across two. Same generateHookBridge() call as the connect-based LinkedIn
      // path — same real fact, same variables — just a different wrapper. followup is a
      // deliberately generic time-based nudge (no fact restated); replyQualify reuses the
      // bridge (not the hook — they've already read it) once they actually reply, mirroring
      // what the connect-based qualify message does at the "replied" stage.
      if (isDirectMessage) {
        const initial = fillPlaceholders(
          `{first_name}, ${generated.hook} - ${liPositioningLine('{market_focus}')}\n\n${generated.bridge}\n\n{relevant_case}\n\nWorth a quick reply?`,
          companyVars
        );
        const followup = `{first_name} — just floating this back up in case it got buried. Still relevant on your end?`;
        const replyQualify = fillPlaceholders(
          `{first_name} — thanks for getting back to me.\n\n${generated.bridge}\n\n{relevant_case}\n\nWorth a quick call this week?`,
          companyVars
        );
        toCache = { subject: SUBJECT, initial, followup, reply_qualify: replyQualify, variant_used: variantUsed, source: 'ai' };
      } else {
        const connect = liMode === 'connect_no_note' ? null
          : fillPlaceholders(`{first_name}, ${generated.hook} - ${liPositioningLine('{market_focus}')} Connect?`, companyVars);
        const qualifyTemplate = liMode === 'connect_no_note'
          ? `{first_name} — appreciate the connect.\n\n${generated.hook} -\n${generated.bridge}\n\n{relevant_case}\n\nWorth a quick chat if useful?`
          : `{first_name} — appreciate the connect.\n\n${generated.bridge}\n\n{relevant_case}\n\nWorth a quick chat if useful?`;
        const qualify = fillPlaceholders(qualifyTemplate, companyVars);
        toCache = { connect, qualify, variant_used: variantUsed, source: 'ai' };
      }

      // Best-effort write — a DB hiccup must never block returning the text that was
      // already generated. ignoreDuplicates covers the rare race of two contacts at the
      // same company opening simultaneously and both missing the cache.
      if (companyId && supabaseAdmin) {
        supabaseAdmin.from('generated_copy')
          .upsert({ client_id: clientId, company_id: companyId, channel, li_mode: liModeKey, fact_hash: hash, ...toCache },
            { onConflict: 'company_id,channel,li_mode,fact_hash', ignoreDuplicates: true })
          .then(() => {}, () => {});
      }

      return NextResponse.json({
        subject: toCache.subject, connect: toCache.connect, qualify: toCache.qualify,
        initial: toCache.initial, followup: toCache.followup, replyQualify: toCache.reply_qualify,
        variantUsed, requiredVariables: t.required_variables || [], source: 'ai',
      });
    }
    // generation failed (no key, network, malformed output) — fall through to static below
  }

  if (isDirectMessage) {
    // Static fallback — reuses the existing Leo-voiced PlusVibe variants (real,
    // already-reviewed copy, just not Philippe's own voice). Acceptable here because
    // this path only fires when AI generation is unavailable/failed — a rare edge
    // case, not the normal flow.
    const variantRaw = t.variants?.[variantUsed as string];
    const variantText = typeof variantRaw === 'string' ? variantRaw : variantRaw?.body;
    const followupRaw = Array.isArray(t.followups) ? t.followups.find((f: any) => f.body)?.body : null;
    return NextResponse.json({
      subject: isDirectMessage ? SUBJECT : undefined,
      initial: fillPlaceholders(variantText, { relevant_case: RELEVANT_CASE, ...vars }),
      followup: fillPlaceholders(followupRaw, vars),
      replyQualify: fillPlaceholders(`{first_name} — thanks for getting back to me.\n\n{relevant_case}\n\nWorth a quick call this week?`, { relevant_case: RELEVANT_CASE, ...vars }),
      variantUsed,
      requiredVariables: t.required_variables || [],
      source: 'static_fallback',
    });
  }

  let liBlock: { li_connection_note?: string; li_first_message?: string };
  if (t.li_connection_note !== undefined) {
    liBlock = t;
  } else {
    const key = liVariant || 'li_variant_1_appointee';
    liBlock = t[key] || {};
  }

  return NextResponse.json({
    connect: fillPlaceholders(liBlock.li_connection_note, vars),
    qualify: fillPlaceholders(liBlock.li_first_message, vars),
    variantUsed,
    requiredVariables: t.required_variables || [],
    source: 'static_fallback',
  });
}
