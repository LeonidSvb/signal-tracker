#!/usr/bin/env node
// Weekly pipeline orchestrator — runs stages 03 → 04 → 05.
// Stages 01 (scrape) and 02 (filter) run separately or via --all flag.
//
// Usage:
//   node --env-file=nextjs/.env.local pipeline/run.mjs              # stages 03-05 only
//   node --env-file=nextjs/.env.local pipeline/run.mjs --all        # stages 01-05
//   node --env-file=nextjs/.env.local pipeline/run.mjs --skip-contacts  # skip Blitz
//   node --env-file=nextjs/.env.local pipeline/run.mjs --score-only     # only stage 05

import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const runAll       = args.includes('--all');
const skipContacts = args.includes('--skip-contacts');
const scoreOnly    = args.includes('--score-only');

async function runStage(name, fn) {
  console.log(`\n${'─'.repeat(50)}`);
  const t0 = Date.now();
  try {
    const result = await fn();
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[${name}] ✓ ${elapsed}s`);
    return { ok: true, result };
  } catch (e) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`[${name}] FAILED ${elapsed}s: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

async function main() {
  console.log('=== PIPELINE run.mjs ===');
  console.log(new Date().toISOString());
  const t0 = Date.now();
  const results = {};

  if (runAll && !scoreOnly) {
    const { run: run01 } = await import('./stages/01_scrape_jobs.mjs');
    results['01_scrape_jobs'] = await runStage('01_scrape_jobs', run01);
    if (!results['01_scrape_jobs'].ok) {
      console.error('stage 01 failed — aborting pipeline');
      process.exit(1);
    }

    const { run: run02 } = await import('./stages/02_filter.mjs');
    results['02_filter'] = await runStage('02_filter', run02);
  }

  if (!scoreOnly) {
    const { run: run03 } = await import('./stages/03_resolve_companies.mjs');
    results['03_resolve_companies'] = await runStage('03_resolve_companies', run03);

    if (!skipContacts) {
      const { run: run04 } = await import('./stages/04_find_contacts.mjs');
      results['04_find_contacts'] = await runStage('04_find_contacts', run04);
    }
  }

  const { run: run05 } = await import('./stages/05_score_llm.mjs');
  results['05_score_llm'] = await runStage('05_score_llm', run05);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`PIPELINE DONE in ${elapsed}s`);
  for (const [stage, res] of Object.entries(results)) {
    const status = res.ok ? 'OK' : 'FAILED';
    console.log(`  ${stage.padEnd(25)} ${status}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
