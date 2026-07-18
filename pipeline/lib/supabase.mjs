// Thin HTTP wrapper over Supabase REST API — no SDK needed (Node 22 native fetch)
// Usage: import { insert, upsert, select } from './supabase.mjs'
// Env vars required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// F1 (docs/HANDOFF_2026-07-15_scoring_two_channel.md) — the intermittent multi-minute
// hangs were diagnosed 2026-07-15 on the live instance:
//   - NOT Happy-Eyeballs/IPv6: supabase.pamelacoreypc.com has a single A record and
//     zero AAAA records (dns.resolve6 → ENODATA), so autoSelectFamily has nothing to
//     race. ipv4first below is kept as a prophylactic (harmless today, protects local
//     runs if an AAAA record ever appears) — it is NOT the fix.
//   - Real cause 1: raw_signals pages are ~7 MB each and the server sends them
//     UNCOMPRESSED (content-encoding: none, measured). At this box's variable
//     throughput (1.5 MB/s dipping to ~0.2 MB/s) a 3-page selectAll legitimately
//     takes 13s-100s. Mitigation: selectAll/select now accept opts.select so heavy
//     callers can stop transferring raw_data jsonb they don't use (id-only page:
//     49 KB vs 7 MB, measured).
//   - Real cause 2: every function here cleared its abort timer the moment fetch()
//     resolved (headers), leaving `await res.text()` unbounded — a throughput dip
//     became a silent multi-minute hang with NO error (observed live: 99.8s call,
//     no abort). Same bug class lib/httpRetry.mjs documents for sourcing.mjs.
//     Fix: sbFetch() reads the body INSIDE the timeout window and retries once on
//     AbortError with a fresh controller, logging '[supabase] retry after abort'
//     so occurrences stay visible. Retry is safe: insert uses ignore-duplicates,
//     upsert merge-duplicates, PATCH is idempotent.

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first'); // prophylactic — see F1 note above

const URL_BASE = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE) throw new Error('Missing SUPABASE_URL env var');
if (!KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY env var');

const SCHEMA = 'signal_monitoring';
const BASE = `${URL_BASE}/rest/v1`;
const HEADERS = {
  'apikey': KEY,
  'Authorization': `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  'Content-Profile': SCHEMA,
  'Accept-Profile': SCHEMA,
};

const BATCH_SIZE = 25;
const TIMEOUT_MS = 30_000;

// One attempt: fetch + FULL body read inside a single abort window.
async function sbAttempt(url, options, timeoutMs) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: abort.signal });
    const bodyText = await res.text(); // still inside the timeout window — see F1 note
    return { ok: res.ok, status: res.status, bodyText };
  } finally {
    clearTimeout(timer);
  }
}

async function sbFetch(url, options = {}, timeoutMs = TIMEOUT_MS) {
  try {
    return await sbAttempt(url, options, timeoutMs);
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
    console.log(`[supabase] retry after abort (${timeoutMs}ms): ${options.method || 'GET'} ${url.slice(0, 120)}`);
    try {
      return await sbAttempt(url, options, timeoutMs); // fresh controller, one retry
    } catch (e2) {
      if (e2.name !== 'AbortError') throw e2;
      throw new Error(`[supabase] timed out twice (${timeoutMs}ms each): ${options.method || 'GET'} ${url.slice(0, 120)}`);
    }
  }
}

function normalizeRows(rows) {
  const allKeys = [...new Set(rows.flatMap(r => Object.keys(r)))];
  return rows.map(r => Object.fromEntries(allKeys.map(k => [k, r[k] ?? null])));
}

export async function insert(table, rows, onConflict = null) {
  if (!rows.length) return [];
  const normalized = normalizeRows(rows);
  const results = [];
  const qs = onConflict ? `?on_conflict=${onConflict}` : '';
  for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
    const batch = normalized.slice(i, i + BATCH_SIZE);
    const res = await sbFetch(`${BASE}/${table}${qs}`, {
      method: 'POST',
      headers: { ...HEADERS, 'Prefer': 'return=representation,resolution=ignore-duplicates' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      throw new Error(`[supabase] POST ${table} → ${res.status}: ${res.bodyText.substring(0, 200)}`);
    }
    const r = res.bodyText ? JSON.parse(res.bodyText) : [];
    results.push(...(Array.isArray(r) ? r : []));
  }
  return results;
}

export async function upsert(table, rows, onConflict) {
  if (!rows.length) return [];
  const results = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const res = await sbFetch(`${BASE}/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: { ...HEADERS, 'Prefer': 'return=representation,resolution=merge-duplicates' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      throw new Error(`[supabase] UPSERT ${table} → ${res.status}: ${res.bodyText.substring(0, 200)}`);
    }
    const r = res.bodyText ? JSON.parse(res.bodyText) : [];
    results.push(...(Array.isArray(r) ? r : [r]));
  }
  return results;
}

// opts.select — optional PostgREST column list (e.g. 'id,source_url,pub_date') so
// callers that don't need raw_data jsonb stop paying 7 MB/page transfer (F1 note).
// opts.timeoutMs — per-call override of the 30s default. Heavy full-row pulls
// (raw_signals with raw_data right after a scrape) legitimately exceed 30s at this
// box's worst-case ~0.2 MB/s throughput (F1 note) — found live 2026-07-18 when
// filter_icp timed out twice in a row on a routine post-scrape pull.
export async function select(table, filters = {}, opts = {}) {
  const parts = Object.entries(filters).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`);
  if (opts.select) parts.push(`select=${opts.select}`);
  const qs = parts.join('&');
  const res = await sbFetch(`${BASE}/${table}${qs ? '?' + qs : ''}`, {
    headers: { ...HEADERS, 'Prefer': 'return=representation' },
  }, opts.timeoutMs ?? TIMEOUT_MS);
  if (!res.ok) throw new Error(`[supabase] SELECT ${table} → ${res.status}`);
  return JSON.parse(res.bodyText);
}

export async function selectAll(table, filters = {}, opts = {}) {
  const PAGE = 1000;
  let offset = 0;
  const all = [];
  while (true) {
    const parts = Object.entries(filters).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`);
    if (opts.select) parts.push(`select=${opts.select}`);
    parts.push(`limit=${PAGE}`, `offset=${offset}`);
    const res = await sbFetch(`${BASE}/${table}?${parts.join('&')}`, {
      headers: { ...HEADERS, 'Prefer': 'return=representation' },
    }, opts.timeoutMs ?? TIMEOUT_MS);
    if (!res.ok) throw new Error(`[supabase] SELECT ${table} → ${res.status}`);
    const batch = JSON.parse(res.bodyText);
    all.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

export async function patch(table, filterCol, filterVals, data) {
  if (!filterVals.length) return 0;
  const PATCH_BATCH = 80;
  let total = 0;
  for (let i = 0; i < filterVals.length; i += PATCH_BATCH) {
    const batch = filterVals.slice(i, i + PATCH_BATCH);
    // select=id: return=representation without it echoes FULL updated rows —
    // for raw_signals that's the raw_data jsonb too, megabytes per 80-row batch,
    // which blew the 30s window live 2026-07-18 (filter_icp post-scrape PATCH).
    // Row count semantics are unchanged, callers only ever .length the result.
    const qs = `${filterCol}=in.(${batch.join(',')})&select=id`;
    const res = await sbFetch(`${BASE}/${table}?${qs}`, {
      method: 'PATCH',
      headers: { ...HEADERS, 'Prefer': 'return=representation' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw new Error(`[supabase] PATCH ${table} → ${res.status}: ${res.bodyText.substring(0, 200)}`);
    }
    const r = res.bodyText ? JSON.parse(res.bodyText) : [];
    total += Array.isArray(r) ? r.length : 0;
  }
  return total;
}
