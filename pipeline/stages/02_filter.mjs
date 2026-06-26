#!/usr/bin/env node
// ICP filter — reads all pending raw_signals, classifies each row,
// writes status='passed_icp'|'filtered_out' + filter_reason back to DB.
// Run: node --env-file=nextjs/.env.local pipeline/stages/02_filter.mjs

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { selectAll, patch } from '../lib/supabase.mjs';
import { getClientId, startRun, finishRun } from '../lib/log.mjs';

const __dir      = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dir, '../config/icp_filter.json');
const cfg        = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasKeyword(str, keywords) {
  if (!str) return false;
  const lower = str.toLowerCase();
  return keywords.some(kw => lower.includes(kw.toLowerCase()));
}

function daysOld(dateStr) {
  if (!dateStr) return 0;
  return (Date.now() - new Date(dateStr).getTime()) / 86_400_000;
}

// ── Filter logic ──────────────────────────────────────────────────────────────

function filterHiring(row) {
  const title       = row.raw_data?.title || row.raw_data?.positionName || '';
  const companyName = row.company_name
    || row.raw_data?.company
    || row.raw_data?.companyName
    || '';
  const source      = row.source;

  if (hasKeyword(title, cfg.hiring_blacklist_keywords))
    return { status: 'filtered_out', filter_reason: 'junior_role' };

  if (hasKeyword(companyName, cfg.company_blacklist))
    return { status: 'filtered_out', filter_reason: 'blacklisted_company' };

  if (row.country && !cfg.countries.includes(row.country))
    return { status: 'filtered_out', filter_reason: 'wrong_country' };

  if (daysOld(row.pub_date) > cfg.staleness_days.HIRING)
    return { status: 'filtered_out', filter_reason: 'stale' };

  if (!hasKeyword(title, cfg.hiring_exec_keywords))
    return { status: 'filtered_out', filter_reason: 'no_exec_title' };

  if (source === 'linkedin') {
    const industries = row.raw_data?.industries || '';
    if (industries && !hasKeyword(industries, cfg.industry_keywords))
      return { status: 'filtered_out', filter_reason: 'wrong_industry' };

    const emp = row.raw_data?.companyEmployeesCount;
    if (emp != null) {
      if (emp < cfg.min_employees || emp > cfg.max_employees)
        return { status: 'filtered_out', filter_reason: 'wrong_size' };
    }
  }

  if (source === 'xing') {
    const industry = row.raw_data?.company_industry || '';
    if (industry && !hasKeyword(industry, cfg.industry_keywords))
      return { status: 'filtered_out', filter_reason: 'wrong_industry' };
  }

  return { status: 'passed_icp', filter_reason: null };
}

function filterNews(row) {
  const signalType = (row.raw_data?.signal_type || 'NICHE').toUpperCase();
  const maxDays    = cfg.staleness_days[signalType] ?? 30;
  if (daysOld(row.pub_date) > maxDays)
    return { status: 'filtered_out', filter_reason: 'stale' };
  return { status: 'passed_icp', filter_reason: null };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== 02_filter.mjs ===');
  const clientId = await getClientId(CLIENT_SLUG);
  console.log(`client_id: ${clientId}`);

  const rows = await selectAll('raw_signals', { client_id: clientId, status: 'pending' });
  console.log(`\npending: ${rows.length}`);

  const groups = {};
  for (const row of rows) {
    const decision = row.source_type === 'news' ? filterNews(row) : filterHiring(row);
    const key = `${decision.status}::${decision.filter_reason ?? 'ok'}`;
    (groups[key] ??= []).push(row.id);
  }

  console.log('\nBreakdown:');
  for (const [key, ids] of Object.entries(groups).sort()) {
    const [status, reason] = key.split('::');
    console.log(`  ${status.padEnd(15)} ${reason.padEnd(20)} ${ids.length}`);
  }

  const runId = await startRun({ clientId, script: '02_filter', source: 'icp_filter' });

  let passed = 0, filtered = 0, updated = 0;
  for (const [key, ids] of Object.entries(groups)) {
    const [status, reason] = key.split('::');
    const data = { status, filter_reason: reason === 'ok' ? null : reason };
    const n = await patch('raw_signals', 'id', ids, data);
    updated += n;
    if (status === 'passed_icp') passed += n;
    else filtered += n;
  }

  console.log(`\nupdated : ${updated}`);
  console.log(`passed  : ${passed}`);
  console.log(`filtered: ${filtered}`);

  await finishRun(runId, {
    status: 'success',
    stats: { scraped: rows.length, pushed: passed },
  });
  console.log('=== DONE ===');
}

export { main as run };

import { pathToFileURL } from 'url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
