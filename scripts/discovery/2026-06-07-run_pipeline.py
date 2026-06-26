"""
Job signal pipeline — Philippe Bosquillon / HRExpertgroup
Produces: job_signals_enriched.csv — ICP-matched companies + contacts
"""
import urllib.request, urllib.error, json, time, sys, re, csv, os
from pathlib import Path
from datetime import datetime, timezone
from difflib import SequenceMatcher

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# ── Env ───────────────────────────────────────────────────────────────────────
ROOT = Path('C:/Users/79818/Desktop/Mastr_Leads')
ENV  = {}
for line in (ROOT / '.env').read_text(encoding='utf-8').splitlines():
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, _, v = line.partition('='); ENV[k.strip()] = v.strip()

APIFY_KEYS = [k for k in [ENV.get('APIFY_KEY_STD'), ENV.get('APIFY_KEY_KAD2')] if k]
EXA_KEY    = ENV.get('EXA_API_KEY', '')
BLITZ_KEY  = (ROOT / 'blitz/.env').read_text(encoding='utf-8')
BLITZ_KEY  = next((l.split('=',1)[1].strip() for l in BLITZ_KEY.splitlines()
                   if l.startswith('BLITZ_API_KEY')), '')
OPENROUTER = ENV.get('OPENROUTER_KEY', '')

OUT_DIR    = ROOT / 'clients/philippe-bosquillon/signals/job_boards'
FINAL_CSV  = OUT_DIR / 'job_signals_enriched.csv'
CACHE_FILE = OUT_DIR / 'pipeline_cache.json'
COMPANIES  = ROOT / 'clients/philippe-bosquillon/1_filtering/companies_pass.csv'
CONTACTS1  = ROOT / 'clients/philippe-bosquillon/3_contacts/contacts_new_raw.csv'
CONTACTS2  = ROOT / 'clients/philippe-bosquillon/3_contacts/contacts_ef_raw.csv'

print(f'Apify keys: {len(APIFY_KEYS)} | Exa: {"ok" if EXA_KEY else "missing"} | Blitz: {"ok" if BLITZ_KEY else "missing"}')

# ── Load cache ────────────────────────────────────────────────────────────────
cache = json.loads(CACHE_FILE.read_text('utf-8')) if CACHE_FILE.exists() else {}
def save_cache(): CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), 'utf-8')

# ── Load target companies ─────────────────────────────────────────────────────
with open(COMPANIES, encoding='utf-8') as f:
    companies = list(csv.DictReader(f))

def _norm(name):
    return re.sub(r'\b(gmbh|bv|b\.v\.|nv|sa|sas|ag|ltd|inc|group|groep|gruppe|holding|'
                  r'foods?|france|deutschland|netherlands|belgique|belgie)\b', '',
                  name.lower()).strip(' -–.,')

company_names_raw   = [c['name'].strip() for c in companies]
company_names_norm  = [_norm(n) for n in company_names_raw]
company_by_name     = {n: c for n, c in zip(company_names_raw, companies)}

def fuzzy_match(raw, threshold=0.78):
    c = _norm(raw)
    if len(c) < 3: return None, 0.0
    best, idx = 0.0, -1
    for i, cn in enumerate(company_names_norm):
        if not cn: continue
        s = SequenceMatcher(None, c, cn).ratio()
        if s > best: best, idx = s, i
    if best >= threshold and idx >= 0:
        return company_names_raw[idx], round(best, 2)
    return None, round(best, 2)

# ── Load existing contacts ────────────────────────────────────────────────────
existing_contacts = {}  # domain -> list of contact dicts
for path in [CONTACTS1, CONTACTS2]:
    if not path.exists(): continue
    with open(path, encoding='utf-8') as f:
        for row in csv.DictReader(f):
            dom = (row.get('domain') or row.get('website') or '').strip().lower()
            if dom:
                existing_contacts.setdefault(dom, []).append(row)

print(f'Target companies: {len(companies)} | Existing contacts by domain: {len(existing_contacts)}')

# ── Filters ───────────────────────────────────────────────────────────────────
EXEC_RE = re.compile(
    r'(CEO|CFO|COO|CTO|Managing Director|General Manager|Country Manager|Gesch.{1,4}ftsf.{1,4}hrer'
    r'|Directeur G.n.ral|Directeur Ex.cutif|DG\b|PDG\b|Gerant|G.rant'
    r'|HR Director|Chief People|Head of HR|Personalleiter|DRH\b|Directeur RH|HR Directeur|VP HR|VP People'
    r'|Operations Director|Betriebsleiter|Werksleiter|Directeur d.{1,6}[Uu]sine|Plant Manager'
    r'|Fabrieksdirecteur|Operationeel Directeur|Directeur [Oo]p.rations'
    r'|Commercial Director|Sales Director|Vertriebsleiter|Directeur [Cc]ommercial|Commercieel Directeur'
    r'|Supply Chain Director|Directeur Supply|VP |Vice President|Regional Director'
    r'|Kaufm.{1,5}nnisch.{1,5} (Leiter|Leitung|Gesch))',
    re.IGNORECASE
)
FOOD_RE = re.compile(
    r'(Lebensmittel|agroalimentaire|agro.alimentaire|voedingsmiddelen|voedsel|levensmiddelen'
    r'|alimentaire|food|FMCG|Ern.{1,4}hrung|Nahrungsmittel|Getr.{1,3}nk|boisson'
    r'|ingredient|dairy|milch|zuivel|lait|boulangerie|backware|fromagerie|fromageur'
    r'|fleisch|viande|vlees|kaas|fromage|cheese|chocolat|confiserie|confectionery|bakery'
    r'|S.{1,3}.waren|zucker|sucre|snack|beverage|brasserie|brouwerij|brauerei'
    r'|agricole|agribusiness|landwirtschaft|farming|harvest|r.colte'
    r'|meat|poultry|volaille|gefl.{1,3}gel|fish|seafood|fisch|vis\b'
    r'|packaging food|food processing|food production|food manufacturing)',
    re.IGNORECASE
)

def is_exec(title): return bool(EXEC_RE.search(title))
def is_food(title, desc): return bool(FOOD_RE.search(title + ' ' + desc[:500]))

# ── Apify Indeed runner ───────────────────────────────────────────────────────
apify_idx = [0]
def next_key():
    k = APIFY_KEYS[apify_idx[0] % len(APIFY_KEYS)]
    apify_idx[0] += 1
    return k

BASE = 'https://api.apify.com/v2'

def apify_run(body, label):
    if label in cache.get('runs', {}):
        print(f'  [cached] {label}')
        return cache['runs'][label]
    key = next_key()
    url = f'{BASE}/acts/misceres~indeed-scraper/runs?token={key}'
    req = urllib.request.Request(url, json.dumps(body).encode(),
          headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            run_id = json.loads(r.read())['data']['id']
    except urllib.error.HTTPError as e:
        print(f'  START ERROR {e.code}: {e.read()[:200]}')
        return []
    print(f'  started {run_id} (key ...{key[-6:]})', end=' ', flush=True)
    deadline = time.time() + 420
    while time.time() < deadline:
        url2 = f'{BASE}/acts/misceres~indeed-scraper/runs/{run_id}?token={key}'
        with urllib.request.urlopen(url2, timeout=20) as r:
            data = json.loads(r.read())['data']
        status = data['status']
        print(f'[{status}]', end=' ', flush=True)
        if status == 'SUCCEEDED':
            ds = data['defaultDatasetId']
            url3 = f'{BASE}/datasets/{ds}/items?token={key}&limit=200&clean=true'
            with urllib.request.urlopen(url3, timeout=30) as r:
                items = json.loads(r.read())
            print(f'→ {len(items)} jobs')
            cache.setdefault('runs', {})[label] = items
            save_cache()
            return items
        if status in ('FAILED', 'ABORTED', 'TIMED-OUT'):
            print(f'FAILED')
            return []
        time.sleep(12)
    print('TIMEOUT')
    return []

# ── Queries ───────────────────────────────────────────────────────────────────
QUERIES = [
    # DE
    dict(position='Geschaeftsfuehrer',          country='DE', location='Deutschland', maxItems=50),
    dict(position='Betriebsleiter Lebensmittel', country='DE', location='Deutschland', maxItems=50),
    dict(position='Personalleiter Lebensmittel', country='DE', location='Deutschland', maxItems=50),
    dict(position='food director',               country='DE', location='Deutschland', maxItems=50),
    dict(position='Managing Director food',      country='DE', location='Deutschland', maxItems=50),
    # FR
    dict(position='directeur general agroalimentaire', country='FR', location='France', maxItems=50),
    dict(position='DRH agroalimentaire',               country='FR', location='France', maxItems=50),
    dict(position='directeur usine agroalimentaire',   country='FR', location='France', maxItems=50),
    dict(position='directeur commercial food',         country='FR', location='France', maxItems=50),
    # NL
    dict(position='directeur voedingsmiddelen',  country='NL', location='Nederland', maxItems=50),
    dict(position='HR directeur food',           country='NL', location='Nederland', maxItems=50),
    dict(position='food director',               country='NL', location='Nederland', maxItems=50),
    # BE
    dict(position='directeur alimentaire',       country='BE', location='Belgique',   maxItems=50),
    dict(position='food director',               country='BE', location='Belgium',    maxItems=50),
]

# ── Run all queries ───────────────────────────────────────────────────────────
print(f'\n{"="*60}\nSTEP 1: Running {len(QUERIES)} Indeed queries\n{"="*60}')
all_jobs = []
seen_ids = set()
for q in QUERIES:
    label = f'indeed_{q["country"]}_{q["position"][:30]}'
    print(f'\n[{q["country"]}] {q["position"][:45]}...')
    jobs = apify_run(q, label)
    for j in jobs:
        jid = j.get('id') or j.get('url', '')
        if jid not in seen_ids:
            seen_ids.add(jid)
            j['_query_country'] = q['country']
            all_jobs.append(j)
    time.sleep(2)

print(f'\nTotal unique jobs: {len(all_jobs)}')

# ── Step 2: Filter exec + food ────────────────────────────────────────────────
print(f'\n{"="*60}\nSTEP 2: Filter exec + food industry\n{"="*60}')
filtered = []
for j in all_jobs:
    title = j.get('positionName') or j.get('title') or ''
    desc  = j.get('description') or ''
    if is_exec(title) and is_food(title, desc):
        filtered.append(j)

print(f'After exec+food filter: {len(filtered)} / {len(all_jobs)}')

# ── Step 3: Parse dates + stale detection ─────────────────────────────────────
print(f'\n{"="*60}\nSTEP 3: Date parsing + stale detection\n{"="*60}')
now = datetime.now(timezone.utc)
for j in filtered:
    raw = j.get('postingDateParsed') or j.get('postedAt') or ''
    days = None
    if raw and len(raw) >= 10:
        try:
            dt = datetime.fromisoformat(raw[:19].replace('Z','+00:00'))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            days = (now - dt).days
        except: pass
    j['_days_old'] = days
    j['_signal_type'] = 'stale_60d' if days and days >= 60 else ('fresh_14d' if days and days <= 14 else 'active')

stale = [j for j in filtered if j['_signal_type'] == 'stale_60d']
fresh = [j for j in filtered if j['_signal_type'] == 'fresh_14d']
print(f'Fresh (<=14d): {len(fresh)} | Stale (>=60d): {len(stale)} | Active: {len(filtered)-len(fresh)-len(stale)}')

# ── Step 4: Fuzzy match vs companies_pass.csv ────────────────────────────────
print(f'\n{"="*60}\nSTEP 4: Company matching vs target database\n{"="*60}')
matched, unmatched = [], []
for j in filtered:
    company_raw = j.get('company') or ''
    m, score = fuzzy_match(company_raw)
    j['_company_match'] = m
    j['_match_score']   = score
    if m:
        j['_company_data'] = company_by_name.get(m, {})
        matched.append(j)
    else:
        unmatched.append(j)

print(f'Matched in database: {len(matched)} | Not in database: {len(unmatched)}')

# ── Step 5: Find contacts for matched companies ────────────────────────────────
print(f'\n{"="*60}\nSTEP 5: Contact lookup for matched companies\n{"="*60}')

def get_contacts_for(company_data):
    domain = (company_data.get('domain') or '').strip().lower()
    if domain and domain in existing_contacts:
        return existing_contacts[domain]
    return []

for j in matched:
    j['_contacts'] = get_contacts_for(j.get('_company_data', {}))

with_contact    = [j for j in matched if j['_contacts']]
without_contact = [j for j in matched if not j['_contacts']]
print(f'Matched + contact found: {len(with_contact)} | Matched + no contact: {len(without_contact)}')

# ── Step 6: Exa lookup for unmatched + matched-no-contact ─────────────────────
print(f'\n{"="*60}\nSTEP 6: Exa enrichment for unknowns + missing contacts\n{"="*60}')

to_enrich = unmatched + without_contact

def exa_search(query, label):
    ck = f'exa_{label}'
    if ck in cache: return cache[ck]
    body = {'query': query, 'numResults': 3, 'type': 'keyword',
            'includeDomains': ['linkedin.com'],
            'contents': {'text': {'maxCharacters': 200}}}
    req = urllib.request.Request('https://api.exa.ai/search',
          json.dumps(body).encode(),
          headers={'x-api-key': EXA_KEY, 'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            results = json.loads(r.read()).get('results', [])
        li_url = next((r['url'] for r in results if 'linkedin.com/company' in r.get('url','')), '')
        cache[ck] = li_url
        save_cache()
        time.sleep(0.3)
        return li_url
    except: return ''

SMALL_CASCADE = [
    {'include_title': ['CEO','Founder','Owner','Managing Director','Geschaeftsfuehrer',
                       'Directeur General','Directeur Executif','Gerant'],
     'exclude_title': ['Assistant','Intern'], 'location': ['WORLD']},
    {'include_title': ['HR Director','Head of HR','HR Manager','DRH','Head of People',
                       'VP People','People Director','Personalleiter'],
     'exclude_title': ['Assistant'], 'location': ['WORLD']},
    {'include_title': ['COO','VP Operations','Director Operations'],
     'exclude_title': ['Assistant'], 'location': ['WORLD']},
]
LARGE_CASCADE = [
    {'include_title': ['HR Director','Head of HR','DRH','People Director','VP People',
                       'VP HR','Chief People Officer','Personalleiter'],
     'exclude_title': ['Assistant','Intern'], 'location': ['WORLD']},
    {'include_title': ['CEO','Managing Director','General Manager',
                       'Directeur General','Geschaeftsfuehrer'],
     'exclude_title': ['Assistant'], 'location': ['WORLD']},
]

def blitz_contacts(li_url, size):
    ck = f'blitz2_{li_url}'
    if ck in cache: return cache[ck]
    employees = int(re.sub(r'\D','', str(size).split('-')[-1] or '0') or 0)
    cascade = SMALL_CASCADE if employees < 500 else LARGE_CASCADE
    body = {'company_linkedin_url': li_url, 'cascade': cascade, 'max_results': 2}
    req = urllib.request.Request(
        'https://api.blitz-api.ai/v2/search/waterfall-icp-keyword',
        json.dumps(body).encode(),
        headers={'x-api-key': BLITZ_KEY, 'Content-Type': 'application/json'},
        method='POST')
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read())
        contacts = data.get('contacts') or data.get('data') or data.get('results') or []
        cache[ck] = contacts
        save_cache()
        time.sleep(0.5)
        return contacts
    except Exception as e:
        print(f'[blitz err: {e}]', end=' ')
        return []

enriched_new = 0
for j in to_enrich[:20]:  # cap at 20 to control cost
    company_raw = j.get('company') or ''
    country     = j.get('_query_country') or j.get('location','')[:2]
    print(f'  Enriching: {company_raw[:40]}...', end=' ', flush=True)

    li_url = exa_search(f'{company_raw} {country} site:linkedin.com/company', company_raw[:20])
    if not li_url:
        print('no LinkedIn found')
        j['_contacts'] = []
        continue

    size = j.get('_company_data', {}).get('size') or '51-200'
    contacts = blitz_contacts(li_url, size)
    j['_contacts']    = contacts
    j['_linkedin_url'] = li_url
    if contacts:
        enriched_new += 1
        print(f'found {len(contacts)} contacts')
    else:
        print('no contacts')

print(f'\nNewly enriched: {enriched_new}')

# ── Step 7: Assemble final output ─────────────────────────────────────────────
print(f'\n{"="*60}\nSTEP 7: Building enriched output\n{"="*60}')

rows = []
all_final = matched + [j for j in unmatched if j.get('_contacts')]

for j in all_final:
    contacts = j.get('_contacts') or []
    company_data = j.get('_company_data') or {}
    li_url  = j.get('_linkedin_url') or company_data.get('linkedin_url') or ''
    domain  = company_data.get('domain') or ''
    size    = company_data.get('size') or ''
    country = company_data.get('hq_country_code') or j.get('_query_country') or ''

    base = {
        'company_raw':      j.get('company',''),
        'company_match':    j.get('_company_match') or j.get('company',''),
        'company_linkedin': li_url,
        'domain':           domain,
        'hq_country':       country,
        'company_size':     size,
        'job_title_posted': j.get('positionName',''),
        'days_open':        j.get('_days_old',''),
        'signal_type':      j.get('_signal_type',''),
        'pub_date':         (j.get('postingDateParsed') or j.get('postedAt',''))[:10],
        'job_url':          j.get('url',''),
        'match_score':      j.get('_match_score',''),
        'in_our_db':        'yes' if j.get('_company_match') else 'no',
    }

    if contacts:
        for c in contacts[:2]:  # max 2 contacts per company
            row = dict(base)
            row['contact_name']     = (c.get('full_name') or c.get('name') or
                                       f"{c.get('first_name','')} {c.get('last_name','')}").strip()
            row['contact_title']    = c.get('job_title') or c.get('title') or ''
            row['contact_linkedin'] = c.get('person_linkedin_url') or c.get('linkedin_url') or ''
            row['contact_email']    = c.get('email') or ''
            row['email_status']     = c.get('mails_result') or c.get('email_status') or ''
            rows.append(row)
    else:
        row = dict(base)
        row.update(contact_name='', contact_title='', contact_linkedin='',
                   contact_email='', email_status='')
        rows.append(row)

# Sort: stale first, then fresh, then active; within each: by days_open desc
def sort_key(r):
    order = {'stale_60d': 0, 'fresh_14d': 1, 'active': 2}
    days = int(r['days_open']) if str(r['days_open']).isdigit() else 0
    return (order.get(r['signal_type'], 3), -days)

rows.sort(key=sort_key)

FIELDS = ['signal_type','days_open','pub_date','company_match','company_raw',
          'hq_country','company_size','domain','company_linkedin',
          'job_title_posted','job_url','match_score','in_our_db',
          'contact_name','contact_title','contact_linkedin','contact_email','email_status']

with open(FINAL_CSV, 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, fieldnames=FIELDS)
    w.writeheader()
    w.writerows(rows)

# ── Summary ───────────────────────────────────────────────────────────────────
print(f'\n{"="*60}')
print(f'FINAL RESULT: {len(rows)} rows → {FINAL_CSV.name}')
print(f'{"="*60}')
print(f'Companies with contacts: {len([r for r in rows if r["contact_email"] or r["contact_linkedin"]])}')
print(f'With email:              {len([r for r in rows if r["contact_email"]])}')
print(f'Stale 60+d signals:      {len([r for r in rows if r["signal_type"]=="stale_60d"])}')
print(f'Fresh <=14d signals:     {len([r for r in rows if r["signal_type"]=="fresh_14d"])}')
print(f'\nTop signals:')
for r in rows[:12]:
    contact = r["contact_name"][:25] if r["contact_name"] else "NO CONTACT"
    print(f'  [{r["signal_type"][:7]} {r["days_open"]}d] {r["company_match"][:30]} | {r["job_title_posted"][:35]} | {contact}')
