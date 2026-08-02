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

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '../../../../..');
const PY_SCRIPT = join(REPO_ROOT, 'scripts/enrichment/leadsfriday_email_finder.py');
const RUNS_DIR = join(__dir, '../runs');
const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const limitArg = args.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

const PYTHON_BIN = process.platform === 'win32' ? 'python' : 'python3';
// Minimum batch size worth retrying at — below this, one row's worth of credit shortfall
// isn't worth the extra API round-trips, just report and stop.
const MIN_BATCH = 10;

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

  const stats = { checked: 0, delivered: 0, emailsFound: 0, submitted: 0, batchSizeUsed: 0, insufficientBalance: false, errors: [] };

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
    if (!stdout.includes('Delivered:')) continue; // still in_progress, nothing to patch yet

    const rows = readJsonl(join(dir, 'result.jsonl'));
    for (const r of rows) {
      if (r.status !== 'found' || !r.email || !r.linkedin_url) continue;
      const contactId = contactIdByLinkedin.get(r.linkedin_url);
      if (!contactId) { stats.errors.push(`no contact match for ${r.linkedin_url}`); continue; }
      try {
        await patch('contacts', 'id', [contactId], {
          email: r.email.toLowerCase().trim(),
          email_status: 'pending', // needs validate_contacts.mjs's own BounceBan pass before it's 'verified'
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

  const RUN_DIR = join(RUNS_DIR, `find_emails_leadsfriday_${new Date().toISOString().slice(0, 10)}`);
  mkdirSync(RUN_DIR, { recursive: true });

  let batch = candidates;
  let submitted = false;
  while (batch.length >= MIN_BATCH) {
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
      stats.submitted = batch.length;
      stats.batchSizeUsed = batch.length;
      submitted = true;
      break;
    }
    if (!stderr.includes('Not enough credits')) {
      stats.errors.push(`submit failed: ${stderr.slice(0, 300)}`);
      break;
    }
    // Insufficient balance for this size — halve and retry. The error only tells us the
    // reservation requirement for the size we tried, not the actual available balance, so
    // halving (not solving for an exact number) is the only thing we can do without a
    // balance endpoint (checked live 2026-08-02 — LeadsFriday doesn't expose one).
    console.log(`[find_emails_leadsfriday] ${batch.length} rows needs more credit than available — retrying at ${Math.floor(batch.length / 2)}`);
    batch = batch.slice(0, Math.floor(batch.length / 2));
  }

  if (!submitted) {
    stats.insufficientBalance = true;
    const msg = `LeadsFriday balance too low to submit even ${MIN_BATCH} rows — top up at app.leadsfriday.com before this stage can find more emails. ${candidates.length} contacts still waiting.`;
    console.log(`\n*** ${msg} ***\n`);
    stats.errors.push(msg);
  } else if (batch.length < candidates.length) {
    console.log(`[find_emails_leadsfriday] submitted ${batch.length}/${candidates.length} — remaining ${candidates.length - batch.length} will be picked up next run once balance allows.`);
  }

  console.log('\n=== STATS ===');
  console.log(JSON.stringify(stats, null, 2));
  await finishRun(runId, {
    status: stats.errors.length && !submitted ? 'partial' : 'success',
    stats: { scraped: candidates.length, pushed: stats.emailsFound },
    errors: stats.errors,
  });
  console.log('=== DONE ===');
  return stats;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error(e); process.exit(1); });
}
