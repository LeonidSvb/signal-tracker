// Thin wrapper over the EXISTING scripts/validation/pipelines/mv-then-bounceban.py
// cascade (D2, docs/HANDOFF_2026-07-15_scoring_two_channel.md — A5). Per A5, do NOT
// port the python to JS — it already owns caching, Apify key rotation, and BounceBan
// job polling/merge logic. This module only writes the input file, spawns the
// python pipeline, and reads its output CSVs back into a per-email verdict map.
//
// Cascade: MV via Apify actor VJ5w50TP6mAbyimyO ($1/1000 decisive, catch_all free)
// -> BounceBan bulk on the catch_all bucket only. Verdict routing (A5):
//   pipeline_ok + pipeline_catchall (BB deliverable) -> SENDABLE
//   dead (MV invalid/disposable, BB undeliverable)    -> DROP (email only)
//   unknown/risky                                     -> DROP (don't gamble evergreen)
//
// Needs python3 + requests on PATH wherever this runs (see deploy checklist, A5).

import { spawn } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '../../../../..');
const PY_SCRIPT = join(REPO_ROOT, 'scripts/validation/pipelines/mv-then-bounceban.py');

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

function runPython(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python', args, { stdio: 'inherit' });
    proc.on('error', reject);
    proc.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`mv-then-bounceban.py exited with code ${code}`));
    });
  });
}

// emails: array of plain email address strings.
// runDir: directory to write input.txt + pipeline outputs (final/pipeline_*.csv,
//   pipeline_summary.json) — should live under a stage's run folder so it's kept
//   with that run's config/manifest/checkpoint triada.
// Returns: { verdicts: Map(email -> 'sendable'|'dead'|'unknown'), summary }
export async function validateBatch(emails, runDir) {
  if (!emails.length) return { verdicts: new Map(), summary: null };

  mkdirSync(runDir, { recursive: true });
  const inputPath = join(runDir, 'input.txt');
  writeFileSync(inputPath, emails.join('\n') + '\n', 'utf8');

  await runPython([PY_SCRIPT, '--input', inputPath, '--output-dir', runDir]);

  const finalDir = join(runDir, 'final');
  const summaryPath = join(finalDir, 'pipeline_summary.json');
  const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : null;

  const verdicts = new Map();
  const mark = (rows, verdict) => {
    for (const row of rows) {
      const email = (row.email || '').toLowerCase().trim();
      if (email) verdicts.set(email, verdict);
    }
  };

  mark(readCsvIfExists(join(finalDir, 'pipeline_ok.csv')), 'sendable');
  mark(readCsvIfExists(join(finalDir, 'pipeline_catchall.csv')), 'sendable');
  mark(readCsvIfExists(join(finalDir, 'pipeline_dead.csv')), 'dead');
  mark(readCsvIfExists(join(finalDir, 'pipeline_risky.csv')), 'unknown');
  mark(readCsvIfExists(join(finalDir, 'pipeline_unknown.csv')), 'unknown');

  // Anything the pipeline never classified (shouldn't happen, but don't silently
  // treat it as sendable) — mark unknown so route_email.mjs drops it.
  for (const e of emails) {
    const key = e.toLowerCase().trim();
    if (!verdicts.has(key)) verdicts.set(key, 'unknown');
  }

  return { verdicts, summary };
}
