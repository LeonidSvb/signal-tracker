// F1 verification loop (docs/HANDOFF_2026-07-15_scoring_two_channel.md, Section F1).
// Free, read-only: N alternating supabase REST calls — small (clients) / paged
// (raw_signals, multi-page at 1000/page) — through pipeline/lib/supabase.mjs, i.e.
// the exact code path every stage uses. Reports p50/p95/max and any multi-second
// outliers. Acceptance: p95 < 2s per handoff (paged calls transfer megabytes of
// raw_data jsonb, so watch the split per call type, not just the aggregate).
//
// Run from signals/: node --env-file=nextjs/.env.local scripts/discovery/2026-07-15-f1-supabase-latency-loop.mjs [--n=100] [--slim]
//   --slim: paged calls use opts.select (id,source,external_id,pub_date — 49 KB/page)
//           instead of full rows (7 MB/page). This is the production read pattern for
//           stages that don't need raw_data; the p95<2s acceptance applies to THIS
//           mode. Full mode exists to show heavy payloads are now BOUNDED (timeout
//           covers body read + one visible retry), not to make 7 MB pages fast.

import { select, selectAll } from '../../pipeline/lib/supabase.mjs';

const nArg = process.argv.find(a => a.startsWith('--n='));
const N = nArg ? parseInt(nArg.split('=')[1], 10) : 100;
const SLIM = process.argv.includes('--slim');
const SLUG = 'philippe-bosquillon';

function pct(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

const rows = await select('clients', { slug: SLUG });
if (!rows.length) throw new Error('client not found');
const clientId = rows[0].id;

const samples = []; // { i, kind, ms, rows }
for (let i = 0; i < N; i++) {
  const kind = i % 2 === 0 ? 'small' : 'paged';
  const t0 = Date.now();
  let count;
  if (kind === 'small') {
    count = (await selectAll('clients')).length;
  } else {
    count = (await selectAll('raw_signals', { client_id: clientId }, SLIM ? { select: 'id,source,external_id,pub_date' } : {})).length;
  }
  const ms = Date.now() - t0;
  samples.push({ i, kind, ms, rows: count });
  process.stdout.write(`\r${i + 1}/${N} ${kind} ${ms}ms (${count} rows)      `);
  if (ms > 10_000) console.log(`\n[OUTLIER] call ${i} (${kind}) took ${ms}ms`);
}
console.log('');

for (const kind of ['small', 'paged', 'all']) {
  const set = samples.filter(s => kind === 'all' || s.kind === kind).map(s => s.ms).sort((a, b) => a - b);
  if (!set.length) continue;
  console.log(`${kind.padEnd(6)} n=${set.length}  p50=${pct(set, 0.5)}ms  p95=${pct(set, 0.95)}ms  max=${set[set.length - 1]}ms  >2s: ${set.filter(m => m > 2000).length}  >60s: ${set.filter(m => m > 60_000).length}`);
}
const worst = [...samples].sort((a, b) => b.ms - a.ms).slice(0, 5);
console.log('slowest 5:', worst.map(w => `#${w.i} ${w.kind} ${w.ms}ms`).join(', '));
