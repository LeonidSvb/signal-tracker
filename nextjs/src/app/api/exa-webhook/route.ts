import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SCHEMA       = 'signal_monitoring';
const CLIENT_SLUG  = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';

// monitorId → label (e.g. "MA|DE", "CLEVEL|FR")
// Built from exa/results/monitor_ids.json — hardcoded here for runtime perf
const MONITOR_LABELS: Record<string, string> = {
  '01kt44wts4mqbtp807aqpr7dkk': 'MA|DE',
  '01kt44wxaxhk0pp33eqw5d2sxc': 'MA|FR',
  '01kt44wzjcyrbhg5ekpj415tbg': 'MA|NL',
  '01kt44x1q4htwf5eax0pvpkmf4': 'MA|BE',
  '01kt44x4fkhm8xyph1gm76jgaq': 'MA|CH',
  '01kt44x6z4fj795fkpjtek6hmb': 'MA|EU',
  '01kt44x9cry4m19vs5ccgjeqe2': 'CLEVEL|DE',
  '01kt44xbjd0hb5j2vadyw3v952': 'CLEVEL|FR',
  '01kt44xe70scmpnqpzy2s90f8g': 'CLEVEL|NL',
  '01kt44xgtnphmteazhf5x2bvhc': 'CLEVEL|BE',
  '01kt44xk9zw5j7pqb8mpw8yp6z': 'CLEVEL|DE7',
  '01kt44xnbs9najw8wky7dj01ff': 'CLEVEL|FR7',
  '01kt44xqg615qhyz89q9ghr5x4': 'EXPAND|DE',
  '01kt44xtggqy0tx4ckwj79n21b': 'EXPAND|FR',
  '01kt44xwp0x44wtrgbwpn5d7m9': 'EXPAND|NL',
  '01kt44xysmknjnxc4dc69bb3y9': 'EXPAND|BE',
  '01kt44y13d6gd5nrfdk0vvckvj': 'EXPAND|EU',
  '01kt44y3fk46wx3wbxzkhctyg3': 'INVEST|DE',
  '01kt44y5s1t6wmdd356rsc9578': 'INVEST|FR',
  '01kt44y84cgwhgh693ww1t6grw': 'INVEST|EU',
  '01kt44yajtnvrba9gjn2ne17h8': 'CONTRACT|DE',
  '01kt44ycntwfykantwjaphc30t': 'CONTRACT|FR',
  '01kt44yf0wx0vpv1vqnjreynd4': 'NICHE|FN-DEFRBE',
  '01kt44yh5k54m2wh8jf9b9d0r2': 'NICHE|FN-NL',
  '01kt44yk7t4j5zf57qp3jm3x17': 'NICHE|FOODBEV',
  '01kt44ynk97x81213vn7hxft4q': 'NICHE|JUST-FOOD',
  '01kt44yqja4wb4fmfvzc7y6s2p': 'NICHE|BAKINGBISCUIT',
  '01kt44ysstwjppmdwrdpn7r6pd': 'NICHE|DAIRYREPORTER',
  '01kt44yvzhvhdr2w3d0e1g5dpt': 'SECTOR|DAIRY-DE',
  '01kt44yyev2cqckxn9191xg6y7': 'SECTOR|BAKERY-EU',
  '01kt44z0j1w8ee4mdnkcmd13q6': 'SECTOR|INGREDIENTS',
  '01kt44z2jd2z0saxr4fnw8b5sg': 'SECTOR|MEAT-DE',
  '01kt44z5537237qkg5meme5c1b': 'SECTOR|BEVERAGE-DE',
};

const COUNTRY_MAP: Record<string, string | null> = {
  DE: 'DE', DE7: 'DE', FR: 'FR', FR7: 'FR',
  NL: 'NL', BE: 'BE', CH: 'CH',
  EU: null,
};

function normalizeExaItem(item: Record<string, unknown>, monitorLabel: string, clientId: string) {
  const [signalType, countryCode] = monitorLabel.split('|');
  return {
    client_id:     clientId,
    source:        'exa',
    source_type:   'news',
    external_id:   (item.id as string) || (item.url as string),
    monitor_label: monitorLabel, // real column since migration 004 — dedup key includes this now
    company_name:  null,
    source_url:    item.url as string,
    pub_date:      item.publishedDate
      ? (item.publishedDate as string).substring(0, 10)
      : null,
    country:       COUNTRY_MAP[countryCode] ?? null,
    status:        'pending',
    raw_data: {
      title:         item.title,
      author:        item.author,
      image:         item.image,
      publishedDate: item.publishedDate,
      // Full page text (Markdown-formatted) — present since contents.text:true was enabled on all
      // 33 monitors 2026-07-13. Absent (undefined) on anything captured before that.
      text:          item.text ?? null,
      monitor_label: monitorLabel,
      signal_type:   signalType,
    },
  };
}

async function supabaseHeaders() {
  return {
    apikey:            SUPABASE_KEY,
    Authorization:     `Bearer ${SUPABASE_KEY}`,
    'Content-Type':    'application/json',
    'Content-Profile': SCHEMA,
    'Accept-Profile':  SCHEMA,
    Prefer:            'return=representation,resolution=ignore-duplicates',
  };
}

async function getClientId(): Promise<string> {
  const res  = await fetch(
    `${SUPABASE_URL}/rest/v1/clients?slug=eq.${CLIENT_SLUG}`,
    { headers: await supabaseHeaders() },
  );
  const rows = await res.json() as Array<{ id: string }>;
  if (!rows.length) throw new Error(`Client not found: ${CLIENT_SLUG}`);
  return rows[0].id;
}

async function insertRaw(rows: object[]) {
  if (!rows.length) return 0;
  // on_conflict widened to include monitor_label (migration 004) — the same real-world story often
  // gets caught by several monitor categories at once (39 of 310 URLs did, in a live 2026-07-13
  // check), so each (monitor, url) pair now keeps its own row instead of only the first arrival.
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/raw_signals?on_conflict=client_id,source,external_id,monitor_label`,
    {
      method:  'POST',
      headers: await supabaseHeaders(),
      body:    JSON.stringify(rows),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase insert failed ${res.status}: ${err.slice(0, 200)}`);
  }
  const inserted = await res.json() as unknown[];
  return Array.isArray(inserted) ? inserted.length : 0;
}

// pipeline_runs holds the per-RUN digest — Exa's AI-synthesized paragraph covers every result in
// that run together, not one article each, so it doesn't belong on individual raw_signals rows.
async function logRun(clientId: string, monitorLabel: string, resultsCount: number, insertedCount: number, digest: string | null, citations: unknown) {
  await fetch(`${SUPABASE_URL}/rest/v1/pipeline_runs`, {
    method:  'POST',
    headers: await supabaseHeaders(),
    body: JSON.stringify([{
      client_id:       clientId,
      script:          'exa_webhook',
      source:          monitorLabel,
      status:          'done',
      started_at:      new Date().toISOString(),
      finished_at:     new Date().toISOString(),
      rows_scraped:    resultsCount,
      rows_pushed:     insertedCount,
      digest:          digest,
      digest_citations: citations ?? null,
    }]),
  });
}

// POST /api/exa-webhook
//
// Exa sends an event envelope, NOT a flat { monitorId, results } body — confirmed empirically
// 2026-07-13 against a live test monitor (webhook.site capture), Exa's own docs don't show an
// example payload:
//
//   { id: "event_...", object: "event", type: "monitor.run.completed",
//     data: { id, monitorId, status, output: { results: [...], content, grounding } },
//     createdAt }
//
// Other event types fire on the same URL too — "monitor.created" (on create/config change) and
// "monitor.run.created" (status="running", output=null, when a run starts) — both must be
// acknowledged with 200 and ignored, not treated as errors, or Exa will keep retrying them.
//
// This mismatch (route previously expected the flat shape) is why zero exa rows landed in
// raw_signals between the 2026-06-22 webhook repoint and 2026-07-13, despite all 33 monitors
// firing weekly the whole time — see exa/scripts/backfill_monitor_runs.mjs for the one-time
// recovery of what was missed, and docs/EXA_INTEGRATION.md for the full incident writeup.
//
// Signature verification: Exa signs deliveries with an `exa-signature: t=<ts>,v1=<hmac>` header,
// keyed by a per-monitor webhookSecret returned ONLY in the POST /monitors creation response.
// The 33 production monitors were created 2026-06-02, before this route existed, and that secret
// was never captured — PATCH does not re-issue it, so verification isn't currently possible
// without deleting+recreating all 33 monitors (not worth the disruption for a single-user
// internal tool). Defense in depth instead: reject anything whose monitorId isn't one of our own.
type ExaEvent = {
  type?: string;
  data?: { monitorId?: string; output?: { results?: unknown[]; content?: string; grounding?: unknown } };
};

export async function POST(req: NextRequest) {
  let body: ExaEvent;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  if (body.type !== 'monitor.run.completed') {
    // monitor.created / monitor.run.created / anything future — ack so Exa doesn't retry, do nothing.
    console.log(`[exa-webhook] ignored event type: ${body.type}`);
    return NextResponse.json({ ok: true, ignored: body.type });
  }

  const monitorId = body.data?.monitorId;
  const results = body.data?.output?.results;
  const digest = body.data?.output?.content ?? null;
  const citations = body.data?.output?.grounding ?? null;

  if (!monitorId || !Array.isArray(results)) {
    return NextResponse.json({ error: 'missing data.monitorId or data.output.results' }, { status: 400 });
  }

  const monitorLabel = MONITOR_LABELS[monitorId];
  if (!monitorLabel) {
    // Unknown monitor — log and accept (don't break Exa retries)
    console.warn(`[exa-webhook] unknown monitorId: ${monitorId}`);
    return NextResponse.json({ ok: true, inserted: 0, warning: 'unknown monitorId' });
  }

  let clientId: string;
  try {
    clientId = await getClientId();
  } catch (e) {
    console.error('[exa-webhook] getClientId failed:', e);
    return NextResponse.json({ error: 'client lookup failed' }, { status: 500 });
  }

  const rows = results
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .filter(item => item.id || item.url)
    .map(item => normalizeExaItem(item, monitorLabel, clientId));

  let inserted = 0;
  try {
    inserted = await insertRaw(rows);
  } catch (e) {
    console.error('[exa-webhook] insert failed:', e);
    return NextResponse.json({ error: 'db insert failed' }, { status: 500 });
  }

  try {
    await logRun(clientId, monitorLabel, results.length, inserted, digest, citations);
  } catch (e) {
    console.error('[exa-webhook] pipeline_runs log failed (non-fatal):', e);
  }

  console.log(`[exa-webhook] ${monitorLabel} → ${results.length} received, ${inserted} inserted`);
  return NextResponse.json({ ok: true, monitor: monitorLabel, received: results.length, inserted });
}
