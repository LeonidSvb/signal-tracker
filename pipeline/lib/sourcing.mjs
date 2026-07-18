// Thin REST client for the OUTER Mastr_Leads repo's `sourcing` Postgres schema —
// same Supabase instance as signal_monitoring, different schema (Content-Profile header).
// This is the 11.8k-company TAM base built 2026-07-13 (clients/philippe-bosquillon/db/
// migrations/001_sourcing_schema.sql in the outer repo). Read here as Layer 0 (free lookup
// before spending on Exa), written here as Layer 2 (permanent cache of Layer-1 results).
//
// philippe-bosquillon has the SAME client_id in both schemas by design (reused on purpose
// when sourcing was built, so a future merge needs no ID remap) — see that migration's
// closing comment. Safe to look it up fresh per schema rather than assume it never diverges
// for a future client.

import dns from 'node:dns';
import { fetchRetry } from './httpRetry.mjs';

// F1 prophylactic (see lib/supabase.mjs header for the full diagnosis): the Supabase
// host currently has NO AAAA records, so Happy-Eyeballs was ruled OUT as the hang
// cause — this only protects future DNS changes. Body-read timeouts + abort retry
// (the real fix) already come from fetchRetry below.
dns.setDefaultResultOrder('ipv4first');

const URL_BASE = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SCHEMA = 'sourcing';
const BASE = `${URL_BASE}/rest/v1`;
const HEADERS = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  'Content-Profile': SCHEMA,
  'Accept-Profile': SCHEMA,
};

export async function getSourcingClientId(slug) {
  const res = await fetchRetry(`${BASE}/clients?slug=eq.${encodeURIComponent(slug)}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`[sourcing] clients lookup ${res.status}`);
  const rows = await res.json();
  if (!rows.length) throw new Error(`[sourcing] client not found: ${slug}`);
  return rows[0].id;
}

export async function startSourcingRun(clientId, { run_type, run_tag, config = {} }) {
  const res = await fetchRetry(`${BASE}/runs`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify([{
      client_id: clientId, run_type, run_tag,
      started_at: new Date().toISOString(),
      config, status: 'running',
    }]),
  });
  if (!res.ok) throw new Error(`[sourcing] startRun ${res.status}: ${await res.text()}`);
  const [row] = await res.json();
  return row?.id;
}

export async function finishSourcingRun(runId, { status = 'success', results = {} } = {}) {
  if (!runId) return;
  await fetchRetry(`${BASE}/runs?id=eq.${runId}`, {
    method: 'PATCH',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ status, finished_at: new Date().toISOString(), results }),
  });
}

const PAGE = 1000;

export async function selectAllSourcing(table, qs = '') {
  let offset = 0;
  const all = [];
  while (true) {
    const sep = qs ? '&' : '';
    const res = await fetchRetry(`${BASE}/${table}?${qs}${sep}limit=${PAGE}&offset=${offset}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`[sourcing] SELECT ${table} ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// Layer 2 — write (or update) a Layer-1 (or Layer 0 corroborated) result. domain is the dedup
// key when present, else linkedin_url — matching the schema's two partial unique indexes.
// NOTE: can't use PostgREST's on_conflict= for this — Postgres only accepts a partial unique
// index as an ON CONFLICT arbiter when the conflict target's own WHERE clause matches the
// index predicate exactly, and PostgREST's on_conflict param has no way to express that
// (hit live 2026-07-14: every upsert 400'd with 42P10 "no unique or exclusion constraint
// matching the ON CONFLICT specification" against companies_client_domain_key, a partial
// index). Manual select-then-write instead — one extra free read per company, not on the
// Exa/LLM cost path.
export async function upsertSourcingCompany(row) {
  let existing = null;
  if (row.domain) {
    const found = await selectAllSourcing('companies', `client_id=eq.${row.client_id}&domain=eq.${encodeURIComponent(row.domain)}&select=id`);
    existing = found[0] || null;
  } else if (row.company_linkedin_url) {
    const found = await selectAllSourcing('companies', `client_id=eq.${row.client_id}&company_linkedin_url=eq.${encodeURIComponent(row.company_linkedin_url)}&select=id`);
    existing = found[0] || null;
  }

  if (existing) {
    const res = await fetchRetry(`${BASE}/companies?id=eq.${existing.id}`, {
      method: 'PATCH',
      headers: { ...HEADERS, Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(`[sourcing] update companies ${res.status}: ${await res.text()}`);
    const rows = await res.json();
    return Array.isArray(rows) ? rows[0] : rows;
  }

  const res = await fetchRetry(`${BASE}/companies`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify([row]),
  });
  if (!res.ok) throw new Error(`[sourcing] insert companies ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}
