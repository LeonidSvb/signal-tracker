#!/usr/bin/env node
// Find contacts for companies that have linkedin_url but no contacts yet.
// Uses BlitzAPI waterfall-icp-keyword with food industry cascade.
// Run: node --env-file=nextjs/.env.local pipeline/stages/find_contacts.mjs

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { selectAll, insert } from '../lib/supabase.mjs';
import { getClientId, startRun, finishRun } from '../lib/log.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';
const EMP_THRESHOLD = 500;
const MAX_PER_LEVEL = 3;
// Overall cap regardless of how many cascade levels find someone — data 2026-07-15: capping at
// 3 loses only 6pp of email-hit-rate vs no cap (57% vs 63%) while cutting volume dramatically
// (some companies were getting 9-15 contacts, e.g. every level of a multinational's cascade
// hitting separately). is_primary stays on the first (highest cascade-priority) hit only — that
// one is the LinkedIn-outreach contact; the rest exist purely to raise odds of finding an email.
const MAX_CONTACTS_PER_COMPANY = 3;
const CONCURRENCY   = 5;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Load BLITZ_API_KEY from blitz/.env ────────────────────────────────────────
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

// ── BlitzAPI ──────────────────────────────────────────────────────────────────
async function blitzPost(path, body) {
  const res = await fetch(`https://api.blitz-api.ai${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': BLITZ_KEY },
    body:    JSON.stringify(body),
  });
  return res.json();
}

// Cascade for food companies — matches 3_contacts/config.json
const CASCADE_SMALL = [
  { label: 'CEO',       include_title: ['CEO','PDG'],                                                                                                                 exclude_title: ['Junior','Assistant','Intern','Trainee'] },
  { label: 'MD/GF',    include_title: ['Managing Director','Geschäftsführer','Directeur Général','Algemeen Directeur','Gérant'],                                       exclude_title: ['Junior','Assistant','Intern','Trainee'] },
  { label: 'Founder',  include_title: ['Founder','Co-Founder','Inhaber','Zaakvoerder','Gedelegeerd Bestuurder','Managing Partner'],                                    exclude_title: ['Junior','Assistant','Intern','Trainee','Content','Brand','Marketing'] },
  { label: 'President',include_title: ['President','General Manager','Président'],                                                                                     exclude_title: ['Junior','Assistant','Intern','Vice','VP'] },
];
const CASCADE_LARGE = [
  { label: 'CHRO',     include_title: ['CHRO','Chief Human Resources Officer','Chief People Officer'],                                                                 exclude_title: ['Junior','Assistant','Intern','Recruiter','Trainee'] },
  { label: 'HR Dir',   include_title: ['HR Director','Human Resources Director','DRH','Directeur des Ressources Humaines','Personalleiter','Leiter Personal'],         exclude_title: ['Junior','Assistant','Intern','Recruiter','Trainee'] },
  { label: 'VP HR',    include_title: ['VP Human Resources','VP People','Head of HR','Head of People','Director of HR'],                                               exclude_title: ['Junior','Assistant','Intern','Recruiter','Trainee'] },
];

async function findLevel(linkedinUrl, level) {
  try {
    const data = await blitzPost('/v2/search/waterfall-icp-keyword', {
      company_linkedin_url: linkedinUrl,
      cascade: [{ include_title: level.include_title, exclude_title: level.exclude_title, location: ['WORLD'] }],
      max_results: MAX_PER_LEVEL,
    });
    await sleep(50);
    return (data.results || []).filter(r => r.person?.linkedin_url);
  } catch { return []; }
}

async function getEmail(personUrl) {
  try {
    const data = await blitzPost('/v2/enrichment/email', { person_linkedin_url: personUrl });
    return (data.found ? data.email : null);
  } catch { return null; }
}

function normalizeLinkedinUrl(url) {
  return url.replace(/^http:\/\//, 'https://');
}

async function processCompany(company, clientId) {
  const cascade = (company.employees || 0) >= EMP_THRESHOLD ? CASCADE_LARGE : CASCADE_SMALL;
  const seen = new Set();
  const rows  = [];
  const linkedinUrl = normalizeLinkedinUrl(company.linkedin_url);

  for (const level of cascade) {
    if (rows.length >= MAX_CONTACTS_PER_COMPANY) break;
    const results = await findLevel(linkedinUrl, level);
    for (const { person } of results) {
      if (rows.length >= MAX_CONTACTS_PER_COMPANY) break;
      if (seen.has(person.linkedin_url)) continue;
      seen.add(person.linkedin_url);
      const email = await getEmail(person.linkedin_url);
      const curExp = person.experiences?.find(e => e.is_current) || {};
      // curExp.job_title is Blitz's structured current-position field — prefer it over the raw
      // headline, which is a self-written bio and often noisy ("CEO Office @Circus Group |
      // ex-TIER, ex-1KOMMA5° | Project Lead & AI-Enthusiast") — a cascade title-keyword match can
      // land on a substring inside that bio rather than the person's actual current role. Found
      // 2026-07-15 auditing find_contacts.mjs output: 51 of ~250 contacts had title="unknown"
      // (both fields empty) and several stored a full noisy headline as the title.
      const title = (curExp.job_title || person.headline || '').split(/ at | @ |\s*\|\s*|\s*•\s*/)[0].trim();
      rows.push({
        client_id:    clientId,
        company_id:   company.id,
        first_name:   person.first_name  || null,
        last_name:    person.last_name   || null,
        full_name:    person.full_name   || null,
        title:        title              || null,
        linkedin_url: person.linkedin_url,
        email:        email              || null,
        email_status: email ? 'inferred' : 'pending',
        is_primary:   rows.length === 0,
        source:       'blitz',
      });
    }
  }
  return rows;
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function run() {
  console.log('\n=== find_contacts.mjs ===');

  if (!BLITZ_KEY) {
    console.log('BLITZ_API_KEY not set — skipping find_contacts');
    return { skipped: true };
  }

  const clientId = await getClientId(CLIENT_SLUG);
  const runId    = await startRun({ clientId, script: 'find_contacts', source: 'blitz' });

  const allCompanies = await selectAll('companies', { client_id: clientId });
  const withUrl      = allCompanies.filter(c => c.linkedin_url);
  console.log(`companies with linkedin_url: ${withUrl.length}`);

  const existingContacts  = await selectAll('contacts', { client_id: clientId });
  const companiesWithCtct = new Set(existingContacts.map(c => c.company_id));

  const needContacts = withUrl.filter(c => !companiesWithCtct.has(c.id));
  console.log(`companies needing contacts: ${needContacts.length}`);

  let pushed = 0;
  const errors = [];

  for (let i = 0; i < needContacts.length; i += CONCURRENCY) {
    const batch = needContacts.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(c =>
      processCompany(c, clientId).catch(e => { errors.push(`${c.name}: ${e.message}`); return []; })
    ));
    const rows = results.flat();
    if (rows.length) {
      const ins = await insert('contacts', rows);
      pushed += ins.length;
    }
    process.stdout.write(`\r  ${Math.min(i + CONCURRENCY, needContacts.length)}/${needContacts.length} companies done`);
  }
  if (needContacts.length) console.log('');

  await finishRun(runId, {
    status: errors.length ? 'partial' : 'success',
    stats:  { scraped: needContacts.length, pushed },
    errors,
  });
  console.log(`contacts pushed: ${pushed}`);
  if (errors.length) console.log(`errors: ${errors.join(', ')}`);
  console.log('=== DONE ===');
  return { companiesProcessed: needContacts.length, contactsPushed: pushed };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error(e); process.exit(1); });
}
