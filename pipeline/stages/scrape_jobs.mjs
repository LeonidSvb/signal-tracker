#!/usr/bin/env node
// Scrape all job boards → write ALL raw results to signal_monitoring.raw_signals
// Sources: LinkedIn, StepStone, Xing, Cadremploi, Indeed
// Run: node --env-file=nextjs/.env.local pipeline/stages/scrape_jobs.mjs
//
// Key rotation: checks all 5 Apify keys, skips blocked/low-balance accounts
// No ICP filtering here — raw everything goes to DB, filtering is filter_icp.mjs

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { insert } from '../lib/supabase.mjs';
import { getClientId, startRun, finishRun } from '../lib/log.mjs';
import { normalize as normLinkedIn }   from '../lib/normalize/linkedin.mjs';
import { normalize as normStepStone }  from '../lib/normalize/stepstone.mjs';
import { normalize as normXing }       from '../lib/normalize/xing.mjs';
import { normalize as normCadremploi } from '../lib/normalize/cadremploi.mjs';
import { normalize as normIndeed }     from '../lib/normalize/indeed.mjs';
import { loadKeyPool, pickKey, apifyRun } from '../../../../../scripts/utils/apify-key-pool.mjs';

const __dir      = dirname(fileURLToPath(import.meta.url));
const BOARDS_DIR = join(__dir, '../../job_boards');
const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';

function readConfig(board) {
  return JSON.parse(readFileSync(join(BOARDS_DIR, board, 'config.json'), 'utf8'));
}

// ── Insert deduplicated rows → raw_signals ────────────────────────────────────
async function flushToDb(source, rows) {
  if (!rows.length) { console.log(`  [db] ${source}: nothing to insert`); return 0; }
  const deduped  = [...new Map(rows.map(r => [r.external_id, r])).values()];
  // Migration 004 widened raw_signals' unique constraint to (client_id, source, external_id,
  // monitor_label) — job-board rows don't set monitor_label, so it falls back to the column's
  // '' default, but on_conflict must still name all 4 columns or Postgres 400s with 42P10 "no
  // unique or exclusion constraint matching". Found live 2026-07-15: this had silently discarded
  // every job-board scrape since migration 004 shipped (all rows fetched and paid for, zero
  // written — LinkedIn/StepStone/Xing all failed with this before the fix landed mid-run).
  const inserted = await insert('raw_signals', deduped, 'client_id,source,external_id,monitor_label');
  console.log(`  [db] ${source}: raw=${rows.length} deduped=${deduped.length} inserted=${inserted.length}`);
  return inserted.length;
}

// ── LinkedIn ─────────────────────────────────────────────────────────────────
// 3 production runs: DE sub-sectors / FR sub-sectors / NL+BE (~$0.10/run)
async function scrapeLinkedIn(clientId) {
  const cfg  = readConfig('linkedin');
  const RUNS = ['de_specific_sectors', 'fr_specific_sectors', 'split_nl_be'];
  const rows = [];

  const pool = await loadKeyPool();
  for (const testName of RUNS) {
    const test = cfg.tests[testName];
    if (!test) { console.warn(`  [linkedin] test not found: ${testName}`); continue; }
    const { key } = pickKey(pool, 0.10);
    console.log(`  [linkedin/${testName}] ${test.urls.length} URLs count=${test.count}`);
    try {
      const items = await apifyRun(key, cfg.actor_id, {
        urls: test.urls, count: test.count, scrapeCompany: test.scrapeCompany ?? true,
      });
      let valid = 0;
      for (const item of items) {
        if (!item.id || String(item.id) === 'undefined') continue;
        rows.push(normLinkedIn(item, clientId));
        valid++;
      }
      console.log(`  [linkedin/${testName}] raw=${items.length} valid=${valid}`);
    } catch (e) {
      console.error(`  [linkedin/${testName}] ERROR: ${e.message}`);
    }
  }
  return rows;
}

// ── StepStone ─────────────────────────────────────────────────────────────────
// ~$0.05/query
async function scrapeStepStone(clientId) {
  const cfg  = readConfig('stepstone');
  const rows = [];

  const pool = await loadKeyPool();
  for (const q of cfg.production_queries) {
    const { key } = pickKey(pool, 0.05);
    console.log(`  [stepstone] "${q.keyword}"`);
    try {
      const items = await apifyRun(key, cfg.actor_id, {
        keyword: q.keyword, location: q.location, maxItems: q.maxItems ?? 50,
      });
      let valid = 0;
      for (const item of items) {
        if (!item.id || String(item.id) === 'undefined') continue;
        rows.push(normStepStone(item, clientId, q.country || 'DE'));
        valid++;
      }
      console.log(`  [stepstone] raw=${items.length} valid=${valid}`);
    } catch (e) {
      console.error(`  [stepstone] ERROR: ${e.message}`);
    }
  }
  return rows;
}

// ── Xing ──────────────────────────────────────────────────────────────────────
// ~$0.02/query, caps at ~20 results
async function scrapeXing(clientId) {
  const cfg  = readConfig('xing');
  const rows = [];

  const pool = await loadKeyPool();
  for (const q of cfg.production_queries) {
    const { key } = pickKey(pool, 0.02);
    console.log(`  [xing] "${q.keyword}"`);
    try {
      const items = await apifyRun(key, cfg.actor_id, { keyword: q.keyword, location: q.location });
      let valid = 0;
      for (const item of items) {
        if (!item.job_id) continue;
        rows.push(normXing(item, clientId));
        valid++;
      }
      console.log(`  [xing] raw=${items.length} valid=${valid}`);
    } catch (e) {
      console.error(`  [xing] ERROR: ${e.message}`);
    }
  }
  return rows;
}

// ── Cadremploi ────────────────────────────────────────────────────────────────
// ~$0.05/query
async function scrapeCadremploi(clientId) {
  const cfg  = readConfig('cadremploi');
  const rows = [];

  const pool = await loadKeyPool();
  for (const q of cfg.production_queries) {
    const { key } = pickKey(pool, 0.05);
    console.log(`  [cadremploi] "${q.keyword}"`);
    try {
      const items = await apifyRun(key, cfg.actor_id, { keyword: q.keyword, maxItems: q.maxItems ?? 50 });
      let valid = 0;
      for (const item of items) {
        if (!item.jobId) continue;
        rows.push(normCadremploi(item, clientId));
        valid++;
      }
      console.log(`  [cadremploi] raw=${items.length} valid=${valid}`);
    } catch (e) {
      console.error(`  [cadremploi] ERROR: ${e.message}`);
    }
  }
  return rows;
}

// ── Indeed ────────────────────────────────────────────────────────────────────
// $0.005/result — each query uses key with most remaining budget
// Skips entire source if total pool remaining < $0.25 (min for 1 query × 50 results)
async function scrapeIndeed(clientId) {
  const pool = await loadKeyPool();
  const totalRemaining = pool.reduce((s, k) => s + k.remaining, 0);
  if (totalRemaining < 0.25) {
    console.log(`  [indeed] SKIPPED — total pool $${totalRemaining.toFixed(2)} < $0.25`);
    return [];
  }

  const cfg  = readConfig('indeed');
  const rows = [];

  for (const [testName, q] of Object.entries(cfg.tests)) {
    // Check fresh pool budget before each query
    const poolNow = pool.reduce((s, k) => s + k.remaining, 0);
    if (poolNow < 0.25) {
      console.log(`  [indeed] budget exhausted after ${rows.length} results, stopping`);
      break;
    }
    const { key } = pickKey(pool, 0.25);
    console.log(`  [indeed/${testName}] "${q.position}" country=${q.country}`);
    try {
      const items = await apifyRun(key, cfg.actor_id, {
        position: q.position, location: q.location, country: q.country, maxItems: q.maxItems ?? 50,
      });
      let valid = 0;
      for (const item of items) {
        if (!item.id) continue;
        rows.push(normIndeed(item, clientId, q.country));
        valid++;
      }
      console.log(`  [indeed/${testName}] raw=${items.length} valid=${valid}`);
    } catch (e) {
      console.error(`  [indeed/${testName}] ERROR: ${e.message}`);
    }
  }
  return rows;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== scrape_jobs.mjs ===');
  console.log(`client: ${CLIENT_SLUG}`);

  const clientId = await getClientId(CLIENT_SLUG);
  console.log(`client_id: ${clientId}\n`);

  // Pre-load key pool once (all scrape functions share it)
  await loadKeyPool();

  const runId = await startRun({ clientId, script: 'scrape_jobs', source: 'job_boards' });
  const stats  = { scraped: 0, pushed: 0 };
  const errors = [];

  const sources = [
    { name: 'linkedin',   fn: (c) => scrapeLinkedIn(c) },
    { name: 'stepstone',  fn: (c) => scrapeStepStone(c) },
    { name: 'xing',       fn: (c) => scrapeXing(c) },
    { name: 'cadremploi', fn: (c) => scrapeCadremploi(c) },
    { name: 'indeed',     fn: (c) => scrapeIndeed(c) },
  ];

  for (const { name, fn } of sources) {
    console.log(`\n[${name}]`);
    try {
      const rows   = await fn(clientId);
      stats.scraped += rows.length;
      const pushed  = await flushToDb(name, rows);
      stats.pushed += pushed;
    } catch (e) {
      console.error(`[${name}] FATAL: ${e.message}`);
      errors.push(`${name}: ${e.message}`);
    }
  }

  console.log('\n=== DONE ===');
  console.log(`total scraped : ${stats.scraped}`);
  console.log(`total pushed  : ${stats.pushed}`);
  if (errors.length) console.log(`errors        : ${errors.join(', ')}`);

  await finishRun(runId, {
    status: errors.length ? 'partial' : 'success',
    stats,
    errors,
  });
}

export { main as run };

import { pathToFileURL } from 'url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
