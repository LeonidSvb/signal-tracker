#!/usr/bin/env node
// F-1, docs/PLAN_2026-07-18_backend_hardening.md — real current Layer-0 hit-rate:
// of Philippe's TODAY signal companies, what fraction resolve for free via
// sourcing.companies (the outer Mastr_Leads Blitz TAM base) vs need fresh
// Blitz/Exa spend? Read-only (DB reads only, no spend) — safe to run without
// "запускай" per the standing rule (only paid/mutating runs need it).
//
// Run: node --env-file=nextjs/.env.local scripts/discovery/2026-07-18-layer0-hitrate.mjs

import { selectAll } from '../../pipeline/lib/supabase.mjs';
import { getClientId } from '../../pipeline/lib/log.mjs';
import { getSourcingClientId, selectAllSourcing } from '../../pipeline/lib/sourcing.mjs';

const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';

// Same normalization as resolve_companies.mjs / classify_company.mjs — kept identical
// so this measurement matches what the live pipeline would actually match.
const ACCENT_MAP = { é:'e',è:'e',ê:'e',ë:'e',à:'a',â:'a',ü:'u',ö:'o',ä:'a',ß:'ss',ç:'c',û:'u',î:'i',ï:'i',ô:'o',œ:'oe',æ:'ae',ø:'o',å:'a' };
function norm(s) { return String(s||'').toLowerCase().replace(/[éèêëàâüöäßçûîïôœæøå]/g,c=>ACCENT_MAP[c]||c).replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); }
const STRIP = /\b(gmbh|ag|sa|nv|bv|srl|ltd|inc|corp|llc|sas|snc|ohg|kg|og|se|plc|co|cie|group|gruppe|holding|services|international|deutschland|france)\b/g;
function coreName(s) { return norm(s).replace(STRIP,' ').replace(/\s+/g,' ').trim().split(' ').slice(0,3).join(' '); }
function normDomain(d) { if (!d) return ''; return String(d).toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/.*$/,'').trim(); }

async function main() {
  const clientId = await getClientId(CLIENT_SLUG);
  const sourcingClientId = await getSourcingClientId(CLIENT_SLUG);

  const [companies, sourcing] = await Promise.all([
    selectAll('companies', { client_id: clientId }, { select: 'id,name,domain,tier' }),
    selectAllSourcing('companies', `client_id=eq.${sourcingClientId}&select=id,company_name,domain,icp_status`),
  ]);

  console.log(`signal_monitoring.companies (Philippe, all current): ${companies.length}`);
  console.log(`sourcing.companies (outer Blitz TAM base): ${sourcing.length}`);

  const sourcingByDomain = new Map();
  const sourcingByCoreName = new Map();
  for (const c of sourcing) {
    const d = normDomain(c.domain);
    if (d) sourcingByDomain.set(d, c);
    const cn = coreName(c.company_name);
    if (cn && !sourcingByCoreName.has(cn)) sourcingByCoreName.set(cn, c);
  }

  let hitByDomain = 0, hitByName = 0, miss = 0;
  const icpStatusCounts = {};
  for (const c of companies) {
    const d = normDomain(c.domain);
    const cn = coreName(c.name);
    const hit = (d && sourcingByDomain.get(d)) || sourcingByCoreName.get(cn);
    if (hit) {
      if (d && sourcingByDomain.get(d)) hitByDomain++; else hitByName++;
      const status = hit.icp_status || 'null';
      icpStatusCounts[status] = (icpStatusCounts[status] || 0) + 1;
    } else {
      miss++;
    }
  }

  const total = companies.length;
  const hits = hitByDomain + hitByName;
  console.log('\n=== LAYER-0 HIT RATE (measured live, 2026-07-18) ===');
  console.log(`total companies:        ${total}`);
  console.log(`Layer-0 hit (free):     ${hits} (${((hits / total) * 100).toFixed(1)}%)  [by domain: ${hitByDomain}, by name: ${hitByName}]`);
  console.log(`Layer-0 miss (would spend Blitz/Exa): ${miss} (${((miss / total) * 100).toFixed(1)}%)`);
  console.log('\nicp_status breakdown among Layer-0 hits:');
  console.log(JSON.stringify(icpStatusCounts, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
