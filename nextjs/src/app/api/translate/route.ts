import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';

// On-demand message translation (D5 in docs/adr/009-frontend-v2-concept.md; Stage 4
// in docs/HANDOFF_2026-07-19_frontend_build.md). A UI "Translate" button next to
// "Copy" calls this — English shown by default, never an automatic/forced
// translation. Server-side only: the OPENROUTER_KEY must never reach the browser.
//
// Deliberately self-contained, NOT importing pipeline/lib/copyEngine.mjs's
// localizeMessage() — ADR-009's own build note flags why: copyEngine.mjs resolves
// its file paths (translations.jsonl, .env) via `dirname(fileURLToPath(import.meta.url))`
// relative to ITS OWN source location, which breaks once Next.js bundles the file
// into .next/server/ at a different path. Same prompt shape and REGISTER_BY_LANG
// values as localizeMessage(), duplicated here as small stable constants instead of
// risking a cross-boundary import that only fails at runtime on the deployed build.
//
// Cache: in-memory Map, module-level — persists across requests within one running
// `next start` process (this is a persistent VPS server, not serverless, so this
// isn't wiped per-request), keyed by hash(text+lang) exactly like the pipeline-side
// localizeMessage(). NOT a DB-backed cache — ADR-009 D5 flags a DB cache as the
// eventual real solution but explicitly "not needed for the mockup itself"; building
// one now would be inventing a decision (schema, TTL, eviction) nobody has made yet.
// Cheap to add later without changing this route's request/response shape.

const OPENROUTER_KEY = process.env.OPENROUTER_KEY;
const MODEL = 'anthropic/claude-sonnet-4.5'; // same choice as copyEngine.mjs's localizeHookLine/localizeMessage (2026-07-17, Leo — quality over cost at this volume)

const cache = new Map<string, string>();

// saw_equivalent values from clients/philippe-bosquillon/copy/translations.jsonl —
// used as grounding so the model matches this project's established phrasing
// instead of inventing tone from scratch. Small, stable list; keep in sync by hand
// if translations.jsonl's saw_equivalent values ever change.
const SAW_EQUIVALENT: Record<string, string> = {
  de: 'hab gelesen dass',
  fr: 'vu que',
  nl: 'zag dat',
};

const REGISTER_BY_LANG: Record<string, string> = {
  de: 'formal register (Sie, not du) — this is a first cold touch to a senior exec',
  fr: 'formal register (vous, not tu) — this is a first cold touch to a senior exec',
  nl: 'direct, pragmatic register is fine and expected — Dutch business culture reads overly formal phrasing as stiff',
};

function hashCacheKey(text: string, lang: string) {
  return createHash('sha256').update(`${lang}::${text}`).digest('hex').slice(0, 24);
}

export async function POST(req: NextRequest) {
  let body: { text?: string; lang?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { text, lang } = body;
  if (!text || typeof text !== 'string') {
    return NextResponse.json({ error: 'text is required' }, { status: 400 });
  }
  if (!lang || !SAW_EQUIVALENT[lang]) {
    return NextResponse.json({ error: `lang must be one of: ${Object.keys(SAW_EQUIVALENT).join(', ')}` }, { status: 400 });
  }
  if (!OPENROUTER_KEY) {
    return NextResponse.json({ error: 'translation unavailable (no OPENROUTER_KEY configured server-side)' }, { status: 503 });
  }

  const cacheKey = hashCacheKey(text, lang);
  const cached = cache.get(cacheKey);
  if (cached) return NextResponse.json({ translated: cached, cached: true });

  const prompt = `Localize (do NOT translate word-for-word) this full cold-outreach message from English into natural, native-sounding ${lang.toUpperCase()} for a food-industry executive search message. A native speaker in this industry should read it and not suspect it was translated — rephrase freely to hit the same meaning and tone rather than mapping each word. Register: ${REGISTER_BY_LANG[lang] || 'natural business register'}. Match this project's established phrasing style — for reference here is how this project renders the equivalent connector phrase "saw that": "${SAW_EQUIVALENT[lang]}".

Preserve EXACTLY, character-for-character, unchanged:
- Every {variable} placeholder (e.g. {first_name}, {company}) — do not translate or reword the text inside the braces.
- Every literal bracketed token like [Calendly link] — leave the brackets and the exact text inside them untouched.
- The line-break structure — same number of lines, blank lines in the same places.

Message:
"""
${text}
"""

Respond with ONLY the localized message, no quotes, no explanation, no extra commentary before or after.`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENROUTER_KEY}` },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const data = await res.json();
    const translated = data.choices?.[0]?.message?.content?.trim();
    if (!translated) throw new Error('empty response from OpenRouter');
    cache.set(cacheKey, translated);
    return NextResponse.json({ translated, cached: false });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
