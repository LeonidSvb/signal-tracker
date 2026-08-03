#!/usr/bin/env node
// Email finder for contacts that have a LinkedIn URL but no email — Blitz's own
// /v2/enrichment/email is dead (BLITZ_API_KEY invalid, confirmed live 2026-08-01, 401 on
// every endpoint) and its Apify budget is separately exhausted (2026-07-31), so this is now
// the primary email-finding path, not a fallback. Leo's call, 2026-08-02: wire LeadsFriday's
// waterfall_email_finder in for real.
//
// Two-phase, matching the async reality (LeadsFriday jobs take HOURS, not seconds):
//   1. CHECK  — every pending run (a runs/find_emails_leadsfriday_* dir with a checkpoint.json
//      but no manifest.json yet — same triad convention as every other stage) gets polled; any
//      now-delivered order has its results downloaded and patched into contacts.email.
//   2. SUBMIT — new candidates (linkedin_url set, email null, not already in an in-flight
//      order) get submitted as a fresh dated run. LeadsFriday reserves credits per REQUESTED
//      row up front (not per found result — unused reservation is refunded after delivery),
//      so a big candidate pool can get rejected with "Not enough credits" even though the
//      real final cost (after refunds) would fit. Confirmed live 2026-08-02: order for 613
//      rows rejected needing 7.36 credits reserved with only 6.29 available; a 500-row order
//      (6.00 reserved) went through fine. Handled here by halving the batch and retrying
//      instead of just failing — and when even a small batch won't fit, this reports it
//      PLAINLY (console + pipeline_runs.errors + manifest) rather than silently doing nothing,
//      per Leo's explicit ask: "чтобы если нет баланса то это было понятно".
//
// Does NOT port validate-catchall-bounceban.py's caching/polling logic to JS, same rule as
// validateEmail.mjs — this shells out to the existing, working
// scripts/enrichment/leadsfriday_email_finder.py for the actual submit/download mechanics.
//
// Safety: DRY RUN by default (prints candidate count, zero spend). --live required to
// actually submit. Per project rule, only run --live after Leo says "запускай".
//
// Run: node --env-file=nextjs/.env.local pipeline/stages/find_emails_leadsfriday.mjs --live

import { spawn } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { selectAll, patch } from '../lib/supabase.mjs';
import { getClientId, startRun, finishRun } from '../lib/log.mjs';
import { validateBatch } from '../lib/validateEmail.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '../../../../..');
const PY_SCRIPT = join(REPO_ROOT, 'scripts/enrichment/leadsfriday_email_finder.py');
const RUNS_DIR = join(__dir, '../runs');
const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const limitArg = args.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
// Orders complete in HOURS, not the 7 days between weekly runs — a delivered order used to
// sit unpatched until next Monday. --check-only skips Phase 2 (submit) entirely so this can
// run on its own tight cadence (2026-08-02: a dedicated crontab entry every 3h, plus it's
// also folded into DAILY_CHAIN as a belt-and-suspenders daily catch) without ever hitting
// LeadsFriday's submit endpoint more than once a week. Checking costs nothing (a GET, no
// credits) — safe to poll often; submitting is the part rationed to weekly.
const CHECK_ONLY = args.includes('--check-only');

const PYTHON_BIN = process.platform === 'win32' ? 'python' : 'python3';
// Minimum batch size worth retrying at — below this, one row's worth of credit shortfall
// isn't worth the extra API round-trips, just report and stop.
const MIN_BATCH = 10;
// Leo's call, 2026-08-02: a single 500-row order sat "in_progress" for hours with no
// visibility into partial failure — split submissions into MAX_BATCH-sized chunks instead
// of one big order. Each chunk gets its own runs/ dir (checked independently on the
// existing 3h cron), so a problem with one chunk doesn't block/hide the rest, and the
// per-chunk credit reservation is smaller (less at risk if a batch needs the halving retry).
const MAX_BATCH = 50;

function runPython(pyArgs) {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON_BIN, [PY_SCRIPT, ...pyArgs], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d; process.stdout.write(d); });
    proc.stderr.on('data', d => { stderr += d; process.stderr.write(d); });
    proc.on('exit', code => resolve({ code, stdout, stderr }));
  });
}

function listPendingRunDirs() {
  if (!existsSync(RUNS_DIR)) return [];
  return readdirSync(RUNS_DIR)
    .filter(name => name.startsWith('find_emails_leadsfriday_'))
    .map(name => join(RUNS_DIR, name))
    .filter(dir => existsSync(join(dir, 'checkpoint.json')) && !existsSync(join(dir, 'manifest.json')));
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

export async function run() {
  console.log(`\n=== find_emails_leadsfriday.mjs === mode=${LIVE ? 'LIVE (spends money)' : 'DRY RUN (no spend)'}`);

  const clientId = await getClientId(CLIENT_SLUG);
  const runId = LIVE ? await startRun({ clientId, script: 'find_emails_leadsfriday', source: 'leadsfriday' }) : null;

  const stats = { checked: 0, delivered: 0, emailsFound: 0, submitted: 0, batchSizeUsed: 0, insufficientBalance: false, freed: 0, errors: [] };

  // Fetched once, up front — Phase 1's patch-by-id and Phase 2's candidate selection both
  // need it. No other stage in this codebase patches contacts by linkedin_url (always id) —
  // matching that convention avoids trusting a raw URL value (`%`, `:`, `?params`) inside a
  // PostgREST `in.()` filter list unescaped.
  const contacts = await selectAll('contacts', { client_id: clientId }, { select: 'id,full_name,linkedin_url,company_id,email' });
  const companies = await selectAll('companies', { client_id: clientId }, { select: 'id,domain' });
  const domainByCompany = new Map(companies.map(c => [c.id, c.domain]));
  const contactIdByLinkedin = new Map(contacts.filter(c => c.linkedin_url).map(c => [c.linkedin_url, c.id]));

  // ── Phase 1: check every pending order ──────────────────────────────────────
  // Listing pending dirs and reading their local input.jsonl costs nothing (no API call) —
  // done even in dry-run so the candidate preview below doesn't double-count contacts
  // that are already sitting in an in-flight order. Only the actual --check network call
  // (harmless itself, but this stage's dry-run stays zero-network like every other stage
  // here) is gated behind LIVE.
  const pendingDirs = listPendingRunDirs();
  const inFlightLinkedinUrls = new Set();
  for (const dir of pendingDirs) {
    for (const row of readJsonl(join(dir, 'input.jsonl'))) {
      if (row.linkedin_url) inFlightLinkedinUrls.add(row.linkedin_url);
    }
  }
  for (const dir of LIVE ? pendingDirs : []) {
    stats.checked++;
    const { code, stdout } = await runPython(['--check', '--output-dir', dir]);
    if (code !== 0) { stats.errors.push(`check ${dir} failed`); continue; }

    // Terminal-without-results (found live 2026-08-03: order #83, a 500-row batch, sat
    // "cancelled" — LeadsFriday's own server hiccup, NOT charged: "We didn't charge any
    // credits for this. Please submit it again" — 165 already-found emails genuinely lost,
    // no delivery_file ever gets created for a cancelled order, nothing to download). Without
    // this, listPendingRunDirs() would keep returning this dir forever (no manifest.json ever
    // gets written) and every one of its rows stays wrongly marked in-flight — permanently
    // blocking them from ever being resubmitted. Write a manifest so the triad convention's
    // own "no manifest = still pending" check retires it, and free its rows for next run.
    const statusMatch = stdout.match(/status=(\w+)/);
    if (statusMatch && statusMatch[1] !== 'delivered' && !stdout.includes('Delivered:')) {
      const status = statusMatch[1];
      if (status !== 'in_progress' && status !== 'processing' && status !== 'pending') {
        writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
          date: new Date().toISOString().slice(0, 19), status, note: 'terminal without delivery — see stdout captured below', stdout: stdout.trim(),
        }, null, 2));
        const freed = readJsonl(join(dir, 'input.jsonl')).map(r => r.linkedin_url).filter(Boolean);
        for (const url of freed) inFlightLinkedinUrls.delete(url);
        stats.freed += freed.length; // informational, NOT pushed to stats.errors — this is
        // expected self-healing, not a failure; CHECK_ONLY's status line treats any
        // stats.errors entry as status=error, which would false-alarm every time an order
        // legitimately ends without delivery (LeadsFriday-side cancellation, no fault here).
        console.log(`[find_emails_leadsfriday] ${dir}: ${status}, not delivered — ${freed.length} contacts freed for resubmission`);
      }
      continue;
    }
    if (!stdout.includes('Delivered:')) continue; // still in_progress, nothing to patch yet

    const rows = readJsonl(join(dir, 'result.jsonl'));

    // Event-driven validation (2026-08-03, Leo's call): used to write email_status='pending'
    // and rely on validate_contacts.mjs's WEEKLY sweep to eventually verify it — found live
    // 2026-08-03 that this left 442 freshly-found emails sitting unvalidated for up to 7 days
    // after a single 759-contact submission burst. Leo's explicit preference: validate at the
    // moment a new email actually appears, not on a cron. BounceBan runs ONCE per delivered
    // order here (not per-email — same batching convention validate_contacts.mjs itself uses)
    // right before the DB write, so every contact gets its REAL verdict on the first patch,
    // never a placeholder 'pending' that depends on a separate stage ever running.
    const foundRows = rows.filter(r => r.status === 'found' && r.email && r.linkedin_url);
    const emailsToValidate = foundRows.map(r => r.email.toLowerCase().trim());
    let verdicts = new Map();
    if (emailsToValidate.length) {
      try {
        ({ verdicts } = await validateBatch(emailsToValidate, join(dir, 'validation')));
      } catch (e) {
        stats.errors.push(`BounceBan validation failed for ${dir}: ${e.message} — emails patched as 'pending', will need a manual/weekly validate_contacts pass`);
      }
    }

    for (const r of foundRows) {
      const contactId = contactIdByLinkedin.get(r.linkedin_url);
      if (!contactId) { stats.errors.push(`no contact match for ${r.linkedin_url}`); continue; }
      const email = r.email.toLowerCase().trim();
      const verdict = verdicts.get(email); // undefined if BounceBan call itself failed above
      const emailStatus = verdict === 'sendable' ? 'verified' : verdict === 'dead' ? 'invalid' : 'pending';
      try {
        await patch('contacts', 'id', [contactId], {
          email,
          email_status: emailStatus,
          ...(verdict ? { email_validated_at: new Date().toISOString(), email_validation_detail: { verdict, cascade: 'bounceban', run_id: runId } } : {}),
        });
        stats.emailsFound++;
      } catch (e) {
        stats.errors.push(`patch ${r.linkedin_url}: ${e.message}`);
      }
    }
    stats.delivered++;
    for (const r of rows) inFlightLinkedinUrls.delete(r.linkedin_url); // delivered, no longer in-flight
    console.log(`[find_emails_leadsfriday] ${dir}: delivered, ${rows.filter(r => r.status === 'found').length} emails patched`);
  }

  if (CHECK_ONLY) {
    // Was hardcoded 'success' regardless of stats.errors — found live 2026-08-02: the
    // LeadsFriday token expired and every --check call 401'd, but the cron log still read
    // "status=success scraped=0 pushed=0" for hours, masking a real outage.
    const status = stats.errors.length ? 'error' : 'success';
    await finishRun(runId, { status, stats: { scraped: 0, pushed: stats.emailsFound }, errors: stats.errors });
    if (stats.errors.length) console.log(`\n*** ${stats.errors.length} check error(s): ${stats.errors.join(' | ')} ***`);
    console.log('=== DONE (--check-only, submit phase skipped) ===');
    return stats;
  }

  // ── Phase 2: submit new candidates ──────────────────────────────────────────

  const candidates = contacts
    .filter(c => c.linkedin_url && !c.email && !inFlightLinkedinUrls.has(c.linkedin_url))
    .slice(0, LIMIT);

  console.log(`candidates (linkedin known, email missing, not already in-flight): ${candidates.length}`);

  if (!candidates.length) {
    await finishRun(runId, { status: 'success', stats: { scraped: 0, pushed: stats.emailsFound }, errors: stats.errors });
    console.log('=== DONE (nothing new to submit) ===');
    return stats;
  }

  if (!LIVE) {
    console.log(candidates.slice(0, 20).map(c => c.full_name));
    await finishRun(runId, { status: 'success', stats: { scraped: candidates.length, pushed: 0 } });
    return { ...stats, dryRun: true, candidates: candidates.length };
  }

  const dateStr = new Date().toISOString().slice(0, 10);

  // Chunk into MAX_BATCH-sized orders instead of one big submit — each chunk gets its own
  // runs/ dir + own LeadsFriday order_id, checked independently by the existing 3h cron.
  let remaining = candidates;
  let chunkIndex = 0;
  const submittedChunks = [];
  while (remaining.length > 0) {
    let batch = remaining.slice(0, MAX_BATCH);
    let submitted = false;
    let hardFailure = null; // set when the failure is NOT a credit-shortfall (e.g. auth) — don't mislabel it as balance below

    while (batch.length >= MIN_BATCH) {
      chunkIndex++;
      const RUN_DIR = join(RUNS_DIR, `find_emails_leadsfriday_${dateStr}_${chunkIndex}`);
      mkdirSync(RUN_DIR, { recursive: true });

      const rows = batch.map(c => {
        const parts = (c.full_name || '').split(' ');
        return {
          first_name: parts[0] || '',
          last_name: parts.slice(1).join(' '),
          full_name: c.full_name || '',
          domain: domainByCompany.get(c.company_id) || '',
          linkedin_url: c.linkedin_url,
        };
      });
      writeFileSync(join(RUN_DIR, 'input.jsonl'), rows.map(r => JSON.stringify(r)).join('\n'));

      const { code, stderr } = await runPython(['--submit', '--input', join(RUN_DIR, 'input.jsonl'), '--output-dir', RUN_DIR, '--tool', 'waterfall_email_finder']);
      if (code === 0) {
        stats.submitted += batch.length;
        stats.batchSizeUsed = batch.length;
        submittedChunks.push({ dir: RUN_DIR, size: batch.length });
        submitted = true;
        break;
      }
      if (!stderr.includes('Not enough credits')) {
        // Found live 2026-08-02: an expired-token 401 fell through to the generic
        // "balance too low" message below, which is just wrong — token expiry has nothing
        // to do with balance and sends Leo looking in the wrong place. Report the real cause.
        hardFailure = stderr.slice(0, 300);
        stats.errors.push(`submit failed (chunk ${chunkIndex}): ${hardFailure}`);
        break;
      }
      // Insufficient balance for this size — halve and retry. The error only tells us the
      // reservation requirement for the size we tried, not the actual available balance, so
      // halving (not solving for an exact number) is the only thing we can do without a
      // balance endpoint (checked live 2026-08-02 — LeadsFriday doesn't expose one).
      console.log(`[find_emails_leadsfriday] chunk ${chunkIndex}: ${batch.length} rows needs more credit than available — retrying at ${Math.floor(batch.length / 2)}`);
      batch = batch.slice(0, Math.floor(batch.length / 2));
    }

    if (!submitted) {
      const leftover = remaining.length;
      const msg = hardFailure
        ? `LeadsFriday submit failed (not a balance issue): ${hardFailure} — ${leftover} contacts still waiting (${submittedChunks.length} chunk(s) already submitted this run).`
        : `LeadsFriday balance too low to submit even ${MIN_BATCH} rows — top up at app.leadsfriday.com before this stage can find more emails. ${leftover} contacts still waiting (${submittedChunks.length} chunk(s) already submitted this run).`;
      if (!hardFailure) stats.insufficientBalance = true;
      console.log(`\n*** ${msg} ***\n`);
      stats.errors.push(msg);
      break; // whatever the cause, no point trying further chunks this run
    }

    remaining = remaining.slice(batch.length);
  }

  if (submittedChunks.length) {
    console.log(`[find_emails_leadsfriday] submitted ${submittedChunks.length} chunk(s), ${stats.submitted}/${candidates.length} candidates total.`);
  }

  console.log('\n=== STATS ===');
  console.log(JSON.stringify(stats, null, 2));
  await finishRun(runId, {
    status: stats.errors.length && !submittedChunks.length ? 'partial' : 'success',
    stats: { scraped: candidates.length, pushed: stats.emailsFound },
    errors: stats.errors,
  });
  console.log('=== DONE ===');
  return stats;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error(e); process.exit(1); });
}
