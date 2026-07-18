// Blitz-first company enrichment, by DOMAIN (not name) — the reliable data source. Chain:
// domain -> LinkedIn URL (enrichment/domain-to-linkedin) -> full company profile
// (enrichment/company): real employees_on_linkedin/size/industry, not an LLM guess.
//
// domain-to-linkedin also returns the LinkedIn page's own company_name — comparing that against
// the name we were actually looking for is a near-free sanity check that catches wrong-domain
// resolutions BEFORE trusting Blitz's numbers (found live 2026-07-14: "OSI" resolved to
// osi.af.mil -> Blitz correctly reported real data for that domain, which turned out to be the
// US Air Force, not the food company OSI — Blitz was right about the domain it was given, the
// domain itself was wrong. A string-similarity check on the two names would have caught this for
// free, instead of trusting a plausible-looking employee count for the wrong entity).

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { fetchRetry } from './httpRetry.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));

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

async function blitzPost(path, body) {
  const res = await fetchRetry(`https://api.blitz-api.ai${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': BLITZ_KEY },
    body: JSON.stringify(body),
  });
  return res.json();
}

const ACCENT_MAP = { é:'e',è:'e',ê:'e',ë:'e',à:'a',â:'a',ü:'u',ö:'o',ä:'a',ß:'ss',ç:'c',û:'u',î:'i',ï:'i',ô:'o',œ:'oe',æ:'ae',ø:'o',å:'a' };
function norm(s) { return String(s||'').toLowerCase().replace(/[éèêëàâüöäßçûîïôœæøå]/g,c=>ACCENT_MAP[c]||c).replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); }
const STRIP = /\b(gmbh|ag|sa|nv|bv|srl|ltd|inc|corp|llc|sas|snc|ohg|kg|og|se|plc|co|cie|group|gruppe|holding|bv|b\.v|nv|international|deutschland|france|europe|europa)\b/g;
function coreName(s) { return norm(s).replace(STRIP,' ').replace(/\s+/g,' ').trim().split(' ').slice(0,3).join(' '); }

// Fuzzy match. Widened 2026-07-15 after the first live reclassify run flagged real matches as
// mismatches: "Haacht Brewery" vs "Brouwerij Haacht" (same words, different language/order),
// "Milchwerk Neuburg" vs "Neuburger Milchwerke" (German compound-word order), "Fisherman's
// Friend" vs "Lofthouse Of Fleetwood Ltd" (brand vs legal manufacturer — no shared words at all,
// this class needs a human, not a string check) — the old "starts with the same first word"
// check missed all of the word-order cases. Now: accept if the two normalized name word-sets
// share enough overlap (Jaccard-style), which is order-independent and multi-word-first-token
// safe. Word-order cases pass; genuinely unrelated names (OSI vs "United States Air Force
// Security Forces") still correctly fail — zero shared words.
// Word match tolerant of German/Dutch compound-word morphology (milchwerk/milchwerke,
// neuburg/neuburger) — a shared 5+ char prefix counts as the same word, not just exact equality.
function wordsOverlap(wa, wb) {
  if (wa === wb) return true;
  const minLen = 5;
  if (wa.length >= minLen && wb.length >= minLen) {
    const shortest = wa.length < wb.length ? wa : wb;
    const longest = wa.length < wb.length ? wb : wa;
    return longest.startsWith(shortest.slice(0, minLen));
  }
  return false;
}

export function nameSimilar(a, b) {
  const ca = coreName(a), cb = coreName(b);
  if (!ca || !cb) return false;
  if (ca === cb || ca.includes(cb) || cb.includes(ca)) return true;

  const wordsA = ca.split(' ').filter(w => w.length > 2);
  const wordsB = cb.split(' ').filter(w => w.length > 2);
  if (!wordsA.length || !wordsB.length) return false;
  let shared = 0;
  for (const wa of wordsA) if (wordsB.some(wb => wordsOverlap(wa, wb))) shared++;
  const smaller = Math.min(wordsA.length, wordsB.length);
  return shared / smaller >= 0.5; // at least half of the shorter name's significant words overlap
}

export function cacheKey(domain) { return domain.toLowerCase(); }

// Returns null if Blitz has nothing for this domain; otherwise the raw company profile.
// Deliberately does NOT compute/cache nameMatches here — that comparison is done by the caller
// via matchesTarget() on every use, reading straight from the raw cached fields, so improving
// nameSimilar() later automatically benefits every already-cached lookup without needing to
// re-spend on Blitz. (Cost of getting this wrong the first time: nameMatches was baked into the
// cached object below the widened nameSimilar() rewrite, so results processed before that
// rewrite quietly used the stricter, false-negative-prone version until now.)
export async function lookupByDomain(domain, cache) {
  const key = cacheKey(domain);
  if (cache[key] !== undefined) return cache[key];
  if (!BLITZ_KEY) throw new Error('BLITZ_API_KEY not set');

  const d2l = await blitzPost('/v2/enrichment/domain-to-linkedin', { domain: `https://${domain}` });
  if (!d2l?.found || !d2l.company_linkedin_url) { cache[key] = null; return null; }

  const enrich = await blitzPost('/v2/enrichment/company', { company_linkedin_url: d2l.company_linkedin_url });
  if (!enrich?.found) { cache[key] = null; return null; }

  const c = enrich.company;
  const result = {
    linkedinUrl: d2l.company_linkedin_url,
    linkedinCompanyName: d2l.company_name || c.name,
    industry: c.industry || null,
    size: c.size || null,
    employeesOnLinkedin: c.employees_on_linkedin || null,
    about: c.about || null,
    hqCountry: c.hq?.country_code || null,
  };
  cache[key] = result;
  return result;
}

export function matchesTarget(blitzResult, targetName) {
  return nameSimilar(targetName, blitzResult.linkedinCompanyName || '');
}

// Best single employee number from a Blitz profile, for storing in the DB. The `size` bracket
// midpoint is PRIMARY: it's LinkedIn's (Recruiter-estimated) real headcount. employees_on_linkedin
// only counts people who tagged the page and systematically undercounts (production/blue-collar
// staff rarely register) — fallback only. Getting this backwards is the Grolsch bug (2026-07-14
// live run: size "501-1000" but employees_on_linkedin 37 → auto-rejected a real target).
// NOTE: deterministicClassify() used to live here (hard numeric pass/reject from these fields) —
// removed 2026-07-15 per Leo's "no hard numeric cutoffs, AI judges always" direction; the single
// decision path is now companyClassifier.mjs classifyCompany(), which takes the raw Blitz profile
// as evidence.
export function blitzEmployees(blitz) {
  return parseSizeMidpoint(blitz.size) ?? (blitz.employeesOnLinkedin > 0 ? blitz.employeesOnLinkedin : null);
}

function parseSizeMidpoint(sizeStr) {
  if (!sizeStr) return null;
  const m = String(sizeStr).match(/(\d[\d,]*)\s*-\s*(\d[\d,]*)/);
  if (!m) return null;
  const lo = parseInt(m[1].replace(/,/g, ''), 10);
  const hi = parseInt(m[2].replace(/,/g, ''), 10);
  return Math.round((lo + hi) / 2);
}
