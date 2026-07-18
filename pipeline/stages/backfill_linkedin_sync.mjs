#!/usr/bin/env node
// Q10 backfill (signals/TODO.txt): sourcing.companies (11.9k, 97% linkedin_url coverage) and
// signal_monitoring.companies (what find_contacts.mjs and the frontend actually read) are two
// separate tables for the same real companies. classify_company.mjs's Blitz-first path only
// writes linkedin_url/employees/about into BOTH tables for NEWLY CREATED rows — existing
// signal_monitoring.companies rows created before Blitz was wired in never got backfilled.
// Measured 2026-07-15: only 5 of 230 exa-signal companies in signal_monitoring have
// linkedin_url, vs 97% coverage for the same companies in sourcing. One-time backfill,
// idempotent (safe to rerun), joins by normalized domain.
//
// Safety: defaults to DRY RUN (counts only). Pass --live to write.
// Run: node --env-file=nextjs/.env.local pipeline/stages/backfill_linkedin_sync.mjs [--live]

import { fileURLToPath, pathToFileURL } from 'url';
import { selectAll, patch } from '../lib/supabase.mjs';
import { getClientId } from '../lib/log.mjs';
import { getSourcingClientId, selectAllSourcing } from '../lib/sourcing.mjs';

const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';
const LIVE = process.argv.slice(2).includes('--live');

function normDomain(d) {
  if (!d) return '';
  return String(d).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim();
}

export async function run() {
  console.log(`\n=== backfill_linkedin_sync.mjs === mode=${LIVE ? 'LIVE' : 'DRY RUN'}`);

  const clientId = await getClientId(CLIENT_SLUG);
  const sourcingClientId = await getSourcingClientId(CLIENT_SLUG);

  const smCompanies = await selectAll('companies', { client_id: clientId });
  const sourcingCompanies = await selectAllSourcing('companies',
    `client_id=eq.${sourcingClientId}&select=domain,company_linkedin_url,employees,industry,about,hq_country`);

  const sourcingByDomain = new Map();
  for (const c of sourcingCompanies) {
    const d = normDomain(c.domain);
    if (d && !sourcingByDomain.has(d)) sourcingByDomain.set(d, c);
  }
  console.log(`signal_monitoring.companies: ${smCompanies.length} | sourcing.companies: ${sourcingCompanies.length} (${sourcingByDomain.size} distinct domains)`);

  const stats = { total: smCompanies.length, noDomain: 0, noSourcingMatch: 0, alreadyComplete: 0, backfilled: 0, patchErrors: 0 };
  const beforeLinkedin = smCompanies.filter(c => c.linkedin_url).length;

  for (const c of smCompanies) {
    const d = normDomain(c.domain);
    if (!d) { stats.noDomain++; continue; }
    const src = sourcingByDomain.get(d);
    if (!src) { stats.noSourcingMatch++; continue; }

    const patchBody = {};
    if (!c.linkedin_url && src.company_linkedin_url) patchBody.linkedin_url = src.company_linkedin_url;
    if (!c.employees && src.employees) patchBody.employees = src.employees;
    if (!c.industry && src.industry) patchBody.industry = src.industry;
    if (!c.about && src.about) patchBody.about = src.about;
    if (!c.hq_country && src.hq_country) patchBody.hq_country = src.hq_country;

    if (!Object.keys(patchBody).length) { stats.alreadyComplete++; continue; }

    stats.backfilled++;
    if (LIVE) {
      try {
        await patch('companies', 'id', [c.id], patchBody);
      } catch (e) {
        stats.patchErrors++;
        console.error(`  [error] ${c.name} (${c.id}): ${e.message}`);
      }
    }
  }

  console.log('\n=== STATS ===');
  console.log(JSON.stringify(stats, null, 2));
  console.log(`linkedin_url coverage before: ${beforeLinkedin}/${smCompanies.length}`);
  if (LIVE) {
    const after = await selectAll('companies', { client_id: clientId });
    const afterLinkedin = after.filter(c => c.linkedin_url).length;
    console.log(`linkedin_url coverage after:  ${afterLinkedin}/${after.length}`);
  }
  console.log('=== DONE ===');
  return stats;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error(e); process.exit(1); });
}
