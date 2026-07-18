#!/usr/bin/env node
// Pipeline orchestrator (C-D1/C-D2/C-D4, docs/PLAN_2026-07-18_backend_hardening.md).
// Single entry point for the two cron cadences:
//
//   node --env-file=nextjs/.env.local pipeline/run.mjs --weekly --live   # Mon 08:00 UTC
//   node --env-file=nextjs/.env.local pipeline/run.mjs --daily --live    # daily 08:00 UTC
//
// Without --live this is a REHEARSAL: stages that have a --live flag run in their
// own dry mode (free preview), stages that are inherently live (scrape_jobs,
// filter_icp, find_contacts, score_signals — they spend or write the moment they
// run) are SKIPPED entirely, so a no-flag orchestrator run never spends a cent.
//
// Actor triggering: scrape_jobs.mjs already starts the Apify actors itself through
// scripts/utils/apify-key-pool.mjs (pickKey rotation, per-source budget guards) and
// waits for their results — so "the cron triggers the actors with key rotation"
// (C-D1) is simply "the weekly chain starts with scrape_jobs". No native Apify
// Schedules anywhere, per Leo's key-rotation call 2026-07-18.
//
// Each stage runs as a CHILD PROCESS, not an import — the previous orchestrator
// imported stage modules, which made every stage parse the ORCHESTRATOR's argv at
// module load (a stage seeing "--weekly" — or worse, a future flag collision) and
// shared one process for stages designed to run standalone. Sequential, one at a
// time, per Leo's standing rate-limit rules.
//
// Failure policy (C-D2/C-D4): a stage exiting non-zero aborts the remaining chain
// (downstream stages read what upstream writes — running them after a hard failure
// produces confidently-wrong output), EXCEPT non_fatal stages (report generation)
// whose failure just marks the run partial. Stage-internal partial success
// (scrape_jobs losing one board) exits 0 and is already recorded per-stage in
// pipeline_runs by the stage itself. The orchestrator writes its OWN pipeline_runs
// row (script: run_weekly | run_daily) with per-stage status/duration in stats
// jsonb, so "did the whole chain run last Monday" is one query on the Health page.

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const WEEKLY = args.includes('--weekly');
const DAILY  = args.includes('--daily');
const LIVE   = args.includes('--live');

const STAGE_TIMEOUT_MS = 120 * 60 * 1000; // 2h hard ceiling per stage — a hung actor
// poll or wedged HTTP call must not stall the whole cron slot forever.

// mode:
//   'flagged'     — stage has its own --live gate; orchestrator passes --live through.
//                   Without --live it runs in the stage's dry mode (free).
//   'always_live' — running it at all spends/writes; skipped entirely unless --live.
// non_fatal: failure marks the chain partial instead of aborting it.
const WEEKLY_CHAIN = [
  { name: 'scrape_jobs',        mode: 'always_live' },
  { name: 'filter_icp',         mode: 'always_live' },
  { name: 'resolve_companies',  mode: 'flagged' },
  { name: 'find_contacts',      mode: 'always_live' },
  { name: 'find_contacts_exa',  mode: 'flagged' },
  { name: 'classify_company',   mode: 'flagged' },
  { name: 'score_signals',      mode: 'always_live' },
  { name: 'validate_contacts',  mode: 'flagged' },
  { name: 'rank_leads',         mode: 'flagged' },
  { name: 'route_email',        mode: 'flagged' },
  { name: 'build_signal_report', mode: 'always_live', non_fatal: true },
];

const DAILY_CHAIN = [
  { name: 'rank_leads',           mode: 'flagged' },
  { name: 'build_linkedin_queue', mode: 'flagged' },
];

function runStageProcess(name, extraArgs) {
  const stagePath = join(__dir, 'stages', `${name}.mjs`);
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [stagePath, ...extraArgs], {
      stdio: 'inherit',
      env: process.env, // cron runs the orchestrator with --env-file; children inherit
    });
    const killer = setTimeout(() => {
      console.error(`[${name}] TIMEOUT after ${STAGE_TIMEOUT_MS / 60000}min — killing`);
      child.kill('SIGKILL');
    }, STAGE_TIMEOUT_MS);
    child.on('exit', (code, signal) => {
      clearTimeout(killer);
      const seconds = +((Date.now() - t0) / 1000).toFixed(1);
      resolve({ name, code, signal, seconds, ok: code === 0 });
    });
    child.on('error', (e) => {
      clearTimeout(killer);
      resolve({ name, code: -1, error: e.message, seconds: +((Date.now() - t0) / 1000).toFixed(1), ok: false });
    });
  });
}

async function main() {
  if (WEEKLY === DAILY) { // neither or both
    console.error('Usage: node pipeline/run.mjs (--weekly | --daily) [--live]');
    process.exit(2);
  }
  const chain = WEEKLY ? WEEKLY_CHAIN : DAILY_CHAIN;
  const label = WEEKLY ? 'run_weekly' : 'run_daily';

  console.log(`=== PIPELINE ORCHESTRATOR === ${label} mode=${LIVE ? 'LIVE' : 'REHEARSAL (no spend: flagged stages dry, always-live stages skipped)'}`);
  console.log(new Date().toISOString());

  // Orchestrator's own pipeline_runs row — LIVE only, same dry-run-doesn't-log rule
  // as every stage (a2923a2). Imported lazily so a bad env fails loudly here, once.
  let runId = null, finishRun = null;
  if (LIVE) {
    const log = await import('./lib/log.mjs');
    finishRun = log.finishRun;
    const clientId = await log.getClientId(process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon');
    runId = await log.startRun({ clientId, script: label, source: 'orchestrator' });
  }

  const t0 = Date.now();
  const results = [];
  let aborted = false;

  for (const stage of chain) {
    if (aborted) { results.push({ name: stage.name, skipped: 'upstream_failure' }); continue; }

    if (!existsSync(join(__dir, 'stages', `${stage.name}.mjs`))) {
      console.log(`\n[${stage.name}] stage file missing — skipped`);
      results.push({ name: stage.name, skipped: 'missing' });
      continue;
    }
    if (!LIVE && stage.mode === 'always_live') {
      console.log(`\n[${stage.name}] SKIPPED in rehearsal (inherently live — would spend/write)`);
      results.push({ name: stage.name, skipped: 'rehearsal' });
      continue;
    }

    console.log(`\n${'─'.repeat(60)}\n[${stage.name}] starting...`);
    const stageArgs = stage.mode === 'flagged' && LIVE ? ['--live'] : [];
    const res = await runStageProcess(stage.name, stageArgs);
    results.push(res);
    console.log(`[${stage.name}] ${res.ok ? 'OK' : `FAILED (exit ${res.code}${res.signal ? `, ${res.signal}` : ''})`} in ${res.seconds}s`);

    if (!res.ok && !stage.non_fatal) {
      console.error(`[${stage.name}] hard failure — aborting remaining chain (downstream reads upstream's writes)`);
      aborted = true;
    }
  }

  const totalSec = +((Date.now() - t0) / 1000).toFixed(1);
  const failed = results.filter(r => r.ok === false);
  const status = aborted ? 'error' : failed.length ? 'partial' : 'success';

  console.log(`\n${'═'.repeat(60)}\n${label} ${status.toUpperCase()} in ${totalSec}s`);
  for (const r of results) {
    console.log(`  ${r.name.padEnd(24)} ${r.skipped ? `skipped (${r.skipped})` : r.ok ? `OK ${r.seconds}s` : `FAILED ${r.seconds}s`}`);
  }

  if (LIVE && finishRun) {
    await finishRun(runId, { status, stats: { total_seconds: totalSec, stages: results } });
  }
  process.exit(aborted ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
