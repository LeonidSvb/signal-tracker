// Pulls run history for all 33 Exa monitors via GET /monitors/{id}/runs and
// upserts every result into signal_monitoring.raw_signals, plus one
// pipeline_runs row per monitor for observability.
//
// Why this exists: the 33 monitors' webhook already points at the real
// production endpoint (https://philippe.pamelacoreypc.com/api/exa-webhook,
// verified live), but raw_signals has had zero new exa rows since 2026-06-22
// despite monitors firing weekly since then — this backfills whatever the
// webhook failed to deliver, using the same read-only Exa API n8n never
// needed. Safe to re-run: raw_signals dedupes on (client_id, source, external_id).
//
// Usage: node exa/scripts/backfill_monitor_runs.mjs
// Env (from repo root .env + nextjs/.env.local): EXA_API_KEY,
// NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../../../.env') });       // EXA_API_KEY (Mastr_Leads root)
dotenv.config({ path: path.resolve(__dirname, '../../nextjs/.env.local') });    // Supabase creds

const EXA_API_KEY = process.env.EXA_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SCHEMA = 'signal_monitoring';
const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';

if (!EXA_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing EXA_API_KEY / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const MONITORS = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../results/monitor_ids.json'), 'utf8')
).all_monitors;

const COUNTRY_MAP = { DE: 'DE', DE7: 'DE', FR: 'FR', FR7: 'FR', NL: 'NL', BE: 'BE', CH: 'CH', EU: null };

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Content-Profile': SCHEMA,
    'Accept-Profile': SCHEMA,
    ...extra,
  };
}

async function getClientId() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/clients?slug=eq.${CLIENT_SLUG}&select=id`, {
    headers: supabaseHeaders(),
  });
  const rows = await res.json();
  if (!rows.length) throw new Error(`Client not found: ${CLIENT_SLUG}`);
  return rows[0].id;
}

function normalizeItem(item, monitorLabel, clientId) {
  const [signalType, countryCode] = monitorLabel.split('|');
  return {
    client_id: clientId,
    source: 'exa',
    source_type: 'news',
    external_id: item.id || item.url,
    monitor_label: monitorLabel, // real column since migration 004 — dedup key includes this now
    company_name: null,
    source_url: item.url,
    pub_date: item.publishedDate ? item.publishedDate.slice(0, 10) : null,
    country: COUNTRY_MAP[countryCode] ?? null,
    status: 'pending',
    raw_data: {
      title: item.title,
      author: item.author ?? null,
      image: item.image ?? null,
      publishedDate: item.publishedDate ?? null,
      // Full page text (Markdown), present once contents.text:true is on — enabled on all 33
      // monitors 2026-07-13, so absent on anything the monitor found before that date.
      text: item.text ?? null,
      monitor_label: monitorLabel,
      signal_type: signalType,
    },
  };
}

async function upsertRawSignals(rows) {
  if (!rows.length) return 0;
  // on_conflict widened to include monitor_label (migration 004) — same story caught by several
  // monitor categories at once now keeps one row per (monitor, url) instead of collapsing to
  // whichever monitor's row landed first, discarding the others' category attribution.
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/raw_signals?on_conflict=client_id,source,external_id,monitor_label`,
    {
      method: 'POST',
      headers: supabaseHeaders({ Prefer: 'return=representation,resolution=ignore-duplicates' }),
      body: JSON.stringify(rows),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`raw_signals upsert failed ${res.status}: ${err.slice(0, 300)}`);
  }
  const inserted = await res.json();
  return Array.isArray(inserted) ? inserted.length : 0;
}

async function logPipelineRun(clientId, label, { rowsScraped, rowsPushed, apiRuns, startedAt, errors, digest, citations }) {
  const body = {
    client_id: clientId,
    script: 'exa_backfill',
    source: label,
    status: errors.length ? 'error' : 'done',
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    rows_scraped: rowsScraped,
    rows_passed_icp: null,
    rows_pushed: rowsPushed,
    errors: errors.length ? errors : [],
    stats: { monitor_id: MONITORS[label], api_runs_seen: apiRuns },
    // Most recent run's digest only — the backfill covers many runs per monitor but pipeline_runs
    // here represents the whole backfill pass, not one run, so there's no single "the" digest;
    // the latest one is the most useful snapshot to keep visible.
    digest: digest ?? null,
    digest_citations: citations ?? null,
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pipeline_runs`, {
    method: 'POST',
    headers: supabaseHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error(`  ! pipeline_runs log failed for ${label}: ${res.status} ${await res.text()}`);
}

async function main() {
  const clientId = await getClientId();
  console.log(`Client: ${CLIENT_SLUG} (${clientId})`);
  console.log(`Monitors to backfill: ${Object.keys(MONITORS).length}\n`);

  const summary = [];
  let grandSeen = 0, grandNew = 0;

  for (const [label, monitorId] of Object.entries(MONITORS)) {
    const startedAt = new Date().toISOString();
    const errors = [];
    let seen = 0, inserted = 0, apiRuns = 0;

    let digest = null, citations = null;
    try {
      const res = await fetch(`https://api.exa.ai/monitors/${monitorId}/runs`, {
        headers: { 'x-api-key': EXA_API_KEY },
      });
      if (!res.ok) throw new Error(`Exa API ${res.status}`);
      const { data: runs } = await res.json();
      apiRuns = runs.length;

      const allItems = runs.flatMap(run => run.output?.results ?? []);
      seen = allItems.length;

      const rows = allItems
        .filter(item => item.id || item.url)
        .map(item => normalizeItem(item, label, clientId));

      inserted = await upsertRawSignals(rows);

      // Most recent completed run's digest — one paragraph covers every result in that run, so it's
      // stored per-run on pipeline_runs, not duplicated onto every raw_signals row.
      const latestCompleted = runs.find(r => r.output?.content);
      if (latestCompleted) {
        digest = latestCompleted.output.content;
        citations = latestCompleted.output.grounding ?? null;
      }
    } catch (e) {
      errors.push(String(e.message || e));
    }

    await logPipelineRun(clientId, label, { rowsScraped: seen, rowsPushed: inserted, apiRuns, startedAt, errors, digest, citations });

    grandSeen += seen;
    grandNew += inserted;
    summary.push({ label, apiRuns, seen, new: inserted, error: errors[0] ?? '' });

    // Exa rate limit courtesy delay
    await new Promise(r => setTimeout(r, 150));
  }

  console.table(summary);
  console.log(`\nTotal results seen across all monitors: ${grandSeen}`);
  console.log(`Total newly inserted into raw_signals:   ${grandNew}`);
  console.log(`Already present (deduped, skipped):      ${grandSeen - grandNew}`);
}

main().catch(e => { console.error(e); process.exit(1); });
