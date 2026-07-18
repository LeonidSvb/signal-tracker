import { insert, select } from './supabase.mjs';

const URL_BASE = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function getClientId(slug) {
  const rows = await select('clients', { slug });
  if (!rows.length) throw new Error(`Client not found: ${slug}`);
  return rows[0].id;
}

export async function startRun({ clientId, script, source }) {
  const [row] = await insert('pipeline_runs', [{
    client_id:  clientId,
    script,
    source,
    status:     'running',
    started_at: new Date().toISOString(),
    rows_scraped:    0,
    rows_passed_icp: 0,
    rows_pushed:     0,
    errors: [],
  }]);
  console.log(`[run] started ${script} (${source}) run_id=${row?.id}`);
  return row?.id;
}

export async function finishRun(runId, { status = 'success', stats = {}, errors = [] } = {}) {
  if (!runId) return;
  await fetch(`${URL_BASE}/rest/v1/pipeline_runs?id=eq.${runId}`, {
    method:  'PATCH',
    headers: {
      apikey:           KEY,
      Authorization:    `Bearer ${KEY}`,
      'Content-Type':   'application/json',
      'Content-Profile': 'signal_monitoring',
      Prefer:           'return=minimal',
    },
    body: JSON.stringify({
      status,
      finished_at:     new Date().toISOString(),
      rows_scraped:    stats.scraped    ?? 0,
      rows_passed_icp: stats.passed     ?? 0,
      rows_pushed:     stats.pushed     ?? 0,
      stats,
      errors,
    }),
  });
  console.log(`[run] finished ${runId} status=${status} scraped=${stats.scraped ?? 0} pushed=${stats.pushed ?? 0}`);
}
