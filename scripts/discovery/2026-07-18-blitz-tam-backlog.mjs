#!/usr/bin/env node
// F-2, docs/PLAN_2026-07-18_backend_hardening.md — CORRECTED SCOPE (see note below).
//
// The handoff/plan described this as checking "overlap with a different niche's TAM
// harvest." That framing was wrong — re-reading CHANGELOG.md [0.8.0] (2026-07-15)
// shows 0_blitz/002_tam_50-200 and 0_blitz/003_tam_industry_nf are PHILIPPE'S OWN
// Blitz TAM harvest folders (clients/philippe-bosquillon/0_blitz/), not another
// client/niche's. 003 is already industry-keyword-filtered for food/beverage
// (verified live: "Fritz-Kola Gmbh", industry "Food and Beverage Services" — a
// direct hit); 002 is a broader, noisier 50-200-employee pool (verified live:
// contains "Immobilien Zeitung", a real-estate trade magazine — matches CHANGELOG's
// own "heavy noise" note). So there is no domain-overlap question to answer — this
// is Philippe's own backlog of already-fetched, not-yet-ICP-scored companies, and
// CHANGELOG's own 07-15 conclusion already named the correct next step: LLM-score
// them with classifyCompany() (zero new Blitz/Exa spend, LLM-only cost).
//
// This script re-verifies the backlog is still accurate today (files/counts can
// drift) and measures how much of it has ALREADY been picked up into
// sourcing.companies via some other path since 07-15 (independent job-board/Exa
// resolution can incidentally add the same company). Read-only — local file reads
// + one sourcing.companies query, zero spend, safe without "запускай".
//
// Run: node --env-file=nextjs/.env.local scripts/discovery/2026-07-18-blitz-tam-backlog.mjs

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getSourcingClientId, selectAllSourcing } from '../../pipeline/lib/sourcing.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';
const BLITZ_DIR = join(__dir, '../../../0_blitz'); // clients/philippe-bosquillon/0_blitz/

function normDomain(d) { if (!d) return ''; return String(d).toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/.*$/,'').trim(); }

function parseCsvDomains(path) {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(',');
  const domainIdx = headers.indexOf('domain');
  if (domainIdx === -1) return [];
  // naive split is good enough here — we only read the domain column for a count/overlap check
  return lines.slice(1).map(l => normDomain(l.split(',')[domainIdx])).filter(Boolean);
}

function parseJsonlDomains(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => {
    try { return normDomain(JSON.parse(line).domain); } catch { return null; }
  }).filter(Boolean);
}

async function main() {
  console.log('NOTE: scope corrected — this is PHILIPPE\'S OWN 0_blitz/002+003 backlog, not another niche\'s. See header comment.\n');

  const path002 = join(BLITZ_DIR, '002_tam_50-200/tam_blitz.csv');
  const path003Raw = join(BLITZ_DIR, '003_tam_industry_nf/new_companies.jsonl');
  const path003Scored = join(BLITZ_DIR, '003_tam_industry_nf/new_companies_scored.jsonl');

  const domains002 = parseCsvDomains(path002);
  const domains003Raw = parseJsonlDomains(path003Raw);
  const domains003Scored = parseJsonlDomains(path003Scored);

  console.log(`002_tam_50-200 (broad, noisy):     ${domains002.length} raw rows, local scoring status not tracked per-row here (see CHANGELOG: only 101 were ever scored)`);
  console.log(`003_tam_industry_nf (food-filtered): ${domains003Raw.length} raw rows, ${domains003Scored.length} already scored locally (new_companies_scored.jsonl)`);

  const sourcingClientId = await getSourcingClientId(CLIENT_SLUG);
  const sourcing = await selectAllSourcing('companies', `client_id=eq.${sourcingClientId}&select=domain,icp_status`);
  const sourcingDomains = new Set(sourcing.map(c => normDomain(c.domain)).filter(Boolean));
  console.log(`\nsourcing.companies (live, current): ${sourcing.length} total`);

  const alreadyIn002 = domains002.filter(d => sourcingDomains.has(d)).length;
  const alreadyIn003Raw = domains003Raw.filter(d => sourcingDomains.has(d)).length;

  console.log('\n=== BACKLOG STATUS (measured live 2026-07-18) ===');
  console.log(`002: ${alreadyIn002}/${domains002.length} domains already present in sourcing.companies (via any path) — ${domains002.length - alreadyIn002} still genuinely unscored/unfetched-into-sourcing`);
  console.log(`003: ${alreadyIn003Raw}/${domains003Raw.length} domains already present in sourcing.companies — ${domains003Raw.length - alreadyIn003Raw} still not in sourcing (includes the ${domains003Raw.length - domains003Scored.length} never locally LLM-scored at all)`);
  console.log('\nRecommendation (unchanged from CHANGELOG 07-15): score the remaining 003 backlog first (already industry-filtered, cheap LLM-only cost via classifyCompany()) before touching 002 (broad/noisy, lower expected pass-rate per company scored).');
}

main().catch(e => { console.error(e); process.exit(1); });
