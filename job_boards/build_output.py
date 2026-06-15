"""
Build final enriched output from cached pipeline data.
Fixes: Blitz person wrapper, adds email enrichment, ICP post-filter.
"""
import json, csv, sys, re, time, urllib.request
from pathlib import Path
from datetime import datetime, timezone
from difflib import SequenceMatcher

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT  = Path('C:/Users/79818/Desktop/Mastr_Leads')
CDIR  = ROOT / 'clients/philippe-bosquillon'
ENV   = {k.strip(): v.strip() for line in (ROOT/'.env').read_text('utf-8').splitlines()
         if '=' in line and not line.strip().startswith('#')
         for k, _, v in [line.partition('=')]}
BLITZ_KEY = next((l.split('=',1)[1].strip() for l in (ROOT/'blitz/.env').read_text('utf-8').splitlines()
                  if l.startswith('BLITZ_API_KEY')), '')

CACHE_F  = CDIR / 'signals/job_boards/pipeline_cache.json'
OUT_CSV  = CDIR / 'signals/job_boards/job_signals_enriched.csv'
COMP_CSV = CDIR / '1_filtering/companies_pass.csv'
CON1     = CDIR / '3_contacts/contacts_new_raw.csv'
CON2     = CDIR / '3_contacts/contacts_ef_raw.csv'

cache = json.loads(CACHE_F.read_text('utf-8'))

# ── Load companies ────────────────────────────────────────────────────────────
with open(COMP_CSV, encoding='utf-8') as f:
    companies = list(csv.DictReader(f))

def _norm(n):
    return re.sub(r'\b(gmbh|bv|b\.v\.|nv|sa|sas|ag|ltd|inc|group|groep|gruppe|holding|'
                  r'foods?|france|deutschland|netherlands|belgique|belgie|europe)\b', '',
                  n.lower()).strip(' -–.,')

comp_raw  = [c['name'].strip() for c in companies]
comp_norm = [_norm(n) for n in comp_raw]
comp_map  = {n: c for n, c in zip(comp_raw, companies)}

def fuzzy(raw, thr=0.75):
    c = _norm(raw)
    if len(c) < 3: return None, 0.0
    best, idx = 0.0, -1
    for i, cn in enumerate(comp_norm):
        if not cn: continue
        s = SequenceMatcher(None, c, cn).ratio()
        if s > best: best, idx = s, i
    return (comp_raw[idx], round(best,2)) if best >= thr and idx >= 0 else (None, round(best,2))

# ── Load existing contacts by domain ─────────────────────────────────────────
existing = {}
for p in [CON1, CON2]:
    if not p.exists(): continue
    for r in csv.DictReader(open(p, encoding='utf-8')):
        d = (r.get('domain') or '').strip().lower()
        if d: existing.setdefault(d, []).append(r)

# ── Filters ───────────────────────────────────────────────────────────────────
EXEC_RE = re.compile(
    r'(CEO|CFO|COO|Managing Director|General Manager|Country Manager'
    r'|Gesch.{1,4}ftsf.{1,4}hrer|Directeur G.n.ral|Directeur Ex.cutif|DG\b|PDG\b'
    r'|HR Director|Chief People|Head of HR|Personalleiter|DRH\b|Directeur RH|HR Directeur'
    r'|Operations Director|Betriebsleiter|Werksleiter|Directeur d.{1,6}[Uu]sine|Plant Manager'
    r'|Fabrieksdirecteur|Operationeel Directeur|Directeur [Oo]p.rations'
    r'|Commercial Director|Sales Director|Vertriebsleiter|Directeur [Cc]ommercial'
    r'|Supply Chain Director|VP |Vice President|Regional Director)',
    re.IGNORECASE
)
# Stricter food filter — must match in company name OR job title, not just description
FOOD_TITLE_RE = re.compile(
    r'(Lebensmittel|agroalimentaire|voedingsmiddelen|voedsel|levensmiddelen|alimentaire'
    r'|food|FMCG|Ern.{1,4}hrung|Nahrungsmittel|Getr.{1,3}nk|boisson|ingredient'
    r'|dairy|milch|zuivel|lait|boulangerie|backware|fromagerie|fleisch|viande|vlees'
    r'|kaas|fromage|cheese|chocolat|confectionery|bakery|S.{1,3}waren|zucker|sucre'
    r'|snack|beverage|brasserie|brouwerij|brauerei|agricole|agribusiness|harvest'
    r'|meat|poultry|gefl.{1,3}gel|fish|seafood|fisch|frozen food|surgelé|diepvries'
    r'|malt|malz|grain|graan|cereal|milling|meunerie|molen)',
    re.IGNORECASE
)
# Companies to skip — not food ICP
SKIP = re.compile(
    r'(hotel|restaurant|cleaning|reinigung|nettoyage|schoonmaak|consulting|conseil|beratung'
    r'|talentup|staffing|recruitment|recrutement|marktforschung|market research'
    r'|alvarez|marsal|wisag|nobu|okura|scalers|windesign|hey holy|delphi hrc'
    r'|ortec|metallurg)',
    re.IGNORECASE
)

# ── Collect all Indeed jobs from cache ────────────────────────────────────────
seen, all_jobs = set(), []
for k, items in cache.get('runs', {}).items():
    if not isinstance(items, list): continue
    country = k.split('_')[1] if '_' in k else ''
    for j in items:
        uid = j.get('id') or j.get('url','')
        if uid in seen: continue
        seen.add(uid)
        j['_country'] = country
        all_jobs.append(j)

print(f'Cached jobs: {len(all_jobs)}')

# ── Filter ────────────────────────────────────────────────────────────────────
now = datetime.now(timezone.utc)
filtered = []
for j in all_jobs:
    title   = j.get('positionName') or j.get('title') or ''
    company = j.get('company') or ''
    desc    = (j.get('description') or '')[:600]

    if not EXEC_RE.search(title): continue
    if SKIP.search(company): continue
    # Include if: food keyword in title/company OR company matches our food ICP database
    in_db, _ = fuzzy(company)
    if not (FOOD_TITLE_RE.search(title) or FOOD_TITLE_RE.search(company) or in_db):
        continue
    # Skip non-exec hospital kitchen roles
    if re.search(r'[Kk].{1,3}chen|hospital|kranken', title): continue

    raw = j.get('postingDateParsed') or j.get('postedAt') or ''
    days = None
    if raw:
        try:
            dt = datetime.fromisoformat(raw[:19].replace('Z','+00:00'))
            if not dt.tzinfo: dt = dt.replace(tzinfo=timezone.utc)
            days = (now - dt).days
        except: pass
    j['_days'] = days
    j['_sig']  = 'stale_60d' if days and days>=60 else ('fresh_14d' if days and days<=14 else 'active')
    filtered.append(j)

print(f'After strict filter: {len(filtered)}')
for j in filtered:
    print(f'  [{j["_sig"]} {j["_days"]}d] {j.get("company","")} — {j.get("positionName","")[:55]}')

# ── Match + enrich ────────────────────────────────────────────────────────────
def get_blitz_person(entry):
    """Extract person dict from Blitz response (handles {icp, ranking, person} wrapper)."""
    if isinstance(entry, dict):
        return entry.get('person') or entry
    return {}

def get_email(person_li):
    ck = f'email_{person_li}'
    if ck in cache: return cache[ck]
    body = {'person_linkedin_url': person_li}
    req = urllib.request.Request('https://api.blitz-api.ai/v2/enrichment/email',
          json.dumps(body).encode(),
          headers={'x-api-key': BLITZ_KEY, 'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            data = json.loads(r.read())
        result = {'email': data.get('email',''), 'status': data.get('status',''),
                  'score': data.get('score','')}
        cache[ck] = result
        time.sleep(0.3)
        return result
    except: return {}

rows = []
for j in filtered:
    company_raw = j.get('company','')
    country     = j.get('_country','')

    # 1. Fuzzy match vs database
    match, score = fuzzy(company_raw)
    comp_data    = comp_map.get(match, {}) if match else {}
    domain       = comp_data.get('domain','')
    li_url       = comp_data.get('linkedin_url','')
    size         = comp_data.get('size','')

    # 2. Get contacts from cache (Blitz or existing)
    contacts = []
    if domain and domain in existing:
        contacts = existing[domain][:2]
        for c in contacts:
            c['_source'] = 'existing'
    else:
        # Look up Blitz cache by LinkedIn URL
        blitz_ck = f'blitz2_{li_url}'
        if blitz_ck in cache and cache[blitz_ck]:
            raw_contacts = cache[blitz_ck]
            for entry in raw_contacts[:2]:
                p = get_blitz_person(entry)
                contacts.append({
                    'full_name':            p.get('full_name',''),
                    'job_title':            p.get('headline','') or p.get('job_title',''),
                    'person_linkedin_url':  p.get('linkedin_url',''),
                    'email':                '',
                    '_source':              'blitz_new'
                })
        # Also check by company name in exa cache
        exa_ck = f'exa_{company_raw[:20]}'
        if not contacts and exa_ck in cache and cache[exa_ck]:
            found_li = cache[exa_ck]
            blitz_ck2 = f'blitz2_{found_li}'
            if blitz_ck2 in cache and cache[blitz_ck2]:
                for entry in cache[blitz_ck2][:2]:
                    p = get_blitz_person(entry)
                    contacts.append({
                        'full_name':           p.get('full_name',''),
                        'job_title':           p.get('headline','') or p.get('job_title',''),
                        'person_linkedin_url': p.get('linkedin_url',''),
                        'email':               '',
                        '_source':             'blitz_exa'
                    })
            if not li_url: li_url = found_li

    # 3. Email enrichment for contacts without email
    for c in contacts:
        if not c.get('email') and c.get('person_linkedin_url'):
            print(f'  Getting email for {c.get("full_name","")} at {company_raw}...', end=' ', flush=True)
            em = get_email(c['person_linkedin_url'])
            c['email']        = em.get('email','')
            c['email_status'] = em.get('status','')
            c['email_score']  = em.get('score','')
            print(f'{c["email"] or "not found"}')

    # 4. Build output rows
    base = {
        'signal_type':      j['_sig'],
        'days_open':        j['_days'] or '',
        'pub_date':         (j.get('postingDateParsed') or j.get('postedAt',''))[:10],
        'company_name':     company_raw,
        'company_in_db':    'yes' if match else 'no',
        'db_match':         match or '',
        'match_score':      score,
        'hq_country':       country,
        'company_size':     size,
        'domain':           domain,
        'company_linkedin': li_url,
        'job_title_posted': j.get('positionName',''),
        'job_url':          j.get('url',''),
    }

    if contacts:
        for c in contacts:
            row = dict(base)
            row['contact_name']     = c.get('full_name','')
            row['contact_title']    = c.get('job_title','') or c.get('title','')
            row['contact_linkedin'] = c.get('person_linkedin_url','') or c.get('linkedin_url','')
            row['contact_email']    = c.get('email','')
            row['email_status']     = c.get('email_status','') or c.get('mails_result','')
            row['contact_source']   = c.get('_source','')
            rows.append(row)
    else:
        row = dict(base)
        row.update(contact_name='', contact_title='', contact_linkedin='',
                   contact_email='', email_status='', contact_source='')
        rows.append(row)

# Sort: stale first → days desc
rows.sort(key=lambda r: ({'stale_60d':0,'fresh_14d':1,'active':2}.get(r['signal_type'],3),
                          -(int(r['days_open']) if str(r['days_open']).isdigit() else 0)))

# Save cache
CACHE_F.write_text(json.dumps(cache, ensure_ascii=False, indent=2), 'utf-8')

FIELDS = ['signal_type','days_open','pub_date','company_name','company_in_db','db_match',
          'match_score','hq_country','company_size','domain','company_linkedin',
          'job_title_posted','job_url',
          'contact_name','contact_title','contact_linkedin','contact_email','email_status','contact_source']

with open(OUT_CSV, 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, fieldnames=FIELDS)
    w.writeheader()
    w.writerows(rows)

print(f'\n{"="*55}')
print(f'OUTPUT: {len(rows)} rows → {OUT_CSV.name}')
print(f'With contact:  {len([r for r in rows if r["contact_name"]])}')
print(f'With email:    {len([r for r in rows if r["contact_email"]])}')
print(f'Stale 60+d:    {len([r for r in rows if r["signal_type"]=="stale_60d"])}')
print(f'Fresh <=14d:   {len([r for r in rows if r["signal_type"]=="fresh_14d"])}')
print(f'\nFull list:')
for r in rows:
    em = r["contact_email"] or "no email"
    cn = r["contact_name"] or "NO CONTACT"
    print(f'  [{r["signal_type"][:7]} {r["days_open"]}d] {r["company_name"][:28]} | {r["job_title_posted"][:35]} | {cn[:25]} | {em}')
