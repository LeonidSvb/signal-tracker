import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

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
const CLIENT_CONFIG_PATH = join(process.cwd(), '../pipeline/clients/philippe-bosquillon.json');

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
const HOOK_MODEL = 'openai/gpt-oss-120b';
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

Line 1 (hook): starts lowercase "saw..." or "noticed...", states the SPECIFIC real fact (numbers, names, locations, role titles). If the fact involves MULTIPLE items (several job openings, several outlets, etc.), name AT MOST ONE as a concrete anchor plus a general count ("...alongside a handful of others") — do NOT list every single one, that reads as if you catalogued their page. 12-22 words.
Line 2 (bridge): ONE sentence connecting that fact to a GENERAL, near-universally-true reason this TYPE of situation creates hiring need. Use ONLY the general mechanism (growth/investment -> needs more leaders to run it; M&A/ownership change -> integration needs leadership; new CEO/leadership appointment -> reshuffle below, NEVER "to align with their vision/agenda" — you don't know what they want; long-open search -> current approach may not be working). Do NOT invent a specific role, department, motive, or reason beyond that general mechanism. 10-18 words.

Rules:
- BANNED words/phrases: ${HOOK_BANNED_PHRASES.join(', ')}, "congrat*", any compliment/celebration framing.
- Line 2 must NEVER mention "exec search", "someone I know", "I know someone", recruiting, placing, hiring services, or Philippe — that sentence is added separately AFTER yours by a different part of the system.
- No exclamation marks, no emoji, no em-dashes (—) — use a plain hyphen (-) or a period if you need a break.
- Do NOT include "hey {first_name}" or any greeting — start directly with the hook.
- Output ONLY: line 1, then line 2, separated by a newline. Nothing else.`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENROUTER_KEY}` },
      body: JSON.stringify({ model: HOOK_MODEL, temperature: HOOK_TEMPERATURE, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;
    const lines = raw.split('\n').map((l: string) => l.trim()).filter(Boolean);
    if (lines.length < 2) return null;
    return { hook: lines[0], bridge: lines[1] };
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
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { signalType, pubDate = null, jobTitle = null, activeHiringCount = 0, fact = null, rank = null, vars = {}, liVariant } = body;
  if (!signalType) return NextResponse.json({ error: 'signalType is required' }, { status: 400 });

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

  if (fact) {
    const generated = await generateHookBridge(vars.company || '', fact, hookContext);
    if (generated) {
      let noteMode = 'with_note';
      try { noteMode = JSON.parse(readFileSync(CLIENT_CONFIG_PATH, 'utf8')).linkedin?.connection_note_mode || 'with_note'; } catch { /* default */ }
      const connect = noteMode === 'no_note' ? null
        : fillPlaceholders(`{first_name}, ${generated.hook} - ${liPositioningLine('{market_focus}')} Connect?`, vars);
      const qualifyTemplate = noteMode === 'no_note'
        ? `{first_name} — appreciate the connect.\n\n${generated.hook} -\n${generated.bridge}\n\n{relevant_case}\n\nWorth a quick chat if useful?`
        : `{first_name} — appreciate the connect.\n\n${generated.bridge}\n\n{relevant_case}\n\nWorth a quick chat if useful?`;
      const qualify = fillPlaceholders(qualifyTemplate, { relevant_case: "I've placed similar roles at comparable food companies in the region.", ...vars });
      return NextResponse.json({ connect, qualify, variantUsed, requiredVariables: t.required_variables || [], source: 'ai' });
    }
    // generation failed (no key, network, malformed output) — fall through to static below
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
