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
  // Backfills companies.linkedin_url via Exa where Blitz's own domain match missed it (found
  // live 2026-07-31: 7/7 spot-checked real companies had a findable page, none had linkedin_url
  // set) — placed right before find_contacts_exa so this run's freshly-resolved companies
  // immediately become that stage's gap-mode candidates, not next week's.
  { name: 'resolve_linkedin',   mode: 'flagged' },
  { name: 'find_contacts_exa',  mode: 'flagged' },
  // Blitz's /v2/enrichment/email is dead (BLITZ_API_KEY invalid, confirmed 2026-08-01, 401 on
  // every endpoint) — LeadsFriday's waterfall_email_finder is now the primary email-finding
  // path, not a fallback. Async (hours), so this call is really "check last week's pending
  // orders, submit this week's new candidates" — see the stage's own header for the full
  // credit-reservation-vs-actual-cost story (2026-08-02).
  { name: 'find_emails_leadsfriday', mode: 'flagged' },
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
  // Check-only: orders complete in hours, not the 7 days between weekly runs — this catches
  // a delivered LeadsFriday order same-day/next-day instead of up to a week late. Submission
  // stays weekly-only (extraArgs skips Phase 2 entirely, see the stage's own header).
  { name: 'find_emails_leadsfriday', mode: 'flagged', extraArgs: ['--check-only'] },
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

async function runChain(chain, label, log) {
  console.log(`\n=== PIPELINE ORCHESTRATOR === ${label} mode=${LIVE ? 'LIVE' : 'REHEARSAL (no spend: flagged stages dry, always-live stages skipped)'}`);
  console.log(new Date().toISOString());

  let runId = null;
  if (LIVE && log) {
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
    const stageArgs = [...(stage.mode === 'flagged' && LIVE ? ['--live'] : []), ...(stage.extraArgs || [])];
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

  if (LIVE && log) {
    await log.finishRun(runId, { status, stats: { total_seconds: totalSec, stages: results } });
  }
  return { status, aborted };
}

// Self-healing (2026-08-02, Leo's ask): the weekly cron fires ONCE, Monday 08:00 UTC —
// no retry anywhere, cron-level or in-process. A hard failure used to mean a full 7-day
// stall with nobody aware until someone checked manually (exactly what happened
// 2026-07-20..31, see CHANGELOG). The daily cron already runs every day for free
// (rank_leads/build_linkedin_queue) — piggyback on it: if the LAST run_weekly logged
// status=error, retry the full WEEKLY_CHAIN before doing the day's normal daily work.
// Caps the real-world stall to ~1 day instead of ~7 without any new cron entry or
// retry infrastructure. Runs at most once per daily invocation — if the retry also
// fails, tomorrow's daily tries again, same as any other day.
async function maybeRetryFailedWeekly(log) {
  const clientId = await log.getClientId(process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon');
  const { selectAll } = await import('./lib/supabase.mjs');
  const recent = await selectAll(
    'pipeline_runs',
    { client_id: clientId, script: 'run_weekly' },
    { select: 'status,started_at', timeoutMs: 30_000 }
  );
  if (!recent.length) return;
  recent.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  const last = recent[0];

  // 'running' with no finish is either a genuinely-still-going run (e.g. the same Monday's
  // weekly, only ~2h into a run that can legitimately take longer) or an orphaned row from a
  // killed/crashed process (confirmed live 2026-07-31 — Leo killed a run mid-flight, its row
  // sat at 'running' forever since finishRun() never got to execute). 6h is well past every
  // observed real weekly duration, so treat only OLD 'running' rows as stuck, never a same-day one.
  const STUCK_RUNNING_MS = 6 * 60 * 60 * 1000;
  const ageMs = Date.now() - new Date(last.started_at).getTime();
  const isStuckRunning = last.status === 'running' && ageMs > STUCK_RUNNING_MS;
  if (last.status !== 'error' && !isStuckRunning) return;

  console.log(`\n*** last run_weekly (${last.started_at}, status=${last.status}) needs a retry — running the full weekly chain before today's daily work ***`);
  await runChain(WEEKLY_CHAIN, 'run_weekly', log);
}

async function main() {
  if (WEEKLY === DAILY) { // neither or both
    console.error('Usage: node pipeline/run.mjs (--weekly | --daily) [--live]');
    process.exit(2);
  }

  // Imported lazily so a bad env fails loudly here, once — same as the old inline import.
  const log = LIVE ? await import('./lib/log.mjs') : null;

  if (DAILY && LIVE) await maybeRetryFailedWeekly(log);

  const chain = WEEKLY ? WEEKLY_CHAIN : DAILY_CHAIN;
  const label = WEEKLY ? 'run_weekly' : 'run_daily';
  const { aborted } = await runChain(chain, label, log);
  process.exit(aborted ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
