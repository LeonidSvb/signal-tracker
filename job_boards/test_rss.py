"""
Job boards RSS/API — full signal scan — Philippe Bosquillon / HRExpertgroup
Sources : Adzuna DE/FR/NL/BE, EURES EU API, EuroJobs RSS
Signals : fresh postings (last 14d) | stale open roles (60+ d) | hiring surge (3+ roles) | repeated repost
Note    : Indeed RSS blocked (HTTP 403) — replaced with working alternatives
"""
import urllib.request, urllib.parse, xml.etree.ElementTree as ET
import csv, json, os, sys, time, re
from datetime import datetime
from collections import defaultdict
from difflib import SequenceMatcher
from email.utils import parsedate_to_datetime

# Fix Windows console encoding
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT        = 'C:/Users/79818/Desktop/Mastr_Leads/clients/philippe-bosquillon'
COMPANIES   = f'{ROOT}/1_filtering/companies_pass.csv'
OUT_DIR     = f'{ROOT}/signals/job_boards'
LOG_CSV     = f'{OUT_DIR}/test_log.csv'
ALL_CSV     = f'{OUT_DIR}/signals_all.csv'
STALE_CSV   = f'{OUT_DIR}/signals_stale.csv'
FRESH_CSV   = f'{OUT_DIR}/signals_fresh.csv'
SURGE_CSV   = f'{OUT_DIR}/signals_hiring_surge.csv'
REPOST_CSV  = f'{OUT_DIR}/signals_repost.csv'
FINDINGS    = f'{OUT_DIR}/findings.txt'
CACHE_FILE  = f'{OUT_DIR}/cache.json'

os.makedirs(OUT_DIR, exist_ok=True)

# ── Target companies ──────────────────────────────────────────────────────────
with open(COMPANIES, encoding='utf-8') as f:
    target_rows = list(csv.DictReader(f))

def _clean(name):
    return re.sub(r'\b(gmbh|bv|b\.v\.|nv|n\.v\.|sa|s\.a\.|sas|srl|ag|ltd|inc|llc|group|groep|gruppe|holding|foods|food|france|deutschland|germany|netherlands|belgie|belgique)\b', '', name.lower()).strip(' -–')

company_names_raw  = [r['name'].strip() for r in target_rows if r.get('name')]
company_names_clean = [_clean(n) for n in company_names_raw]
print(f'Target companies: {len(company_names_raw)}')

def fuzzy_match(raw_name, threshold=0.72):
    c = _clean(raw_name)
    if len(c) < 3:
        return None, 0.0
    best_score, best_idx = 0.0, -1
    for i, cn in enumerate(company_names_clean):
        if not cn:
            continue
        s = SequenceMatcher(None, c, cn).ratio()
        if s > best_score:
            best_score, best_idx = s, i
    if best_score >= threshold and best_idx >= 0:
        return company_names_raw[best_idx], round(best_score, 2)
    return None, round(best_score, 2)

# ── Senior role title keywords (for signal classification) ────────────────────
EXEC_TITLES_RE = re.compile(
    r'(CEO|CFO|COO|CTO|CPO|CMO'
    r'|Managing Director|General Manager|Gesch.{1,3}ftsf.{1,3}hrer|Directeur G.n.ral|DG\b'
    r'|HR Director|Head of HR|HR Manager|Chief People|VP HR|VP People|DRH\b|Personalleiter|Directeur RH|HR Directeur'
    r'|Operations Director|Betriebsleiter|Werksleiter|Directeur .{1,12}Operations|Operationeel Directeur'
    r'|Plant Manager|Directeur .{1,10}Usine|Fabrieksdirecteur|Werksdirecteur'
    r'|Supply Chain Director|VP Supply|Directeur Supply|Supply Chain Leiter'
    r'|Commercial Director|Sales Director|Vertriebsleiter|Directeur Commercial|Commercieel Directeur'
    r'|Country Manager|Regional Director)',
    re.IGNORECASE
)

def is_exec_role(title):
    return bool(EXEC_TITLES_RE.search(title))

# ── HTTP fetch with cache ──────────────────────────────────────────────────────
cache = {}
if os.path.exists(CACHE_FILE):
    with open(CACHE_FILE, encoding='utf-8') as f:
        cache = json.load(f)

def fetch(url, label):
    if label in cache:
        return cache[label]
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',
        'Accept': 'application/rss+xml,application/xml,text/xml,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=18) as r:
            raw = r.read().decode('utf-8', errors='replace')
        cache[label] = {'status': 'ok', 'data': raw}
        time.sleep(1.8)
        return cache[label]
    except urllib.error.HTTPError as e:
        cache[label] = {'status': 'error', 'error': f'HTTP {e.code}'}
        time.sleep(1.0)
        return cache[label]
    except Exception as e:
        cache[label] = {'status': 'error', 'error': str(e)[:80]}
        time.sleep(0.5)
        return cache[label]

# ── RSS parser ────────────────────────────────────────────────────────────────
INDEED_NS = 'http://www.indeed.com/'

def _days_old(pub_str):
    if not pub_str:
        return None
    try:
        dt = parsedate_to_datetime(pub_str).replace(tzinfo=None)
        return max(0, (datetime.utcnow() - dt).days)
    except:
        return None

def _pub_clean(pub_str):
    try:
        return parsedate_to_datetime(pub_str).strftime('%Y-%m-%d')
    except:
        return pub_str[:10] if pub_str else ''

def _extract_company(item, title):
    for tag in [f'{{{INDEED_NS}}}company', 'source', 'author']:
        v = item.findtext(tag, '').strip()
        if v and len(v) > 1:
            return v
    desc = item.findtext('description', '')
    m = re.search(r'(?:at|bei|chez|bij)\s+([A-ZÄÖÜ][^\<\n,]{3,45})', desc)
    if m:
        return m.group(1).strip()
    # "Title - Company" pattern in title
    m = re.search(r'[-–]\s*([A-ZÄÖÜ][^\<\n]{3,45})$', title)
    if m:
        return m.group(1).strip()
    return ''

def parse_rss(xml_str):
    items = []
    try:
        root = ET.fromstring(xml_str)
    except:
        return items
    for item in root.iter('item'):
        title   = item.findtext('title', '').strip()
        link    = item.findtext('link', '').strip()
        pub_raw = item.findtext('pubDate', '').strip()
        company = _extract_company(item, title)
        days    = _days_old(pub_raw)
        items.append({
            'title':    title,
            'company':  company,
            'pub_date': _pub_clean(pub_raw),
            'days_old': days,
            'url':      link,
        })
    return items

# ── Query definitions ─────────────────────────────────────────────────────────
# Each tuple: (source, country, lang, url_template_with_{kw}, keywords, fromage)
# fromage=90 → catch stale; fromage=14 → fresh last 2 weeks (separate pass)

# Indeed RSS blocked (HTTP 403) — not used
# Adzuna correct RSS endpoint
ADZUNA_BASE = {
    'DE': 'https://www.adzuna.de/jobs/search?q={kw}&sort_by=date&results_per_page=50&output=rss',
    'FR': 'https://www.adzuna.fr/jobs/search?q={kw}&sort_by=date&results_per_page=50&output=rss',
    'NL': 'https://www.adzuna.nl/jobs/search?q={kw}&sort_by=date&results_per_page=50&output=rss',
    'BE': 'https://www.adzuna.be/jobs/search?q={kw}&sort_by=date&results_per_page=50&output=rss',
}
# EURES REST API (EU official open API, no auth needed)
# country codes: DE, FR, NL, BE, LU
EURES_BASE = 'https://eures.europa.eu/api/jobs?keywords={kw}&countryCode={cc}&page=1&pageSize=50&sortBy=MOST_RECENT'
EURES_COUNTRIES = ['DE', 'FR', 'NL', 'BE', 'LU']

KEYWORDS = {
    'DE': {
        'de': [
            'Geschaeftsfuehrer Lebensmittel',
            'Personalleiter Lebensmittelindustrie',
            'Betriebsleiter Lebensmittel',
            'Werksleiter Lebensmittel',
            'Kaufmaennischer Leiter Lebensmittel',
            'Vertriebsleiter Lebensmittel',
            'Supply Chain Leiter Ernaehrung',
        ],
        'en': [
            'food managing director',
            'food HR director',
            'food operations director',
            'food plant manager',
            'food commercial director',
        ],
    },
    'FR': {
        'fr': [
            'directeur general agroalimentaire',
            'DRH agroalimentaire',
            'directeur usine agroalimentaire',
            'directeur commercial agroalimentaire',
            'directeur operations agroalimentaire',
            'directeur supply chain agroalimentaire',
        ],
        'en': [
            'food managing director france',
            'food HR director france',
            'food operations director france',
        ],
    },
    'NL': {
        'nl': [
            'directeur voedingsmiddelen',
            'HR directeur food',
            'operationeel directeur voeding',
            'fabrieksdirecteur voedingsmiddelen',
            'commercieel directeur voeding',
        ],
        'en': [
            'food managing director netherlands',
            'food HR director netherlands',
        ],
    },
    'BE': {
        'fr': [
            'directeur alimentaire belgique',
            'DRH agroalimentaire belgique',
            'directeur general industrie alimentaire',
        ],
        'en': [
            'food director belgium',
            'food HR director belgium',
        ],
    },
}

def build_queries():
    queries = []
    # EURES keywords (shorter, EN only — API works best with EN)
    EURES_KW = [
        'food managing director', 'food HR director', 'food operations director',
        'food plant manager', 'food CEO', 'food commercial director',
        'food supply chain director', 'food general manager',
    ]
    for kw in EURES_KW:
        for cc in EURES_COUNTRIES:
            kw_enc = urllib.parse.quote(kw)
            url = EURES_BASE.replace('{kw}', kw_enc).replace('{cc}', cc)
            queries.append(('eures', cc, 'en', url, kw, None))

    # Adzuna RSS
    for country, langs in KEYWORDS.items():
        for lang, kws in langs.items():
            for kw in kws:
                kw_enc = urllib.parse.quote(kw)
                if country in ADZUNA_BASE:
                    url_az = ADZUNA_BASE[country].replace('{kw}', kw_enc)
                    queries.append(('adzuna', country, lang, url_az, kw, None))
    return queries

QUERIES = build_queries()
print(f'Total queries: {len(QUERIES)}\n')

# ── EURES JSON parser ─────────────────────────────────────────────────────────
def parse_eures(json_str):
    items = []
    try:
        data = json.loads(json_str)
        jobs = data.get('jobs') or data.get('data') or data.get('results') or []
        if isinstance(data, list):
            jobs = data
        for job in jobs:
            title   = job.get('title') or job.get('jobTitle') or ''
            company = job.get('employer') or job.get('companyName') or job.get('company') or ''
            pub_raw = job.get('publicationDate') or job.get('publishedOn') or job.get('datePosted') or ''
            link    = job.get('url') or job.get('applyUrl') or job.get('uri') or ''
            # normalize date
            pub_clean = pub_raw[:10] if pub_raw else ''
            days = None
            if pub_clean and len(pub_clean) == 10:
                try:
                    dt = datetime.strptime(pub_clean, '%Y-%m-%d')
                    days = max(0, (datetime.utcnow() - dt).days)
                except:
                    pass
            items.append({'title': str(title), 'company': str(company),
                          'pub_date': pub_clean, 'days_old': days, 'url': str(link)})
    except:
        pass
    return items

# ── Run queries ───────────────────────────────────────────────────────────────
log_rows  = []
all_items = []   # (source, country, lang, kw, item + match info)

for source, country, lang, url, kw, fromage in QUERIES:
    label = f'{source}_{country}_{lang}_{kw[:28]}'
    print(f'  [{source}/{country}/{lang}] {kw[:45]}...', end=' ', flush=True)

    resp = fetch(url, label)

    if resp['status'] == 'error':
        print(f'ERROR: {resp["error"]}')
        log_rows.append({'source': source, 'country': country, 'lang': lang,
                         'keywords': kw, 'fromage': fromage,
                         'status': 'ERROR', 'error': resp['error'],
                         'num_results': 0, 'exec_roles': 0,
                         'stale_60d': 0, 'fresh_14d': 0, 'target_matches': 0,
                         'avg_days_old': '', 'sample': ''})
        continue

    items = parse_eures(resp['data']) if source == 'eures' else parse_rss(resp['data'])
    days_list = [i['days_old'] for i in items if i['days_old'] is not None]
    stale     = sum(1 for d in days_list if d >= 60)
    fresh     = sum(1 for d in days_list if d <= 14)
    exec_cnt  = sum(1 for i in items if is_exec_role(i['title']))
    avg_days  = round(sum(days_list)/len(days_list), 1) if days_list else ''

    matched = 0
    for item in items:
        m, score = fuzzy_match(item['company']) if item['company'] else (None, 0)
        item['company_match'] = m
        item['match_score']   = score
        item['is_exec']       = is_exec_role(item['title'])
        if m:
            matched += 1
            all_items.append((source, country, lang, kw, item))

    sample = ' | '.join(f"{i['title'][:45]}({i['days_old']}d)" for i in items[:3])
    print(f'n={len(items)} stale={stale} fresh={fresh} exec={exec_cnt} matches={matched}')

    log_rows.append({'source': source, 'country': country, 'lang': lang,
                     'keywords': kw, 'fromage': fromage,
                     'status': 'OK', 'error': '',
                     'num_results': len(items), 'exec_roles': exec_cnt,
                     'stale_60d': stale, 'fresh_14d': fresh,
                     'target_matches': matched,
                     'avg_days_old': avg_days, 'sample': sample})

# Save cache
with open(CACHE_FILE, 'w', encoding='utf-8') as f:
    json.dump(cache, f, ensure_ascii=False, indent=2)

# ── Build output rows ─────────────────────────────────────────────────────────
def make_row(source, country, lang, kw, item):
    return {
        'source':         source,
        'country':        country,
        'query_kw':       kw,
        'job_title':      item['title'],
        'company_raw':    item['company'],
        'company_match':  item['company_match'] or '',
        'match_score':    item['match_score'],
        'pub_date':       item['pub_date'],
        'days_old':       item['days_old'] if item['days_old'] is not None else '',
        'is_exec':        'yes' if item['is_exec'] else 'no',
        'stale_60d':      'YES' if item['days_old'] and item['days_old'] >= 60 else 'no',
        'fresh_14d':      'YES' if item['days_old'] is not None and item['days_old'] <= 14 else 'no',
        'url':            item['url'],
    }

ALL_FIELDS = ['source','country','query_kw','job_title','company_raw','company_match',
              'match_score','pub_date','days_old','is_exec','stale_60d','fresh_14d','url']

rows_all   = [make_row(*t) for t in all_items]
rows_stale = [r for r in rows_all if r['stale_60d'] == 'YES']
rows_fresh = [r for r in rows_all if r['fresh_14d'] == 'YES']

def save_csv(path, rows, fields):
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)

save_csv(ALL_CSV,   rows_all,   ALL_FIELDS)
save_csv(STALE_CSV, rows_stale, ALL_FIELDS)
save_csv(FRESH_CSV, rows_fresh, ALL_FIELDS)

# ── Hiring surge: company with 3+ distinct senior postings (deduped by url) ──
seen_urls = set()
company_postings = defaultdict(list)
for row in rows_all:
    url_ = row['url']
    if url_ in seen_urls:
        continue
    seen_urls.add(url_)
    if row['company_match']:
        company_postings[row['company_match']].append(row)

surge_rows = []
for company, postings in company_postings.items():
    if len(postings) >= 2:   # 2+ distinct roles already interesting
        titles = ' | '.join(set(p['job_title'][:50] for p in postings))
        surge_rows.append({
            'company_match':   company,
            'num_postings':    len(postings),
            'role_titles':     titles,
            'countries':       ','.join(sorted(set(p['country'] for p in postings))),
            'min_days_old':    min((p['days_old'] for p in postings if p['days_old'] != ''), default=''),
            'max_days_old':    max((p['days_old'] for p in postings if p['days_old'] != ''), default=''),
            'signal':          'SURGE (3+)' if len(postings) >= 3 else 'WATCH (2)',
        })
surge_rows.sort(key=lambda r: r['num_postings'], reverse=True)
save_csv(SURGE_CSV, surge_rows,
         ['company_match','num_postings','signal','role_titles','countries','min_days_old','max_days_old'])

# ── Repost detection: same company + similar title appearing in multiple queries
repost_candidates = defaultdict(list)
for row in rows_all:
    if row['company_match']:
        key = f"{row['company_match']}___{row['job_title'][:40].lower()}"
        repost_candidates[key].append(row)

repost_rows = []
for key, occurrences in repost_candidates.items():
    if len(occurrences) >= 2:
        r = occurrences[0]
        repost_rows.append({
            'company_match':  r['company_match'],
            'job_title':      r['job_title'],
            'occurrences':    len(occurrences),
            'sources':        ','.join(set(o['source'] for o in occurrences)),
            'days_old':       r['days_old'],
            'stale_60d':      r['stale_60d'],
            'url':            r['url'],
        })
repost_rows.sort(key=lambda r: r['occurrences'], reverse=True)
save_csv(REPOST_CSV, repost_rows,
         ['company_match','job_title','occurrences','sources','days_old','stale_60d','url'])

# ── Test log ──────────────────────────────────────────────────────────────────
log_fields = ['source','country','lang','keywords','fromage','status','error',
              'num_results','exec_roles','stale_60d','fresh_14d','target_matches',
              'avg_days_old','sample']
save_csv(LOG_CSV, log_rows, log_fields)

# ── Findings summary ──────────────────────────────────────────────────────────
ok     = [r for r in log_rows if r['status'] == 'OK']
errors = [r for r in log_rows if r['status'] == 'ERROR']
total  = sum(r['num_results'] for r in ok)
t_stale = sum(r['stale_60d'] for r in ok)
t_fresh = sum(r['fresh_14d'] for r in ok)
t_exec  = sum(r['exec_roles'] for r in ok)
t_match = sum(r['target_matches'] for r in ok)

summary = f"""JOB BOARDS RSS TEST — {datetime.utcnow().strftime('%Y-%m-%d')}
=======================================================

QUERIES
  Total     : {len(log_rows)}
  OK        : {len(ok)}
  Errors    : {len(errors)}

RAW RESULTS (across all OK queries)
  Total postings    : {total}
  Exec-level roles  : {t_exec}
  Fresh (<=14 days) : {t_fresh}
  Stale (60+ days)  : {t_stale}
  Target matches    : {t_match}

SIGNALS BREAKDOWN
  signals_all.csv   : {len(rows_all)} rows (all target-matched postings)
  signals_fresh.csv : {len(rows_fresh)} rows (last 14d at target companies)
  signals_stale.csv : {len(rows_stale)} rows (60+ days open at target companies)
  signals_hiring_surge.csv : {len(surge_rows)} companies (2+ postings)
  signals_repost.csv       : {len(repost_rows)} roles posted across multiple sources

ERRORS
"""
for r in errors:
    summary += f'  [{r["source"]}/{r["country"]}] {r["keywords"][:35]} → {r["error"]}\n'

summary += f"""
SOURCES BREAKDOWN
"""
by_source = defaultdict(lambda: {'ok': 0, 'results': 0, 'matches': 0})
for r in log_rows:
    by_source[r['source']]['ok']      += 1 if r['status'] == 'OK' else 0
    by_source[r['source']]['results'] += r.get('num_results', 0)
    by_source[r['source']]['matches'] += r.get('target_matches', 0)
for src, v in by_source.items():
    summary += f'  {src:8s}: ok={v["ok"]} results={v["results"]} matches={v["matches"]}\n'

summary += f"""
TOP STALE SIGNALS (60+ days open at target companies)
"""
for r in sorted(rows_stale, key=lambda x: x['days_old'] if x['days_old'] != '' else 0, reverse=True)[:15]:
    summary += f'  [{r["days_old"]}d] {r["company_match"]} — {r["job_title"][:60]}\n'

summary += f"""
TOP FRESH SIGNALS (last 14 days at target companies)
"""
for r in sorted(rows_fresh, key=lambda x: x['days_old'] if x['days_old'] != '' else 999)[:15]:
    summary += f'  [{r["days_old"]}d] {r["company_match"]} — {r["job_title"][:60]}\n'

summary += f"""
HIRING SURGE (2+ open roles at same company)
"""
for r in surge_rows[:10]:
    summary += f'  {r["signal"]} {r["company_match"]} ({r["num_postings"]} roles) — {r["role_titles"][:80]}\n'

with open(FINDINGS, 'w', encoding='utf-8') as f:
    f.write(summary)

print('\n' + summary)
