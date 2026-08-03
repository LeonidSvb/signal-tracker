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

function resolveHiringTemplateKey(pubDate: string | null, activeHiringCount: number, jobTitle: string | undefined): string {
  if (activeHiringCount >= 2) return 'HIRING_SURGE';
  const ageDays = pubDate ? (Date.now() - new Date(pubDate).getTime()) / 86_400_000 : 0;
  if (ageDays > 60) return 'HIRING_STALE';
  return TOP_BAND_RE.test(normTitleForExecCheck(jobTitle)) ? 'HIRING_EXEC' : 'HIRING_MID';
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
    rank?: number | null; vars?: Record<string, string>; liVariant?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { signalType, pubDate = null, jobTitle = null, activeHiringCount = 0, rank = null, vars = {}, liVariant } = body;
  if (!signalType) return NextResponse.json({ error: 'signalType is required' }, { status: 400 });

  // signals.signal_type is only ever the coarse 'HIRING' in the DB — resolve to the real
  // EXEC/MID/STALE/SURGE template key it actually maps to (see resolveHiringTemplateKey's
  // header comment for the live bug this fixes).
  const resolvedKey = signalType === 'HIRING' ? resolveHiringTemplateKey(pubDate, activeHiringCount, jobTitle ?? undefined) : signalType;

  let templates: any;
  try {
    templates = JSON.parse(readFileSync(TEMPLATES_PATH, 'utf8'));
  } catch (e: any) {
    return NextResponse.json({ error: `could not read copy_templates.json: ${e.message}` }, { status: 500 });
  }

  const t = templates.templates?.[resolvedKey];
  if (!t) return NextResponse.json({ error: `unknown signalType: ${resolvedKey}` }, { status: 404 });

  let liBlock: { li_connection_note?: string; li_first_message?: string };
  if (t.li_connection_note !== undefined) {
    liBlock = t;
  } else {
    const key = liVariant || 'li_variant_1_appointee';
    liBlock = t[key] || {};
  }

  const availableLetters = Object.keys(t.variants || {});
  const variantUsed = variantForRank(rank, availableLetters);

  return NextResponse.json({
    connect: fillPlaceholders(liBlock.li_connection_note, vars),
    qualify: fillPlaceholders(liBlock.li_first_message, vars),
    variantUsed,
    requiredVariables: t.required_variables || [],
  });
}
