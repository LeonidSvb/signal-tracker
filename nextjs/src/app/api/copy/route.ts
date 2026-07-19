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

// GET — raw templates for the Settings > Templates panel (Stage 7). No fill,
// no variant selection: just the live copy_templates.json content, so that
// page is a true read-only mirror of the file the pipeline actually reads.
export async function GET() {
  try {
    const templates = JSON.parse(readFileSync(TEMPLATES_PATH, 'utf8'));
    return NextResponse.json(templates);
  } catch (e: any) {
    return NextResponse.json({ error: `could not read copy_templates.json: ${e.message}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: { signalType?: string; rank?: number | null; vars?: Record<string, string>; liVariant?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { signalType, rank = null, vars = {}, liVariant } = body;
  if (!signalType) return NextResponse.json({ error: 'signalType is required' }, { status: 400 });

  let templates: any;
  try {
    templates = JSON.parse(readFileSync(TEMPLATES_PATH, 'utf8'));
  } catch (e: any) {
    return NextResponse.json({ error: `could not read copy_templates.json: ${e.message}` }, { status: 500 });
  }

  const t = templates.templates?.[signalType];
  if (!t) return NextResponse.json({ error: `unknown signalType: ${signalType}` }, { status: 404 });

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
