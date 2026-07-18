// Backfill real employee/industry data from Blitz into sourcing.companies for every company this
// session resolved via Exa+LLM (Layer 1) — replacing the LLM's textual guess (audited 2026-07-14:
// only ~32% of employee-count claims were actually grounded in the fetched about-text; the rest
// were the model's own pretrained knowledge or a soft guess) with Blitz's real LinkedIn-sourced
// employee_range/employees_on_linkedin, and re-deriving icp_status from that real number where
// Blitz has it. Chain: domain -> LinkedIn URL (enrichment/domain-to-linkedin) -> full company
// profile (enrichment/company) — both endpoints free on an Unlimited Blitz plan, 1 credit each
// on Trial (see docs/blitz-api/blitz-api-endpoints.md).
//
// Safety: defaults to DRY RUN. Pass --live to actually call Blitz and write updates.
// Run: node --env-file=nextjs/.env.local pipeline/stages/verify_via_blitz.mjs [--live] [--limit=N]

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { selectAllSourcing } from '../lib/sourcing.mjs';
import { fetchRetry } from '../lib/httpRetry.mjs';

const __dir = fileURLToPath(new URL('.', import.meta.url));
const CLIENT_ID_SOURCING = '9420de17-8a6f-4995-acb6-f80b678b157f'; // philippe-bosquillon, same UUID both schemas

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const limitArg = args.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) {
      const k = line.slice(0, i).trim();
      if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
    }
  }
}
loadEnvFile(join(__dir, '../../../../../blitz/.env'));
const BLITZ_KEY = process.env.BLITZ_API_KEY;

const ICP_CFG = JSON.parse(readFileSync(join(__dir, '../config/icp_filter.json'), 'utf8'));

async function blitzPost(path, body) {
  const res = await fetchRetry(`https://api.blitz-api.ai${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': BLITZ_KEY },
    body: JSON.stringify(body),
  });
  return res.json();
}

function parseSizeMidpoint(sizeStr) {
  if (!sizeStr) return null;
  const m = String(sizeStr).match(/(\d[\d,]*)\s*-\s*(\d[\d,]*)/);
  if (!m) return null;
  const lo = parseInt(m[1].replace(/,/g, ''), 10);
  const hi = parseInt(m[2].replace(/,/g, ''), 10);
  return Math.round((lo + hi) / 2);
}

function deriveIcpStatus(employees) {
  if (employees == null) return null; // no real number -> don't override existing status
  if (employees < ICP_CFG.min_employees || employees > ICP_CFG.max_employees) return 'reject';
  return 'pass';
}

const URL_BASE = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'Content-Profile': 'sourcing', 'Accept-Profile': 'sourcing' };

async function updateSourcingCompany(id, patch) {
  const res = await fetchRetry(`${URL_BASE}/rest/v1/companies?id=eq.${id}`, {
    method: 'PATCH', headers: { ...HEADERS, Prefer: 'return=minimal' }, body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`update ${id} -> ${res.status}: ${await res.text()}`);
}

export async function run() {
  console.log(`\n=== verify_via_blitz.mjs === mode=${LIVE ? 'LIVE' : 'DRY RUN'}`);
  if (LIVE && !BLITZ_KEY) throw new Error('BLITZ_API_KEY not set');

  const rows = await selectAllSourcing('companies', `client_id=eq.${CLIENT_ID_SOURCING}&first_seen_via=eq.signal_monitoring_exa&domain=not.is.null&select=id,company_name,domain,employees,industry,icp_status,icp_reason,company_linkedin_url`);
  console.log(`companies to verify: ${rows.length}`);

  const stats = { total: 0, blitzFound: 0, blitzNotFound: 0, employeesBackfilled: 0, disagreements: 0, errors: [] };
  const disagreementList = [];

  for (const r of rows.slice(0, LIMIT)) {
    stats.total++;
    process.stdout.write(`\r  ${stats.total}/${Math.min(rows.length, LIMIT)}`);
    try {
      if (!LIVE) continue;

      const d2l = await blitzPost('/v2/enrichment/domain-to-linkedin', { domain: `https://${r.domain}` });
      if (!d2l?.found || !d2l.company_linkedin_url) { stats.blitzNotFound++; continue; }

      const enrich = await blitzPost('/v2/enrichment/company', { company_linkedin_url: d2l.company_linkedin_url });
      if (!enrich?.found) { stats.blitzNotFound++; continue; }

      stats.blitzFound++;
      const c = enrich.company;
      const realEmployees = (c.employees_on_linkedin > 0) ? c.employees_on_linkedin : parseSizeMidpoint(c.size);
      const blitzSuggests = deriveIcpStatus(realEmployees);

      // NOTE 2026-07-14: this used to auto-flip icp_status based purely on realEmployees. Found
      // live on the first 10-company test: it silently overturned a CORRECT entity_mismatch
      // reject ("Emma" the Nantes bakery -> domain actually belongs to Emma Sleep, 1267 employees)
      // into a wrong pass, because it trusted Blitz's employee count without checking whether the
      // Blitz LinkedIn match is even the same entity the original icp_reason is about. Also,
      // employees_on_linkedin can legitimately be tiny for a large real company if Blitz matched a
      // regional subsidiary's LinkedIn page rather than the group's main page (suspected on Acomo:
      // a large public NL ingredients group, Blitz found only 20). Auto-correcting status from a
      // single number both of these ways is unsafe. Instead: always update the FACTUAL fields
      // (real, useful data), but only ANNOTATE disagreements between Blitz's number and the
      // existing status for a human to review — never silently overwrite icp_status here.
      const patch = { company_linkedin_url: d2l.company_linkedin_url };
      if (realEmployees != null) { patch.employees = realEmployees; patch.employee_bucket = c.size || null; stats.employeesBackfilled++; }
      if (c.industry) patch.industry = c.industry;
      if (blitzSuggests && blitzSuggests !== r.icp_status) {
        patch.icp_reason = `${r.icp_reason || ''} [Blitz data available: employees=${realEmployees} (LinkedIn "${c.size}"), which would suggest '${blitzSuggests}' vs current '${r.icp_status}' — NOT auto-applied, needs human review]`.trim();
        stats.disagreements++;
        disagreementList.push({ name: r.company_name, domain: r.domain, current: r.icp_status, blitzSuggests, realEmployees, linkedinUrl: d2l.company_linkedin_url });
      }

      await updateSourcingCompany(r.id, patch);
    } catch (e) {
      stats.errors.push(`${r.company_name}: ${e.message}`);
    }
  }
  console.log('');

  console.log('\n=== STATS ===');
  console.log(JSON.stringify(stats, null, 2));
  if (disagreementList.length) {
    console.log('\n=== DISAGREEMENTS (Blitz real data vs current icp_status — needs human review, NOT auto-applied) ===');
    for (const f of disagreementList) console.log(`  ${f.name} (${f.domain}): current='${f.current}' blitz_suggests='${f.blitzSuggests}' (employees=${f.realEmployees}) linkedin=${f.linkedinUrl}`);
  }
  return stats;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error(e); process.exit(1); });
}
