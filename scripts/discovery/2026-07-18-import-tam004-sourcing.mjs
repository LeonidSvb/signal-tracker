#!/usr/bin/env node
// One-time import: 0_blitz/004_tam_11-50/tam_blitz.csv (20,969 companies, 11-50
// employees, industry-filtered, 7 countries — scraped 2026-07-18 per Leo's call)
// -> sourcing.companies as icp_status='unscored'.
//
// Why unscored instead of bulk-LLM-scoring first: resolve_companies/classify_company
// treat an unscored Layer-0 hit as a DOMAIN head start — they skip the paid Exa
// domain-resolve entirely and only classify on demand. So the import alone already
// delivers the Exa-credit saving; bulk scoring 21k companies (~$40-100 LLM) stays an
// optional later batch if ever worth it.
//
// Dedup: pre-filters by normalized domain AND linkedin_url against everything already
// in sourcing, then plain batched inserts (the partial-unique-index situation makes
// PostgREST on_conflict unusable here — see sourcing.mjs's upsertSourcingCompany note).
//
// Run: node --env-file=nextjs/.env.local scripts/discovery/2026-07-18-import-tam004-sourcing.mjs

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchRetry } from '../../pipeline/lib/httpRetry.mjs';
import { getSourcingClientId, selectAllSourcing } from '../../pipeline/lib/sourcing.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dir, '../../../0_blitz/004_tam_11-50/tam_blitz.csv');
const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';

const URL_BASE = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HEADERS = {
  apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json',
  'Content-Profile': 'sourcing', 'Accept-Profile': 'sourcing', Prefer: 'return=minimal',
};

// Minimal RFC-4180 CSV parser (about/specialties fields carry commas, quotes, newlines).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function normDomain(d) { if (!d) return ''; return String(d).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim(); }

async function main() {
  const raw = readFileSync(CSV_PATH, 'utf8');
  const [header, ...rows] = parseCsv(raw);
  const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  console.log(`CSV rows: ${rows.length}`);

  const sourcingClientId = await getSourcingClientId(CLIENT_SLUG);
  const existing = await selectAllSourcing('companies', `client_id=eq.${sourcingClientId}&select=domain,company_linkedin_url`);
  const existingDomains = new Set(existing.map(c => normDomain(c.domain)).filter(Boolean));
  const existingLis = new Set(existing.map(c => (c.company_linkedin_url || '').toLowerCase()).filter(Boolean));
  console.log(`already in sourcing: ${existing.length}`);

  const seen = new Set();
  const toInsert = [];
  for (const r of rows) {
    const domain = normDomain(r[col.domain]);
    const li = (r[col.linkedin_url] || '').toLowerCase().trim();
    const dedupKey = domain || li;
    if (!dedupKey || seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    if (domain && existingDomains.has(domain)) continue;
    if (!domain && li && existingLis.has(li)) continue;
    const employees = parseInt(r[col.employees_on_linkedin], 10);
    toInsert.push({
      client_id: sourcingClientId,
      company_name: r[col.name] || null,
      domain: domain || null,
      company_linkedin_url: r[col.linkedin_url] || null,
      hq_country: r[col.hq_country_code] || null,
      employees: Number.isFinite(employees) ? employees : null,
      industry: r[col.industry] || null,
      about: (r[col.about] || '').slice(0, 2000) || null,
      icp_status: 'unscored',
      first_seen_via: 'blitz_tam_004',
    });
  }
  console.log(`new rows to insert (domain/li-deduped): ${toInsert.length}`);

  const BATCH = 500;
  let inserted = 0, failed = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    const res = await fetchRetry(`${URL_BASE}/rest/v1/companies`, {
      method: 'POST', headers: HEADERS, body: JSON.stringify(batch),
    }, { timeoutMs: 120_000 });
    if (res.ok) inserted += batch.length;
    else { failed += batch.length; console.error(`batch ${i / BATCH}: ${res.status} ${(await res.text()).slice(0, 200)}`); }
    process.stdout.write(`\r  ${Math.min(i + BATCH, toInsert.length)}/${toInsert.length} sent (ok=${inserted} fail=${failed})`);
  }
  console.log(`\nDONE: inserted=${inserted} failed=${failed}`);
}

main().catch(e => { console.error(e); process.exit(1); });
