"""
Collect and analyze results from the full 33-monitor run.
Reads monitor IDs from monitor_ids.json, fetches results from webhook.site.
"""
import urllib.request, urllib.error, json, sys, pathlib
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT    = pathlib.Path('C:/Users/79818/Desktop/Mastr_Leads')
SIGNALS = ROOT / 'clients/philippe-bosquillon/signals'

ids_file = SIGNALS / 'tests/monitor_ids.json'
id_data  = json.loads(ids_file.read_text('utf-8'))
WH_TOKEN    = id_data['webhook_token']
monitor_ids = id_data['all_monitors']  # label -> mid

print(f'Webhook token: {WH_TOKEN}')
print(f'Monitors: {len(monitor_ids)}')

# Fetch from webhook.site with pagination
def fetch_wh_page(page=1, per_page=50):
    url = f'https://webhook.site/token/{WH_TOKEN}/requests?per_page={per_page}&page={page}'
    req = urllib.request.Request(url, headers={'Accept': 'application/json'}, method='GET')
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f'  WH fetch page {page} error {e.code}')
        return {'data': [], 'total': 0}

all_items = []
page = 1
while True:
    d = fetch_wh_page(page=page, per_page=50)
    items = d.get('data', [])
    all_items.extend(items)
    total = d.get('total', 0) or d.get('pagination', {}).get('total', 0)
    print(f'  Page {page}: {len(items)} items (total={total})')
    if len(items) < 50 or len(all_items) >= max(total, 1):
        break
    page += 1

print(f'Total webhook items: {len(all_items)}')

# Parse payloads
mid_to_label = {v: k for k, v in monitor_ids.items()}
monitor_results = {label: {'results': [], 'summary': ''} for label in monitor_ids}
completed = 0
event_types = {}
for item in all_items:
    body = item.get('content', '')
    try:
        p    = json.loads(body)
        etype = p.get('type', '?')
        event_types[etype] = event_types.get(etype, 0) + 1
        if etype == 'monitor.run.completed':
            d   = p.get('data', {})
            mid = d.get('monitorId', '')
            lb  = mid_to_label.get(mid, '')
            if lb:
                out = d.get('output', {})
                monitor_results[lb]['results'] = out.get('results', [])
                monitor_results[lb]['summary'] = out.get('content', '')
                completed += 1
    except Exception:
        pass

print(f'Event types: {event_types}')
print(f'Completed runs matched: {completed}/{len(monitor_ids)}')

# Load S1 ground truth
cache = json.loads((SIGNALS / 'tests/exa_cache.json').read_text('utf-8'))
S1_URLS = set()
for key, val in cache.items():
    rows = val.get('rows', []) if isinstance(val, dict) else val
    for r in rows:
        if isinstance(r, dict):
            S1_URLS.add(r.get('url', ''))

S1_TAM_FOUND_ORIG = {
    'ritter sport', 'vion food', 'solina', 'planet a foods',
    'orangeworks', 'lotus bakeries', 'carbios', 'berief', 'pere olive'
}
TAM = S1_TAM_FOUND_ORIG | {
    'frieslandcampina', 'malteurop', 'ardo', 'royal a-ware', 'florette',
    'berentzen', 'lantmannen', 'kipster', 'emmi', 'maasoever', 'cono',
    'melitta', 'van vugt', 'dmk', 'lotus'
}
NOISE_KWORDS = [
    'healthcare partner', 'world cargo', 'sanotact', 'chaincraft',
    'pharmaceutical', 'real estate', 'software company', 'tech startup',
    'shipping container', 'fintech', 'bank acqui', 'insurance',
]

ALL_QUERIES = [
    ('MA|DE',              'food manufacturing Germany acquisition merger takeover'),
    ('MA|FR',              'food industry France acquisition merger takeover'),
    ('MA|NL',              'food production Netherlands acquisition merger'),
    ('MA|BE',              'food company Belgium acquisition merger'),
    ('MA|CH',              'food company Switzerland acquisition merger'),
    ('MA|EU',              'FMCG food Europe acquisition merger deal 2026'),
    ('CLEVEL|DE',          'food company Germany new CEO appointed HR Director COO'),
    ('CLEVEL|FR',          'food company France new CEO appointed HR Director'),
    ('CLEVEL|NL',          'food company Netherlands new managing director appointed'),
    ('CLEVEL|BE',          'food company Belgium new CEO director appointed'),
    ('CLEVEL|DE7',         'FMCG food Germany leadership change new director'),
    ('CLEVEL|FR7',         'FMCG food France leadership change new director'),
    ('EXPAND|DE',          'food manufacturer Germany new factory plant facility expansion'),
    ('EXPAND|FR',          'food manufacturer France new facility plant expansion'),
    ('EXPAND|NL',          'food production Netherlands new facility expansion site'),
    ('EXPAND|BE',          'food company Belgium new production facility expansion'),
    ('EXPAND|EU',          'food industry Europe new plant production capacity expansion 2026'),
    ('INVEST|DE',          'food company Germany investment funding raised capital'),
    ('INVEST|FR',          'food startup France investment funding raised'),
    ('INVEST|EU',          'food ingredients FMCG Europe investment funding 2026'),
    ('CONTRACT|DE',        'food manufacturer Germany major contract partnership signed'),
    ('CONTRACT|FR',        'food company France contract partnership agreement signed'),
    ('NICHE|FN-DEFRBE',    'site:foodnavigator.com Germany France Belgium acquisition expansion CEO'),
    ('NICHE|FN-NL',        'site:foodnavigator.com Netherlands Switzerland Austria food 2026'),
    ('NICHE|FOODBEV',      'site:foodbev.com Europe food acquisition expansion leadership 2026'),
    ('NICHE|JUST-FOOD',    'site:just-food.com Germany France acquisition merger 2026'),
    ('NICHE|BAKINGBISCUIT','site:bakingbiscuit.com Germany France Netherlands acquisition director'),
    ('NICHE|DAIRYREPORTER','site:dairyreporter.com Germany France Netherlands 2026'),
    ('SECTOR|DAIRY-DE',    'dairy company Germany acquisition expansion new facility'),
    ('SECTOR|BAKERY-EU',   'bakery company Germany France Belgium acquisition expansion 2026'),
    ('SECTOR|INGREDIENTS', 'food ingredients Europe acquisition expansion Germany France'),
    ('SECTOR|MEAT-DE',     'meat processing Germany new facility acquisition expansion'),
    ('SECTOR|BEVERAGE-DE', 'beverage company Germany France acquisition new facility CEO'),
]

lines = []
def out(s=''):
    lines.append(s)
    print(s)

out()
out('='*72)
out('EXA MONITORS — FULL RUN: ALL 33 QUERIES')
out(f'Date: {datetime.now().strftime("%Y-%m-%d %H:%M")}')
out(f'vs Session 1 (2026-05-29, 138 URLs, $0.231)')
out('='*72)
out()

totals = {'results': 0, 'new': 0, 's1': 0, 'noise': 0, 'tam': 0}
monitor_details = []
new_tam_found = set()
s1_tam_found  = set()

for label, query in ALL_QUERIES:
    md      = monitor_results.get(label, {})
    results = md.get('results', [])
    summary = md.get('summary', '')
    qtype   = label.split('|')[0]
    is_site = query.startswith('site:')

    score = row_new = row_s1 = row_noise = row_tam = 0

    for r in results:
        url   = r.get('url', '')
        title = r.get('title', '').lower()
        s1    = url in S1_URLS
        tam   = any(c in title for c in TAM)
        noise = any(n in title for n in NOISE_KWORDS)

        totals['results'] += 1
        if s1:
            row_s1    += 1; totals['s1']    += 1
            if tam: s1_tam_found.add(next((c for c in TAM if c in title), ''))
        elif noise:
            row_noise += 1; totals['noise'] += 1; score -= 1
        else:
            row_new   += 1; totals['new']   += 1; score += 1
            if tam: new_tam_found.add(next((c for c in TAM if c in title), ''))
        if tam:
            row_tam += 1; totals['tam'] += 1
            if not noise: score += 3

    monitor_details.append({
        'label': label, 'query': query, 'qtype': qtype,
        'n': len(results), 'new': row_new, 's1': row_s1,
        'noise': row_noise, 'tam': row_tam, 'score': score,
        'summary': summary, 'results': results,
        'is_site': is_site, 'mid': monitor_ids.get(label, ''),
    })

monitor_details.sort(key=lambda x: x['score'], reverse=True)

# Per-monitor output
out('RESULTS PER MONITOR (by score):')
out('-'*72)
for d in monitor_details:
    verdict = ('KEEP'   if d['score'] >= 2 else
               'TRIM'   if d['score'] >= 0 else
               'DELETE')
    site_note = ' [site: query]' if d['is_site'] else ''
    fired = 'OK' if d['n'] > 0 else ('no results' if monitor_ids.get(d['label']) else 'no id')
    out(f"  [{verdict}][{d['label']:22s}] score={d['score']:+d} | "
        f"{d['n']}res {d['new']}new/{d['s1']}S1/{d['noise']}noise/{d['tam']}TAM "
        f"| {fired}{site_note}")
    for r in d['results'][:4]:
        url   = r.get('url', '')
        title = r.get('title', '')
        pub   = r.get('publishedDate', '')[:10]
        s1f   = '[S1] ' if url in S1_URLS else '[NEW]'
        tamf  = '[TAM]' if any(c in title.lower() for c in TAM) else '     '
        out(f'       [{pub}]{s1f}{tamf} {title[:68]}')
    if d['summary']:
        out(f"       SUM: {d['summary'][:160]}")
    out()

# TAM recall
out('='*72)
out('TAM RECALL vs Session 1:')
for co in sorted(S1_TAM_FOUND_ORIG):
    tag = 'NEW' if co in new_tam_found else ('S1' if co in s1_tam_found else 'MISSED')
    out(f"  [{tag:6s}] {co}")
if new_tam_found - S1_TAM_FOUND_ORIG:
    out(f"  BONUS new TAM companies: {new_tam_found - S1_TAM_FOUND_ORIG}")
out()

# Aggregate
out('='*72)
out('AGGREGATE:')
out(f"  {len(monitor_details)} monitors | {completed} completed | {totals['results']} total results")
out(f"  NEW    : {totals['new']} ({totals['new']*100//max(1,totals['results'])}%)")
out(f"  S1 dup : {totals['s1']} ({totals['s1']*100//max(1,totals['results'])}%)")
out(f"  Noise  : {totals['noise']} ({totals['noise']*100//max(1,totals['results'])}%)")
out(f"  TAM    : {totals['tam']} hits")
out()

# Keep/Trim/Delete lists
keep   = [d for d in monitor_details if d['score'] >= 2]
trim   = [d for d in monitor_details if 0 <= d['score'] < 2]
delete = [d for d in monitor_details if d['score'] < 0]

out('='*72)
out('FINAL RECOMMENDATIONS:')
out()
out(f"KEEP {len(keep)} — run weekly:")
for d in keep:
    out(f"  score={d['score']:+d}  {d['label']:22s}  {d['query'][:52]}")
out()
out(f"TRIM {len(trim)} — run monthly (or keep if budget allows):")
for d in trim:
    out(f"  score={d['score']:+d}  {d['label']:22s}  {d['query'][:52]}")
out()
out(f"DELETE {len(delete)} — noise, not worth running:")
for d in delete:
    out(f"  score={d['score']:+d}  {d['label']:22s}  {d['query'][:52]}")
out()

# Cost
wk_keep  = len(keep)  * 0.015
mo_trim  = len(trim)  * 0.015
mo_total = wk_keep * 4.33 + mo_trim
out('COST:')
out(f"  {len(keep)} KEEP weekly:   ${wk_keep:.3f}/wk = ${wk_keep*4.33:.2f}/mo")
out(f"  {len(trim)} TRIM monthly:  ${mo_trim:.3f}/mo")
out(f"  Total:          ${mo_total:.2f}/mo")
out(f"  vs manual S1:   $0.231 one-off / ${33*0.007*4.33:.2f}/mo if run weekly via Search")
out(f"  vs Monitors all: ${33*0.015*4.33:.2f}/mo if all 33 run weekly")
out()
out(f"  Cost per result: Search ${0.231/138:.4f} | Monitors ${completed*0.015/max(1,totals['results']):.4f}")
out(f"  Monitors include AI synthesis → effective cost/insight lower than ratio suggests")

# Save
outfile = SIGNALS / f'tests/full_run_{datetime.now().strftime("%Y%m%d_%H%M")}.txt'
outfile.write_text('\n'.join(lines), encoding='utf-8')

# Update monitor_ids with recommendations
id_data['keep']   = [d['label'] for d in keep]
id_data['trim']   = [d['label'] for d in trim]
id_data['delete'] = [d['label'] for d in delete]
ids_file.write_text(json.dumps(id_data, indent=2, ensure_ascii=False), encoding='utf-8')

print(f'\nSaved: {outfile}')
