#!/usr/bin/env node
// Match passed_icp raw_signals → companies table.
// LinkedIn URL match → exact name → fuzzy name → create stub.
// Run: node --env-file=nextjs/.env.local pipeline/stages/03_resolve_companies.mjs

import { dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { selectAll, upsert, insert } from '../lib/supabase.mjs';
import { getClientId, startRun, finishRun } from '../lib/log.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';

// ── Name normalization ────────────────────────────────────────────────────────

const ACCENT_MAP = { é:'e',è:'e',ê:'e',ë:'e',à:'a',â:'a',ü:'u',ö:'o',ä:'a',ß:'ss',ç:'c',û:'u',î:'i',ï:'i',ô:'o',œ:'oe',æ:'ae',ø:'o',å:'a' };

function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/[éèêëàâüöäßçûîïôœæøå]/g, c => ACCENT_MAP[c] || c)
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STRIP = /\b(gmbh|ag|sa|nv|bv|srl|ltd|inc|corp|llc|sas|snc|ohg|kg|og|se|plc|co|cie|group|gruppe|holding|services|international|deutschland|france)\b/g;

function coreName(s) {
  return norm(s).replace(STRIP, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
}

function fuzzyMatch(a, b) {
  const ca = coreName(a), cb = coreName(b);
  return !!(ca && cb && (ca === cb || ca.includes(cb) || cb.includes(ca)));
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function run() {
  console.log('\n=== 03_resolve_companies.mjs ===');
  const clientId = await getClientId(CLIENT_SLUG);
  const runId = await startRun({ clientId, script: '03_resolve_companies', source: 'raw_signals' });

  const signals = await selectAll('raw_signals', { client_id: clientId, status: 'passed_icp' });
  console.log(`passed_icp signals: ${signals.length}`);

  // Collect unique companies from signals — prefer linkedin_url from LinkedIn source
  const byName = new Map();
  for (const s of signals) {
    const name = s.company_name;
    if (!name) continue;
    const cur = byName.get(name) || { name, linkedin_url: null, country: null, employees: null };
    if (!cur.linkedin_url && s.raw_data?.companyLinkedinUrl)
      cur.linkedin_url = s.raw_data.companyLinkedinUrl;
    if (!cur.country && s.country) cur.country = s.country;
    if (!cur.employees && s.raw_data?.companyEmployeesCount)
      cur.employees = s.raw_data.companyEmployeesCount;
    byName.set(name, cur);
  }
  console.log(`unique company names: ${byName.size}`);

  const existing = await selectAll('companies', { client_id: clientId });
  console.log(`existing companies in DB: ${existing.length}`);

  const byLinkedIn  = new Map(existing.filter(c => c.linkedin_url).map(c => [c.linkedin_url, c]));
  const byNormName  = new Map(existing.map(c => [norm(c.name), c]));

  const toCreate = [];
  let matched = 0;

  for (const [name, info] of byName) {
    if (info.linkedin_url && byLinkedIn.has(info.linkedin_url)) { matched++; continue; }
    if (byNormName.has(norm(name)))                              { matched++; continue; }
    if (existing.some(c => fuzzyMatch(name, c.name)))           { matched++; continue; }
    toCreate.push(info);
  }

  console.log(`matched: ${matched}  to create: ${toCreate.length}`);

  let pushed = 0;
  if (toCreate.length) {
    const existingNorms = new Set(existing.map(c => norm(c.name)));
    const fresh = toCreate.filter(r => !existingNorms.has(norm(r.name)));

    const withUrl = fresh.filter(r => r.linkedin_url).map(r => ({
      client_id:   clientId, name: r.name, linkedin_url: r.linkedin_url,
      hq_country:  r.country || null,
      employees:   r.employees ? parseInt(r.employees) : null,
    }));
    const stubs = fresh.filter(r => !r.linkedin_url).map(r => ({
      client_id:  clientId, name: r.name,
      hq_country: r.country || null,
      employees:  r.employees ? parseInt(r.employees) : null,
    }));

    if (withUrl.length) {
      const ins = await upsert('companies', withUrl, 'client_id,linkedin_url');
      pushed += ins.length;
      console.log(`upserted ${ins.length} companies with linkedin_url`);
    }
    if (stubs.length) {
      const ins = await insert('companies', stubs);
      pushed += ins.length;
      console.log(`created ${ins.length} stub companies (no linkedin_url)`);
    }
  }

  await finishRun(runId, { status: 'success', stats: { scraped: signals.length, pushed } });
  console.log('=== DONE ===');
  return { matched, created: toCreate.length, pushed };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error(e); process.exit(1); });
}
