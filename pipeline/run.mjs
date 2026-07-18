#!/usr/bin/env node
// Weekly pipeline orchestrator — runs resolve_companies → find_contacts → score_signals.
// scrape_jobs and filter_icp run separately or via --all flag.
//
// Usage:
//   node --env-file=nextjs/.env.local pipeline/run.mjs              # resolve+contacts+score only
//   node --env-file=nextjs/.env.local pipeline/run.mjs --all        # full pipeline (scrape→score)
//   node --env-file=nextjs/.env.local pipeline/run.mjs --skip-contacts  # skip Blitz
//   node --env-file=nextjs/.env.local pipeline/run.mjs --score-only     # only score_signals
//   node --env-file=nextjs/.env.local pipeline/run.mjs --with-routing   # ALSO run
//     route_email + build_linkedin_queue after score_signals — BEHIND A FLAG, not
//     part of --all or the default run, because both stages depend on migration 005
//     (companies.tier/rank, signals.event_key, channel_actions) and rank_leads.mjs,
//     neither of which exist yet (D4/E1 in HANDOFF_2026-07-15_scoring_two_channel.md,
//     SONNET-FIRST MODE: "code them... don't enable"). Do not remove this gate until
//     migration 005 is live and rank_leads.mjs is wired in above.

import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const runAll       = args.includes('--all');
const skipContacts = args.includes('--skip-contacts');
const scoreOnly    = args.includes('--score-only');
const withRouting  = args.includes('--with-routing');

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
    const { run: runScrape } = await import('./stages/scrape_jobs.mjs');
    results['scrape_jobs'] = await runStage('scrape_jobs', runScrape);
    if (!results['scrape_jobs'].ok) {
      console.error('scrape_jobs failed — aborting pipeline');
      process.exit(1);
    }

    const { run: runFilter } = await import('./stages/filter_icp.mjs');
    results['filter_icp'] = await runStage('filter_icp', runFilter);
  }

  if (!scoreOnly) {
    const { run: runResolve } = await import('./stages/resolve_companies.mjs');
    results['resolve_companies'] = await runStage('resolve_companies', runResolve);

    if (!skipContacts) {
      const { run: runContacts } = await import('./stages/find_contacts.mjs');
      results['find_contacts'] = await runStage('find_contacts', runContacts);
    }
  }

  const { run: runScore } = await import('./stages/score_signals.mjs');
  results['score_signals'] = await runStage('score_signals', runScore);

  // --with-routing: opt-in only, see usage note above — route_email/build_linkedin_queue
  // both require migration 005 + rank_leads.mjs, neither of which is wired in yet.
  if (withRouting) {
    const { run: runRouteEmail } = await import('./stages/route_email.mjs');
    results['route_email'] = await runStage('route_email', runRouteEmail);

    const { run: runLinkedinQueue } = await import('./stages/build_linkedin_queue.mjs');
    results['build_linkedin_queue'] = await runStage('build_linkedin_queue', runLinkedinQueue);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`PIPELINE DONE in ${elapsed}s`);
  for (const [stage, res] of Object.entries(results)) {
    const status = res.ok ? 'OK' : 'FAILED';
    console.log(`  ${stage.padEnd(25)} ${status}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
