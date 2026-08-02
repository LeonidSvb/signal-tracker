// Thin wrapper over scripts/validation/validate-catchall-bounceban.py — despite the
// "catchall" name it validates any email list, not just catch-all addresses (confirmed
// live 2026-07-31: ran it directly against 54 mixed pending emails, worked fine).
//
// 2026-07-31: switched off the old mv-then-bounceban.py MV-first cascade — the Apify
// account ran out of usage budget for the Million Verifier actor
// ("not-enough-usage-to-run-paid-actor"), silently producing 0 decisive verdicts every
// run. BounceBan alone is cheap enough at this project's real volume (54 emails = 54
// credits, ~2981 remaining) that the MV pre-filter isn't worth the added failure mode —
// Leo's call, 2026-07-31. Per the earlier A5 handoff, still not porting the python to
// JS — it owns caching, job polling/merge logic, this module only shells out and reads
// the output CSVs back into a per-email verdict map.
//
// Verdict routing: bb_deliverable -> SENDABLE, bb_undeliverable -> DEAD,
//   bb_risky/bb_unknown -> UNKNOWN (don't gamble evergreen sends on either).
//
// Needs python3 + requests on PATH wherever this runs (see deploy checklist, A5).

import { spawn } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '../../../../..');
const PY_SCRIPT = join(REPO_ROOT, 'scripts/validation/validate-catchall-bounceban.py');

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.length);
  if (!lines.length) return [];
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    // naive CSV split is fine here — mv-then-bounceban.py's own fields are simple
    // (email, status strings, no embedded commas in the columns we read).
    const cells = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h.trim(), (cells[i] || '').trim()]));
  });
}

function readCsvIfExists(path) {
  if (!existsSync(path)) return [];
  return parseCsv(readFileSync(path, 'utf8'));
}

const PYTHON_BIN = process.platform === 'win32' ? 'python' : 'python3';

function runPython(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, args, { stdio: 'inherit' });
    proc.on('error', reject);
    proc.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`validate-catchall-bounceban.py exited with code ${code}`));
    });
  });
}

// emails: array of plain email address strings.
// runDir: directory to write input.txt + BB outputs (bb_*.csv, manifest_bb.json)
//   — should live under a stage's run folder so it's kept with that run's
//   config/manifest/checkpoint triada.
// Returns: { verdicts: Map(email -> 'sendable'|'dead'|'unknown'), summary }
export async function validateBatch(emails, runDir) {
  if (!emails.length) return { verdicts: new Map(), summary: null };

  mkdirSync(runDir, { recursive: true });
  const inputPath = join(runDir, 'input.txt');
  writeFileSync(inputPath, emails.join('\n') + '\n', 'utf8');

  await runPython([PY_SCRIPT, '--inputs', inputPath, '--output-dir', runDir]);

  const manifestPath = join(runDir, 'manifest_bb.json');
  const summary = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;

  const verdicts = new Map();
  const mark = (rows, verdict) => {
    for (const row of rows) {
      const email = (row.email || '').toLowerCase().trim();
      if (email) verdicts.set(email, verdict);
    }
  };

  mark(readCsvIfExists(join(runDir, 'bb_deliverable.csv')), 'sendable');
  mark(readCsvIfExists(join(runDir, 'bb_undeliverable.csv')), 'dead');
  mark(readCsvIfExists(join(runDir, 'bb_risky.csv')), 'unknown');
  mark(readCsvIfExists(join(runDir, 'bb_unknown.csv')), 'unknown');

  // Anything the pipeline never classified (shouldn't happen, but don't silently
  // treat it as sendable) — mark unknown so route_email.mjs drops it.
  for (const e of emails) {
    const key = e.toLowerCase().trim();
    if (!verdicts.has(key)) verdicts.set(key, 'unknown');
  }

  return { verdicts, summary };
}
