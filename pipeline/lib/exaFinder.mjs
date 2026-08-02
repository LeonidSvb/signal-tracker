// Resolve a company's real domain + about-text from just its name (no domain known yet).
// Validated 2026-07-14: 12/12 real unresolved signal companies resolved correctly with this
// exact 2-call recipe (category:'company' search -> filter out non-owned hosts -> includeDomains
// search for text). See exa/EXA_NOTES.md "Exa Finder API" for the earlier domain-known-in-advance
// test this builds on.
//
// Caller owns the cache object (load/save via exaCache.mjs) — every live call here is cached
// by the caller before returning, so a crashed/interrupted run never re-pays for a company
// it already resolved.

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
loadEnvFile(join(__dir, '../../../../../.env'));

const EXA_KEY = process.env.EXA_API_KEY;

const BLOCKLIST_HOSTS = [
  'linkedin.com', 'wikipedia.org', 'bloomberg.com', 'crunchbase.com', 'facebook.com',
  'twitter.com', 'x.com', 'instagram.com', 'youtube.com', 'vegconomist.com', 'esmmagazine.com',
  'retaildetail.eu', 'feedbusiness.co', 'foodnavigator.com', 'foodbev.com', 'just-food.com',
  'reuters.com', 'bing.com', 'google.com',
];

function ownHost(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (BLOCKLIST_HOSTS.some(b => host === b || host.endsWith('.' + b))) return null;
    return host;
  } catch { return null; }
}

// Exa's hard ceiling is 10 req/sec (verified live 2026-07-18 — the 429 body states it
// verbatim; also recorded in signals/CLAUDE.md rate limits). fetchRetry only retries
// network aborts, so 429 needs its own backoff here or a concurrency burst kills the
// whole company (found live: ~46 companies errored out of one resolve run at
// CONCURRENCY=20 before this existed).
async function exaSearch(body) {
  const MAX_429_RETRIES = 4;
  for (let attempt = 0; ; attempt++) {
    const res = await fetchRetry('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'x-api-key': EXA_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (res.ok) return json;
    if (res.status === 429 && attempt < MAX_429_RETRIES) {
      const waitMs = 1000 * (attempt + 1) + Math.floor(Math.random() * 500);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }
    throw new Error(`[exa] search ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  }
}

export function cacheKey(name, country) {
  return `${String(name || '').toLowerCase().trim()}::${(country || '').toUpperCase()}`;
}

// Step 1 — find the company's own domain from name + country alone.
// NOTE: deliberately no `contents` param here — this call only ever reads `.url`/`.title` off
// results to pick a domain, never `.text`. Requesting contents.text anyway (found 2026-07-14,
// mid-session) was pure waste: Exa bills content extraction as its own line item ($1/1k pages,
// separate from the $7/1k search fee — confirmed against exa.ai/pricing) on top of the search
// call, for up to `numResults` pages, none of which this function ever looks at.
export async function resolveDomain(name, country, cache) {
  if (!EXA_KEY) throw new Error('EXA_API_KEY not set');
  const key = cacheKey(name, country);
  if (cache[key]) return cache[key];

  const query = `${name} ${country || ''} official website`.trim();
  const body = await exaSearch({
    query,
    numResults: 5,
    category: 'company',
  });
  const candidates = (body.results || []).map(x => ({ url: x.url, title: x.title }));
  let domain = null;
  for (const c of candidates) {
    const host = ownHost(c.url);
    if (host) { domain = host; break; }
  }

  const result = { domain, candidates, resolvedAt: new Date().toISOString() };
  cache[key] = result;
  return result;
}

// Step 2 — pull about-text from the resolved domain (validated method, domain already known).
export async function fetchAbout(domain, name, cache) {
  if (!EXA_KEY) throw new Error('EXA_API_KEY not set');
  if (!domain) return { text: null, title: null };
  if (cache[domain]) return cache[domain];

  const body = await exaSearch({
    query: `${name || domain} food company about`,
    numResults: 1,
    includeDomains: [domain],
    contents: { text: { maxCharacters: 1200 } },
  });
  const result = {
    text:  body.results?.[0]?.text  || null,
    title: body.results?.[0]?.title || null,
    url:   body.results?.[0]?.url   || null,
    fetchedAt: new Date().toISOString(),
  };
  cache[domain] = result;
  return result;
}

// Resolve a company's LinkedIn COMPANY page (not a person profile) from name + domain.
// Built 2026-07-31 after a live test found the real gap: Blitz's own domain->LinkedIn match
// misses real, findable companies (7/7 spot-checked — Findus Switzerland, SARIA France,
// Maïsadour, Nexira, Upside Foods, Vitamin Well Group, Agristo — all had a real LinkedIn page
// Exa found on the first query, none had linkedin_url set from Blitz). Companies with no
// linkedin_url never become find_contacts_exa gap-mode candidates (that stage requires it) —
// a closed loop that never self-heals without this. No `contents` param — title/url alone are
// enough to verify a match, keeps this the cheap $7/1k search-only tier.
const LINKEDIN_COMPANY_URL_RE = /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/company\/[^/]+\/?$/i;

const ACCENT_MAP = { é:'e',è:'e',ê:'e',ë:'e',à:'a',â:'a',ü:'u',ö:'o',ä:'a',ß:'ss',ç:'c',û:'u',î:'i',ï:'i',ô:'o',œ:'oe',æ:'ae',ø:'o',å:'a' };
function normName(s) { return String(s || '').toLowerCase().replace(/[éèêëàâüöäßçûîïôœæøå]/g, c => ACCENT_MAP[c] || c).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
const STRIP_SUFFIX = /\b(gmbh|co|kg|ag|sa|nv|bv|srl|ltd|inc|corp|llc|sas|snc|ohg|se|plc|cie|group|gruppe|holding|international|deutschland|france|switzerland)\b/g;
// First significant word of the company's core name — matches classify_company.mjs's own
// coreName() heuristic (norm + strip legal suffixes), the cheapest reliable false-positive
// guard without spending on contents.text just to read a headline.
function coreWord(name) {
  const core = normName(name).replace(STRIP_SUFFIX, ' ').replace(/\s+/g, ' ').trim();
  return (core.split(' ')[0] || '').replace(/[^a-z0-9]/g, '');
}

// candidates: raw Exa search results (url, title) — exported alongside the picked match so a
// caller can log/inspect why a company was skipped (no match) instead of just seeing null.
export async function resolveCompanyLinkedin(name, domain, cache) {
  if (!EXA_KEY) throw new Error('EXA_API_KEY not set');
  const key = cacheKey(name, domain);
  if (cache[key]) return cache[key];

  // No `category` param deliberately — 'linkedin profile' (used by find_contacts_exa.mjs for
  // PEOPLE search) biases results toward /in/ person profiles, the opposite of what this needs.
  // Confirmed live 2026-07-31: adding it turned a 7/7 hit rate into 0/7 (all /in/ results).
  const query = `${name} company site:linkedin.com/company`;
  const body = await exaSearch({ query, numResults: 3 });
  const candidates = (body.results || []).map(x => ({ url: x.url, title: x.title }));

  const needle = coreWord(name);
  // Word-boundary, not substring — found live 2026-07-31: "Back-Factory" -> needle "back"
  // substring-matched "Backyard Fun Factory"'s slug and wrongly linked a different real company.
  const needleRe = needle.length >= 3 ? new RegExp(`\\b${needle}\\b`) : null;
  let linkedinUrl = null;
  for (const c of candidates) {
    if (!LINKEDIN_COMPANY_URL_RE.test(c.url)) continue; // exclude /jobs, /posts, /in/ profiles etc.
    const haystack = normName(c.url) + ' ' + normName(c.title);
    if (needleRe && !needleRe.test(haystack)) continue; // guards short/generic names too weakly to filter — same tradeoff as find_contacts_exa's mentionsCompany
    linkedinUrl = c.url;
    break;
  }

  const result = { linkedinUrl, candidates, resolvedAt: new Date().toISOString() };
  cache[key] = result;
  return result;
}

// Fallback for headlines that don't name a company at all (e.g. a press-release teaser like
// "Munich startup launches..." with the real name only in the body). Fetches the source
// article's own text directly — validated 2026-07-14 manually recovering "Münchner Startup"
// -> "Circular grain" this way after search-based resolution found nothing usable.
export async function fetchArticleText(url, cache) {
  if (!EXA_KEY) throw new Error('EXA_API_KEY not set');
  if (!url) return { text: null };
  if (cache[url]) return cache[url];

  const res = await fetchRetry('https://api.exa.ai/contents', {
    method: 'POST',
    headers: { 'x-api-key': EXA_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls: [url], text: { maxCharacters: 1500 } }),
  });
  const body = await res.json();
  const result = { text: body.results?.[0]?.text || null, fetchedAt: new Date().toISOString() };
  cache[url] = result;
  return result;
}
