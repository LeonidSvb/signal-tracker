"""
Run all 33 Session 1 queries via Exa Search API today.
Date range: 2026-04-29 to today (same start as S1, but wider window = S1 + 4 new days).
Answers: same TAM hits? New signals since May 29?
Cost: 33 x $0.007 = $0.231 (same as Session 1)
"""
import urllib.request, urllib.error, json, sys, time, pathlib
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT    = pathlib.Path('C:/Users/79818/Desktop/Mastr_Leads')
SIGNALS = ROOT / 'clients/philippe-bosquillon/signals'
EXA_BASE = 'https://api.exa.ai'

ENV = {}
for line in (ROOT / '.env').read_text('utf-8').splitlines():
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, _, v = line.partition('=')
        ENV[k.strip()] = v.strip()
EXA_KEY = ENV.get('EXA_API_KEY', '')
HDRS = {'x-api-key': EXA_KEY, 'Content-Type': 'application/json'}

def exa_search(query, start_date='2026-04-29', num=5):
    body = {'query': query, 'numResults': num, 'startPublishedDate': start_date}
    req = urllib.request.Request(
        f'{EXA_BASE}/search', json.dumps(body).encode(),
        headers=HDRS, method='POST'
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read()).get('results', [])

cache = json.loads((SIGNALS / 'tests/exa_cache.json').read_text('utf-8'))
S1_URLS = set()
S1_BY_KEY = {}
for key, val in cache.items():
    rows = val.get('rows', []) if isinstance(val, dict) else val
    S1_BY_KEY[key] = set()
    for r in rows:
        if isinstance(r, dict):
            u = r.get('url', '')
            S1_URLS.add(u)
            S1_BY_KEY[key].add(u)

TAM_S1 = {
    'ritter sport', 'vion food', 'solina', 'planet a foods',
    'orangeworks', 'lotus', 'carbios', 'berief', 'pere olive'
}
TAM_ALL = TAM_S1 | {
    'frieslandcampina', 'malteurop', 'ardo', 'royal a-ware', 'florette',
    'berentzen', 'lantmannen', 'kipster', 'emmi', 'maasoever', 'cono',
    'melitta', 'van vugt', 'dmk'
}
NOISE_KW = [
    'healthcare partner', 'sanotact', 'pharmaceutical', 'real estate',
    'software company', 'fintech', 'semiconductor', 'automotive',
    'shipping container', 'bank acqui'
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

print(f'Running {len(ALL_QUERIES)} queries (same as Session 1, date 2026-04-29 to today)...')
all_results = {}
total_cost  = 0.0
for label, query in ALL_QUERIES:
    try:
        results = exa_search(query, num=5)
        all_results[label] = results
        total_cost += 0.007
        n_new = sum(1 for r in results if r.get('url','') not in S1_URLS)
        print(f'  [{label}] {len(results)} results ({n_new} new)')
        time.sleep(0.15)
    except urllib.error.HTTPError as e:
        err = e.read().decode('utf-8', errors='replace')[:100]
        print(f'  [{label}] HTTP {e.code}: {err}')
        all_results[label] = []
    except Exception as e:
        print(f'  [{label}] EXC: {e}')
        all_results[label] = []

print(f'\nDone. Est. cost: ${total_cost:.3f}')

lines = []
def out(s=''):
    lines.append(s)
    print(s)

out()
out('='*72)
out('EXA SEARCH — ALL 33 QUERIES RUN TODAY (same queries as Session 1)')
out(f'Date: {datetime.now().strftime("%Y-%m-%d %H:%M")}')
out(f'Date range: 2026-04-29 → today (S1 was 2026-04-29 → 2026-05-29)')
out(f'Cost: ${total_cost:.3f} (33 x $0.007)')
out('='*72)

totals = {'results': 0, 'new': 0, 's1': 0, 'noise': 0, 'tam': 0, 'new_after_s1': 0}
monitor_details = []
new_tam  = set()
s1_tam   = set()
new_after_s1_signals = []   # published after 2026-05-29

for label, query in ALL_QUERIES:
    results  = all_results.get(label, [])
    s1_key   = label.replace('|', '|')
    qtype    = label.split('|')[0]
    is_site  = query.startswith('site:')
    score = row_new = row_s1 = row_noise = row_tam = row_post = 0

    for r in results:
        url   = r.get('url', '')
        title = r.get('title', '').lower()
        pub   = r.get('publishedDate', '')[:10]
        s1    = url in S1_URLS
        tam   = any(c in title for c in TAM_ALL)
        noise = any(n in title for n in NOISE_KW)
        post  = pub >= '2026-05-29'   # published AFTER S1 run

        totals['results'] += 1
        if s1:
            row_s1    += 1; totals['s1']    += 1
            if tam: s1_tam.add(next((c for c in TAM_ALL if c in title), '?'))
        elif noise:
            row_noise += 1; totals['noise'] += 1; score -= 1
        else:
            row_new   += 1; totals['new']   += 1; score += 1
            if tam: new_tam.add(next((c for c in TAM_ALL if c in title), '?'))
        if post and not s1:
            row_post += 1; totals['new_after_s1'] += 1
            new_after_s1_signals.append((label, pub, title[:70], url))
        if tam and not noise:
            row_tam += 1; totals['tam'] += 1
            if not s1: score += 3

    monitor_details.append({
        'label': label, 'query': query, 'qtype': qtype,
        'n': len(results), 'new': row_new, 's1': row_s1,
        'noise': row_noise, 'tam': row_tam, 'post': row_post,
        'score': score, 'results': results, 'is_site': is_site,
    })

monitor_details.sort(key=lambda x: x['score'], reverse=True)

out()
out('RESULTS BY QUERY (sorted by score):')
out('-'*72)
for d in monitor_details:
    verdict = 'KEEP' if d['score'] >= 2 else ('TRIM' if d['score'] >= 0 else 'DEL')
    site_note = ' [site:]' if d['is_site'] else ''
    out(f"  [{verdict}][{d['label']:22s}] score={d['score']:+d} | "
        f"{d['n']}r {d['new']}new/{d['s1']}S1/{d['noise']}noise/{d['tam']}TAM "
        f"(+{d['post']} post-S1){site_note}")
    for r in d['results'][:4]:
        url   = r.get('url', '')
        title = r.get('title', '')
        pub   = r.get('publishedDate', '')[:10]
        s1f   = '[S1] ' if url in S1_URLS else '[NEW]'
        tamf  = '[TAM]' if any(c in title.lower() for c in TAM_ALL) else '     '
        postf = '[POST]' if pub >= '2026-05-29' else '      '
        out(f'       [{pub}]{s1f}{tamf}{postf} {title[:65]}')
    out()

# New signals since S1
out('='*72)
out(f'NEW SIGNALS SINCE SESSION 1 (published >= 2026-05-29): {len(new_after_s1_signals)}')
for label, pub, title, url in sorted(new_after_s1_signals, key=lambda x: x[1], reverse=True):
    tam_flag = ' [TAM]' if any(c in title for c in TAM_ALL) else ''
    out(f'  [{pub}][{label}]{tam_flag} {title}')
out()

# TAM recall
out('='*72)
out('TAM RECALL vs Session 1 (9 companies):')
for co in sorted(TAM_S1):
    tag = ('NEW  ' if co in new_tam - s1_tam
           else ('S1   ' if co in s1_tam
                 else 'MISS '))
    out(f'  [{tag}] {co}')
bonus = new_tam - TAM_S1
if bonus:
    out(f'  BONUS (new TAM companies not in S1): {bonus}')
out()

# By type
out('='*72)
out('BY SIGNAL TYPE:')
for qtype in ['MA', 'CLEVEL', 'EXPAND', 'INVEST', 'CONTRACT', 'NICHE', 'SECTOR']:
    grp = [d for d in monitor_details if d['qtype'] == qtype]
    out(f"  {qtype:12s}: {sum(d['n'] for d in grp)}r | "
        f"{sum(d['new'] for d in grp)}new / "
        f"{sum(d['s1'] for d in grp)}S1 / "
        f"{sum(d['noise'] for d in grp)}noise / "
        f"{sum(d['tam'] for d in grp)}TAM / "
        f"+{sum(d['post'] for d in grp)} post-S1")
out()

# Final stats
out('='*72)
out('AGGREGATE:')
out(f"  Total results : {totals['results']} (33 queries x up to 5)")
out(f"  NEW signals   : {totals['new']} ({totals['new']*100//max(1,totals['results'])}%)")
out(f"  S1 overlap    : {totals['s1']} ({totals['s1']*100//max(1,totals['results'])}%)")
out(f"  Noise         : {totals['noise']} ({totals['noise']*100//max(1,totals['results'])}%)")
out(f"  TAM hits      : {totals['tam']}")
out(f"  Post-S1 new   : {totals['new_after_s1']} (genuinely new since May 29)")
out()

keep   = [d for d in monitor_details if d['score'] >= 2]
trim   = [d for d in monitor_details if 0 <= d['score'] < 2]
delete = [d for d in monitor_details if d['score'] < 0]

out('='*72)
out('QUERY RECOMMENDATIONS (for Monitor production setup):')
out()
out(f'KEEP {len(keep)} — weekly monitors (high signal value):')
for d in keep:
    out(f'  {d["score"]:+d}  {d["label"]:22s}  {d["query"][:52]}')
out()
out(f'TRIM {len(trim)} — monthly monitors (low but useful):')
for d in trim:
    out(f'  {d["score"]:+d}  {d["label"]:22s}  {d["query"][:52]}')
out()
out(f'DELETE {len(delete)} — noise:')
for d in delete:
    out(f'  {d["score"]:+d}  {d["label"]:22s}  {d["query"][:52]}')
out()

wk = len(keep) * 0.015
mo_t = len(trim) * 0.015
out('COST (if these become weekly Monitors):')
out(f'  {len(keep)} KEEP weekly  : ${wk:.3f}/wk = ${wk*4.33:.2f}/mo')
out(f'  {len(trim)} TRIM monthly : ${mo_t:.3f}/mo')
out(f'  TOTAL            : ${wk*4.33+mo_t:.2f}/mo')
out()
out(f'vs manual Search same 33q weekly: ${33*0.007*4.33:.2f}/mo + manual effort')
out(f'vs Monitors all 33q weekly:       ${33*0.015*4.33:.2f}/mo fully automated + AI summaries')
out()
out(f'This run cost: ${total_cost:.3f}')

outfile = SIGNALS / f'tests/search_vs_s1_{datetime.now().strftime("%Y%m%d_%H%M")}.txt'
outfile.write_text('\n'.join(lines), encoding='utf-8')
print(f'\nSaved: {outfile}')
print(f'Cost: ${total_cost:.3f}')
