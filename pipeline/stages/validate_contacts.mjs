#!/usr/bin/env node
// validate_contacts.mjs (B-D1, docs/PLAN_2026-07-18_backend_hardening.md) — dedicated
// weekly stage that keeps email validation fleet-wide and tracked, independent of
// whether anything is being sent. Reuses lib/validateEmail.mjs's proven MV+BounceBan
// cascade verbatim (do not touch the python — see validateEmail.mjs's own header).
//
// Selection: email IS NOT NULL AND email_status <> 'invalid' AND
// (email_validated_at IS NULL OR email_validated_at < now() - 90d). 'invalid' is
// terminal — a dead mailbox that resurrects is not worth re-spending credits on.
// Everything else gets re-checked every 90 days.
//
// Writes back per contact: email_status ('verified'|'invalid'|'pending' for
// unknown/risky), email_validated_at = now(), email_validation_detail = { verdict,
// cascade, run_id } — needs migration 006 (db/migrations/006_email_validation.sql).
//
// Safety: DRY RUN by default (prints the selection, zero spend). --live requires
// Leo's "запускай" — real Apify (MV) + BounceBan credit spend.
//
// Run: node --env-file=nextjs/.env.local pipeline/stages/validate_contacts.mjs [--live] [--limit=N]

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { selectAll, patch } from '../lib/supabase.mjs';
import { getClientId, startRun, finishRun } from '../lib/log.mjs';
import { validateBatch } from '../lib/validateEmail.mjs';
import { needsValidation, STALE_DAYS } from '../lib/emailValidationPolicy.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const limitArg = args.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

const RUN_DIR = join(__dir, `../runs/validate_contacts_${new Date().toISOString().slice(0, 10)}`);

function writeCheckpoint(state) {
  writeFileSync(join(RUN_DIR, 'checkpoint.json'), JSON.stringify({ ...state, at: new Date().toISOString() }, null, 2));
}

export async function run() {
  console.log(`\n=== validate_contacts.mjs === mode=${LIVE ? 'LIVE (spends money)' : 'DRY RUN (no spend)'}`);

  mkdirSync(RUN_DIR, { recursive: true });
  writeFileSync(join(RUN_DIR, 'config.json'), JSON.stringify({
    mode: LIVE ? 'live' : 'dry_run', limit: LIMIT, stale_days: STALE_DAYS, date: new Date().toISOString(),
  }, null, 2));

  const clientId = await getClientId(CLIENT_SLUG);
  const runId = LIVE ? await startRun({ clientId, script: 'validate_contacts', source: 'mv_bounceban' }) : null;

  const contacts = await selectAll('contacts', { client_id: clientId },
    { select: 'id,email,email_status,email_validated_at' });
  const withEmail = contacts.filter(c => c.email);
  const candidates = withEmail.filter(needsValidation).slice(0, LIMIT);

  console.log(`contacts with email: ${withEmail.length} | needing validation (never / >${STALE_DAYS}d stale, invalid excluded): ${candidates.length}`);
  writeCheckpoint({ phase: 'selected', candidates: candidates.length });

  if (!candidates.length) {
    console.log('Nothing to validate — all current emails are fresh or terminally invalid.');
    if (LIVE) await finishRun(runId, { status: 'success', stats: { scraped: withEmail.length, pushed: 0 } });
    return { candidates: 0, validated: 0 };
  }

  if (!LIVE) {
    console.log(`\nWould validate ${candidates.length} emails via MV+BounceBan. Rerun with --live after Leo says "запускай".`);
    writeFileSync(join(RUN_DIR, 'manifest.json'), JSON.stringify({ mode: 'dry_run', candidates: candidates.length }, null, 2));
    return { candidates: candidates.length, validated: 0 };
  }

  const emails = candidates.map(c => c.email.toLowerCase().trim());
  console.log(`\n[validation] running MV+BounceBan cascade on ${emails.length} emails...`);
  const { verdicts, summary } = await validateBatch(emails, join(RUN_DIR, 'validation'));
  writeCheckpoint({ phase: 'validated', candidates: candidates.length });

  const nowIso = new Date().toISOString();
  const results = { sendable: 0, dead: 0, unknown: 0, errors: [] };

  for (const contact of candidates) {
    const email = contact.email.toLowerCase().trim();
    const verdict = verdicts.get(email) || 'unknown';
    const emailStatus = verdict === 'sendable' ? 'verified' : verdict === 'dead' ? 'invalid' : 'pending';
    results[verdict === 'sendable' ? 'sendable' : verdict === 'dead' ? 'dead' : 'unknown']++;

    try {
      await patch('contacts', 'id', [contact.id], {
        email_status: emailStatus,
        email_validated_at: nowIso,
        email_validation_detail: { verdict, cascade: 'mv+bounceban', run_id: runId },
      });
    } catch (e) {
      results.errors.push(`${contact.id}: ${e.message}`);
    }
  }

  console.log('\n=== RESULTS ===');
  console.log(JSON.stringify(results, null, 2));
  writeFileSync(join(RUN_DIR, 'manifest.json'), JSON.stringify({ mode: 'live', candidates: candidates.length, results, summary }, null, 2));

  await finishRun(runId, { status: results.errors.length ? 'partial' : 'success', stats: { scraped: candidates.length, pushed: results.sendable }, errors: results.errors });
  console.log('=== DONE ===');
  return { candidates: candidates.length, validated: candidates.length - results.errors.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error(e); process.exit(1); });
}
