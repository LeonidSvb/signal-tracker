#!/usr/bin/env node
// One-time import of all historical signal data into Supabase
// Run with SSH tunnel open (port 8001 forwarded):
//   node --env-file=../../../../.env pipeline/import_historical.mjs
//
// Required env vars: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
// NEXT_PUBLIC_CLIENT_SLUG defaults to 'philippe-bosquillon'

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { insert, upsert, select } from './lib/supabase.mjs';
import { normalize as normLinkedIn } from './lib/normalize/linkedin.mjs';
import { normalize as normStepStone } from './lib/normalize/stepstone.mjs';
import { normalize as normXing } from './lib/normalize/xing.mjs';
import { normalize as normCadremploi } from './lib/normalize/cadremploi.mjs';
import { normalize as normIndeed } from './lib/normalize/indeed.mjs';
import { normalize as normExa } from './lib/normalize/exa.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const SIGNALS_ROOT = join(__dir, '..');
const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCSV(filepath) {
  const text = readFileSync(filepath, 'utf8');
  const lines = text.split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  return lines.slice(1).map(line => {
    const values = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { values.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    values.push(cur.trim());
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
  });
}

// ── Get client ID ─────────────────────────────────────────────────────────────
async function getClientId() {
  const rows = await select('clients', { slug: CLIENT_SLUG });
  if (!rows.length) throw new Error(`Client not found: ${CLIENT_SLUG}`);
  return rows[0].id;
}

// ── 1. Exa historical (all_runs_raw.json) → raw_signals ──────────────────────
async function importExaRuns(clientId) {
  const path = join(SIGNALS_ROOT, 'exa/results/all_runs_raw.json');
  if (!existsSync(path)) { console.log('[exa] all_runs_raw.json not found, skipping'); return 0; }

  const data = JSON.parse(readFileSync(path, 'utf8'));
  const monitors = data.results;
  const rows = [];

  for (const [label, mon] of Object.entries(monitors)) {
    for (const run of mon.runs) {
      for (const item of (run.output?.results || [])) {
        rows.push(normExa(item, label, clientId));
      }
    }
  }

  const deduped = [...new Map(rows.map(r => [r.external_id, r])).values()];
  const inserted = await insert('raw_signals', deduped, 'client_id,source,external_id');
  console.log(`[exa] ${deduped.length} signals → inserted ${inserted.length}`);
  return inserted.length;
}

// ── 2. Job board raw results → raw_signals ────────────────────────────────────
async function importJobBoardRaw(clientId) {
  const sources = [
    { dir: 'job_boards/linkedin/results', pattern: /_raw\.json$/, norm: normLinkedIn, src: 'linkedin' },
    { dir: 'job_boards/stepstone/results', pattern: /all_runs_raw\.json$/, norm: normStepStone, src: 'stepstone' },
    { dir: 'job_boards/xing/results', pattern: /all_runs_raw\.json$/, norm: normXing, src: 'xing' },
    { dir: 'job_boards/cadremploi/results', pattern: /all_runs_raw\.json$/, norm: normCadremploi, src: 'cadremploi' },
    { dir: 'job_boards/indeed/results', pattern: /_raw\.json$/, norm: normIndeed, src: 'indeed' },
  ];

  let total = 0;
  for (const { dir, pattern, norm, src } of sources) {
    const dirPath = join(SIGNALS_ROOT, dir);
    if (!existsSync(dirPath)) continue;

    const files = readdirSync(dirPath).filter(f => pattern.test(f));
    const rows = [];
    for (const file of files) {
      try {
        const raw = JSON.parse(readFileSync(join(dirPath, file), 'utf8'));
        const arr = Array.isArray(raw) ? raw : Object.values(raw).flat().filter(x => typeof x === 'object');
        arr.forEach(item => { try { rows.push(norm(item, clientId)); } catch {} });
      } catch (e) {
        console.warn(`[${src}] skipping ${file}: ${e.message}`);
      }
    }

    const valid = rows.filter(r => r.external_id && r.source_type);
    const deduped = [...new Map(valid.map(r => [r.external_id, r])).values()];
    if (!deduped.length) continue;
    const inserted = await insert('raw_signals', deduped, 'client_id,source,external_id');
    console.log(`[${src}] ${deduped.length} signals → inserted ${inserted.length}`);
    total += inserted.length;
  }
  return total;
}

// ── 3. signal_companies_resolved.csv → companies ──────────────────────────────
async function importCompanies(clientId) {
  const path = join(SIGNALS_ROOT, 'enrichment/signal_companies_resolved.csv');
  if (!existsSync(path)) { console.log('[companies] CSV not found, skipping'); return 0; }

  const rows = parseCSV(path)
    .filter(r => r.linkedin_url)
    .map(r => ({
      client_id: clientId,
      name: r.name || r.signal_name,
      linkedin_url: r.linkedin_url,
      domain: r.domain || r.website || null,
      industry: r.industry || null,
      employees: r.employees_on_linkedin ? parseInt(r.employees_on_linkedin) : null,
      hq_country: r.hq_country_code || null,
      about: r.about || null,
      blitz_data: JSON.stringify(r),
    }));

  const inserted = await insert('companies', rows, 'client_id,linkedin_url');
  console.log(`[companies] ${rows.length} rows → inserted ${inserted.length}`);
  return inserted.length;
}

// ── 4. signal_contacts_enriched.csv → contacts ────────────────────────────────
async function importContacts(clientId) {
  const path = join(SIGNALS_ROOT, 'enrichment/signal_contacts_enriched.csv');
  if (!existsSync(path)) { console.log('[contacts] CSV not found, skipping'); return 0; }

  // Get company map: linkedin_url → id
  const companies = await select('companies', { client_id: clientId });
  const companyMap = Object.fromEntries(companies.map(c => [c.linkedin_url, c.id]));

  const rows = parseCSV(path)
    .filter(r => r.full_name)
    .map((r, i) => ({
      client_id: clientId,
      company_id: companyMap[r.company_linkedin_url] || null,
      first_name: r.first_name || null,
      last_name: r.last_name || null,
      full_name: r.full_name,
      title: r.title || null,
      linkedin_url: r.linkedin_url || null,
      email: r.email || null,
      email_status: r.email_status || 'pending',
      is_primary: r.source_level?.includes('CEO') || r.source_level?.includes('Geschäftsführer') || i === 0,
      source: r.email_status === 'blitz_enriched' ? 'blitz'
            : r.email_status === 'pattern_inferred' ? 'pattern_inferred'
            : 'blitz',
    }));

  const inserted = await insert('contacts', rows);
  console.log(`[contacts] ${rows.length} rows → inserted ${inserted.length}`);
  return inserted.length;
}

// ── 5. delivery_philippe_2026-06-10.csv → signals + app_state ─────────────────
async function importDelivery(clientId) {
  const path = join(SIGNALS_ROOT, 'enrichment/delivery_philippe_2026-06-10.csv');
  if (!existsSync(path)) { console.log('[delivery] CSV not found, skipping'); return 0; }

  const companies = await select('companies', { client_id: clientId });
  const companyByName = Object.fromEntries(companies.map(c => [c.name?.toLowerCase(), c.id]));

  const csv = parseCSV(path);
  const signalRows = [];
  const stateRows = [];

  for (const r of csv) {
    const companyId = companyByName[r.company_name?.toLowerCase()];
    if (!companyId) { console.warn(`[delivery] company not found: ${r.company_name}`); continue; }

    const daysAgo = parseInt(r.signal_days_ago) || 0;
    const pubDate = r.signal_date || null;
    const signalType = r.signal_url?.includes('linkedin') ? 'HIRING'
                     : r.signal_url?.includes('stepstone') ? 'HIRING'
                     : r.signal_url?.includes('xing') ? 'HIRING'
                     : 'HIRING';

    const freshness = daysAgo <= 7 ? 3 : daysAgo <= 14 ? 2 : daysAgo <= 30 ? 1 : 0;
    const score = freshness + 1; // base score from historical data

    signalRows.push({
      client_id: clientId,
      company_id: companyId,
      signal_type: signalType,
      title: r.signal_title || null,
      source: 'historical',
      source_url: r.signal_url || null,
      pub_date: pubDate,
      days_ago: daysAgo,
      country: r.signal_country || null,
      score,
      freshness_score: freshness,
      status: daysAgo > 90 ? 'stale' : 'active',
      expires_at: pubDate ? new Date(new Date(pubDate).getTime() + 90 * 86400000).toISOString() : null,
      narrative: null,
      angle: r.reach_out_angle || null,
    });

    stateRows.push({
      client_id: clientId,
      company_id: companyId,
      status: 'new',
      updated_by: 'leo',
    });
  }

  const sigInserted = await insert('signals', signalRows);
  const stateInserted = await insert('app_state', stateRows, 'client_id,company_id');
  console.log(`[delivery] ${signalRows.length} signals → inserted ${sigInserted.length}`);
  console.log(`[delivery] ${stateRows.length} app_state → inserted ${stateInserted.length}`);
  return sigInserted.length;
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== import_historical.mjs ===');
  console.log(`client: ${CLIENT_SLUG}`);

  const clientId = await getClientId();
  console.log(`client_id: ${clientId}\n`);

  const skip = new Set((process.env.SKIP_STEPS || '').split(',').map(s => s.trim()));
  const exaCount     = skip.has('exa')      ? 0 : await importExaRuns(clientId);
  const jbCount      = skip.has('jb')       ? 0 : await importJobBoardRaw(clientId);
  const compCount    = skip.has('companies') ? 0 : await importCompanies(clientId);
  const contCount    = skip.has('contacts')  ? 0 : await importContacts(clientId);
  const delivCount   = skip.has('delivery')  ? 0 : await importDelivery(clientId);

  console.log('\n=== DONE ===');
  console.log(`raw_signals (exa):       ${exaCount}`);
  console.log(`raw_signals (job boards): ${jbCount}`);
  console.log(`companies:               ${compCount}`);
  console.log(`contacts:                ${contCount}`);
  console.log(`signals (delivery):      ${delivCount}`);
}

main().catch(e => { console.error(e); process.exit(1); });
