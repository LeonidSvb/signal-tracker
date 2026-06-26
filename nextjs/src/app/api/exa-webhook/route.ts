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
    client_id:    clientId,
    source:       'exa',
    source_type:  'news',
    external_id:  (item.id as string) || (item.url as string),
    company_name: null,
    source_url:   item.url as string,
    pub_date:     item.publishedDate
      ? (item.publishedDate as string).substring(0, 10)
      : null,
    country:      COUNTRY_MAP[countryCode] ?? null,
    status:       'pending',
    raw_data: {
      title:         item.title,
      author:        item.author,
      image:         item.image,
      publishedDate: item.publishedDate,
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
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/raw_signals?on_conflict=client_id,source,external_id`,
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

// POST /api/exa-webhook
// Exa sends: { monitorId: string, results: Array<{ id, url, title, publishedDate, ... }> }
export async function POST(req: NextRequest) {
  let body: { monitorId?: string; results?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const { monitorId, results } = body;

  if (!monitorId || !Array.isArray(results)) {
    return NextResponse.json({ error: 'missing monitorId or results' }, { status: 400 });
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

  console.log(`[exa-webhook] ${monitorLabel} → ${results.length} received, ${inserted} inserted`);
  return NextResponse.json({ ok: true, monitor: monitorLabel, received: results.length, inserted });
}
