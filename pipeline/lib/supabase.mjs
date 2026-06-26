// Thin HTTP wrapper over Supabase REST API — no SDK needed (Node 22 native fetch)
// Usage: import { insert, upsert, select } from './supabase.mjs'
// Env vars required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`${BASE}/${table}${qs}`, {
        method: 'POST',
        headers: { ...HEADERS, 'Prefer': 'return=representation,resolution=ignore-duplicates' },
        body: JSON.stringify(batch),
        signal: abort.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`[supabase] POST ${table} → ${res.status}: ${err.substring(0, 200)}`);
    }
    const text = await res.text();
    const r = text ? JSON.parse(text) : [];
    results.push(...(Array.isArray(r) ? r : []));
  }
  return results;
}

export async function upsert(table, rows, onConflict) {
  if (!rows.length) return [];
  const results = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const prefer = `return=representation,resolution=merge-duplicates`;
    const abort2 = new AbortController();
    const timer2 = setTimeout(() => abort2.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`${BASE}/${table}?on_conflict=${onConflict}`, {
        method: 'POST',
        headers: { ...HEADERS, 'Prefer': prefer },
        body: JSON.stringify(batch),
        signal: abort2.signal,
      });
    } finally {
      clearTimeout(timer2);
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`[supabase] UPSERT ${table} → ${res.status}: ${err.substring(0, 200)}`);
    }
    const text = await res.text();
    const r = text ? JSON.parse(text) : [];
    results.push(...(Array.isArray(r) ? r : [r]));
  }
  return results;
}

export async function select(table, filters = {}) {
  const qs = Object.entries(filters)
    .map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`)
    .join('&');
  const abort3 = new AbortController();
  const timer3 = setTimeout(() => abort3.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${BASE}/${table}${qs ? '?' + qs : ''}`, {
      headers: { ...HEADERS, 'Prefer': 'return=representation' },
      signal: abort3.signal,
    });
  } finally {
    clearTimeout(timer3);
  }
  if (!res.ok) throw new Error(`[supabase] SELECT ${table} → ${res.status}`);
  return await res.json();
}

export async function selectAll(table, filters = {}) {
  const PAGE = 1000;
  let offset = 0;
  const all = [];
  while (true) {
    const eqPart = Object.entries(filters)
      .map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`)
      .join('&');
    const query = `${eqPart ? eqPart + '&' : ''}limit=${PAGE}&offset=${offset}`;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`${BASE}/${table}?${query}`, {
        headers: { ...HEADERS, 'Prefer': 'return=representation' },
        signal: abort.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`[supabase] SELECT ${table} → ${res.status}`);
    const batch = await res.json();
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
    const qs = `${filterCol}=in.(${batch.join(',')})`;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`${BASE}/${table}?${qs}`, {
        method: 'PATCH',
        headers: { ...HEADERS, 'Prefer': 'return=representation' },
        body: JSON.stringify(data),
        signal: abort.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`[supabase] PATCH ${table} → ${res.status}: ${err.substring(0, 200)}`);
    }
    const text = await res.text();
    const r = text ? JSON.parse(text) : [];
    total += Array.isArray(r) ? r.length : 0;
  }
  return total;
}
