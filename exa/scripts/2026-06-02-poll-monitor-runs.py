"""
Poll Exa runs API for each of the 33 monitors directly.
webhook.site free tier (50 items) got flooded by created events.
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

id_data     = json.loads((SIGNALS / 'tests/monitor_ids.json').read_text('utf-8'))
monitor_ids = id_data['all_monitors']

def exa_get(path):
    req = urllib.request.Request(
        f'{EXA_BASE}{path}',
        headers={k: v for k, v in HDRS.items() if k != 'Content-Type'},
        method='GET'
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

# Load S1 ground truth
cache = json.loads((SIGNALS / 'tests/exa_cache.json').read_text('utf-8'))
S1_URLS = set()
for key, val in cache.items():
    rows = val.get('rows', []) if isinstance(val, dict) else val
    for r in rows:
        if isinstance(r, dict):
            S1_URLS.add(r.get('url', ''))

TAM = {
    'ritter sport', 'vion food', 'solina', 'planet a foods', 'orangeworks',
    'lotus', 'carbios', 'berief', 'pere olive', 'isigny',
    'frieslandcampina', 'malteurop', 'ardo', 'royal a-ware', 'florette',
    'berentzen', 'lantmannen', 'kipster', 'emmi', 'maasoever', 'cono',
    'melitta', 'van vugt', 'dmk group',
}
S1_TAM = {
    'ritter sport', 'vion food', 'solina', 'planet a foods',
    'orangeworks', 'lotus', 'carbios', 'berief', 'pere olive'
}
NOISE_KWORDS = [
    'healthcare partner', 'world cargo', 'sanotact', 'pharmaceutical',
    'real estate', 'software', 'fintech', 'bank acqui', 'insurance',
    'shipping container', 'semiconductor', 'automotive',
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

print(f'Polling runs API for {len(monitor_ids)} monitors...')
monitor_results = {}
errors = 0
for label, mid in monitor_ids.items():
    if not mid:
        monitor_results[label] = {'results': [], 'summary': '', 'status': 'no_id'}
        continue
    try:
        data = exa_get(f'/monitors/{mid}/runs')
        # Response can be list or {runs: [...]}
        runs = data if isinstance(data, list) else data.get('runs', data.get('items', []))
        if not runs:
            monitor_results[label] = {'results': [], 'summary': '', 'status': 'no_runs'}
            print(f'  [{label}] no runs yet')
            continue
        latest = runs[0] if isinstance(runs[0], dict) else {}
        status  = latest.get('status', '?')
        out_data = latest.get('output', {})
        results  = out_data.get('results', [])
        summary  = out_data.get('content', '')
        monitor_results[label] = {
            'results': results, 'summary': summary, 'status': status
        }
        print(f'  [{label}] {status} | {len(results)} results')
        time.sleep(0.1)
    except urllib.error.HTTPError as e:
        err = e.read().decode('utf-8', errors='replace')[:100]
        print(f'  [{label}] HTTP {e.code}: {err}')
        monitor_results[label] = {'results': [], 'summary': '', 'status': f'err_{e.code}'}
        errors += 1
    except Exception as e:
        print(f'  [{label}] EXC: {e}')
        monitor_results[label] = {'results': [], 'summary': '', 'status': 'exc'}
        errors += 1

completed = sum(1 for v in monitor_results.values() if v['results'])
print(f'\nGot results for {completed}/{len(monitor_ids)} monitors ({errors} errors)')

# ── Analysis ──────────────────────────────────────────────────────────────────
lines = []
def out(s=''):
    lines.append(s)
    print(s)

out()
out('='*72)
out('EXA MONITORS — ALL 33 RESULTS (polled via runs API)')
out(f'Date: {datetime.now().strftime("%Y-%m-%d %H:%M")}')
out(f'vs Session 1 (2026-05-29, 138 URLs, $0.231)')
out('='*72)
out()

totals = {'results': 0, 'new': 0, 's1': 0, 'noise': 0, 'tam': 0, 'monitors_with_results': 0}
monitor_details = []
new_tam_found = set()
s1_tam_found  = set()

for label, query in ALL_QUERIES:
    md      = monitor_results.get(label, {})
    results = md.get('results', [])
    summary = md.get('summary', '')
    status  = md.get('status', '?')
    qtype   = label.split('|')[0]
    is_site = query.startswith('site:')

    score = row_new = row_s1 = row_noise = row_tam = 0
    if results:
        totals['monitors_with_results'] += 1

    for r in results:
        url   = r.get('url', '')
        title = r.get('title', '').lower()
        s1    = url in S1_URLS
        tam   = any(c in title for c in TAM)
        noise = any(n in title for n in NOISE_KWORDS)

        totals['results'] += 1
        if s1:
            row_s1    += 1; totals['s1']    += 1
            if tam: s1_tam_found.add(next((c for c in TAM if c in title), '?'))
        elif noise:
            row_noise += 1; totals['noise'] += 1; score -= 1
        else:
            row_new   += 1; totals['new']   += 1; score += 1
            if tam: new_tam_found.add(next((c for c in TAM if c in title), '?'))
        if tam and not noise:
            row_tam += 1; totals['tam'] += 1; score += 3

    monitor_details.append({
        'label': label, 'query': query, 'qtype': qtype,
        'n': len(results), 'new': row_new, 's1': row_s1,
        'noise': row_noise, 'tam': row_tam, 'score': score,
        'summary': summary, 'results': results,
        'is_site': is_site, 'status': status,
        'mid': monitor_ids.get(label, ''),
    })

monitor_details.sort(key=lambda x: x['score'], reverse=True)

out('RESULTS PER MONITOR (sorted by score):')
out('-'*72)
for d in monitor_details:
    verdict = ('KEEP'   if d['score'] >= 2 else
               'TRIM'   if d['score'] >= 0 else
               'DELETE')
    site_note = ' [site:]' if d['is_site'] else ''
    st = d['status']
    out(f"  [{verdict}][{d['label']:22s}] score={d['score']:+d} | "
        f"{d['n']}r {d['new']}new/{d['s1']}S1/{d['noise']}noise/{d['tam']}TAM "
        f"({st}){site_note}")
    for r in d['results'][:4]:
        url   = r.get('url', '')
        title = r.get('title', '')
        pub   = r.get('publishedDate', '')[:10]
        s1f   = '[S1] ' if url in S1_URLS else '[NEW]'
        tamf  = '[TAM]' if any(c in title.lower() for c in TAM) else '     '
        out(f'       [{pub}]{s1f}{tamf} {title[:68]}')
    if d['summary']:
        out(f"       SUM: {d['summary'][:170]}")
    out()

# TAM recall
out('='*72)
out('TAM RECALL vs Session 1:')
for co in sorted(S1_TAM):
    tag = 'NEW  ' if co in new_tam_found else ('S1   ' if co in s1_tam_found else 'MISS ')
    out(f"  [{tag}] {co}")
bonus = new_tam_found - S1_TAM
if bonus:
    out(f"  BONUS companies not in S1 TAM: {bonus}")
out()

# Summary by signal type
out('='*72)
out('BY SIGNAL TYPE:')
for qtype in ['MA', 'CLEVEL', 'EXPAND', 'INVEST', 'CONTRACT', 'NICHE', 'SECTOR']:
    group = [d for d in monitor_details if d['qtype'] == qtype]
    g_results = sum(d['n'] for d in group)
    g_new  = sum(d['new'] for d in group)
    g_s1   = sum(d['s1'] for d in group)
    g_tam  = sum(d['tam'] for d in group)
    g_noise= sum(d['noise'] for d in group)
    out(f"  {qtype:12s}: {len(group)} monitors | {g_results}r | "
        f"{g_new}new / {g_s1}S1 / {g_noise}noise / {g_tam}TAM")
out()

# Aggregates
out('='*72)
out(f'AGGREGATE:')
out(f"  Monitors run:   {len(monitor_ids)} | with results: {totals['monitors_with_results']}")
out(f"  Total results:  {totals['results']}")
out(f"  NEW signals:    {totals['new']} ({totals['new']*100//max(1,totals['results'])}%)")
out(f"  S1 overlap:     {totals['s1']} ({totals['s1']*100//max(1,totals['results'])}%)")
out(f"  Noise:          {totals['noise']} ({totals['noise']*100//max(1,totals['results'])}%)")
out(f"  TAM hits:       {totals['tam']}")
out()

# Keep/Trim/Delete
keep   = [d for d in monitor_details if d['score'] >= 2]
trim   = [d for d in monitor_details if 0 <= d['score'] < 2]
delete = [d for d in monitor_details if d['score'] < 0]

out('='*72)
out('KEEP / TRIM / DELETE:')
out()
out(f"KEEP {len(keep)} — weekly:")
for d in keep:
    out(f"  {d['score']:+d}  {d['label']:22s} | {d['new']}new {d['tam']}TAM | {d['query'][:50]}")
out()
out(f"TRIM {len(trim)} — monthly (low yield but cheap):")
for d in trim:
    out(f"  {d['score']:+d}  {d['label']:22s} | {d['new']}new {d['tam']}TAM | {d['query'][:50]}")
out()
out(f"DELETE {len(delete)} — noise:")
for d in delete:
    out(f"  {d['score']:+d}  {d['label']:22s} | {d['query'][:50]}")
out()

# Cost
wk_keep  = len(keep)  * 0.015
mo_trim  = len(trim)  * 0.015
mo_total = wk_keep * 4.33 + mo_trim
out('COST:')
out(f"  {len(keep)} KEEP weekly:    ${wk_keep:.3f}/wk = ${wk_keep*4.33:.2f}/mo")
out(f"  {len(trim)} TRIM monthly:   ${mo_trim:.3f}/mo")
out(f"  TOTAL:           ${mo_total:.2f}/mo")
out()
out(f"  Manual Search 33q/wk:  ${33*0.007:.3f}/wk = ${33*0.007*4.33:.2f}/mo")
out(f"  All Monitors 33q/wk:   ${33*0.015:.3f}/wk = ${33*0.015*4.33:.2f}/mo")
out()
s1_cpp = 0.231 / max(1, 138)
mo_cpp = (completed * 0.015) / max(1, totals['results'])
out(f"  Cost/result  Search: ${s1_cpp:.4f} | Monitors: ${mo_cpp:.4f}")
out(f"  Monitors also include AI synthesis per run")

outfile = SIGNALS / f'tests/full_run_final_{datetime.now().strftime("%Y%m%d_%H%M")}.txt'
outfile.write_text('\n'.join(lines), encoding='utf-8')
id_data['keep']   = [d['label'] for d in keep]
id_data['trim']   = [d['label'] for d in trim]
id_data['delete'] = [d['label'] for d in delete]
(SIGNALS / 'tests/monitor_ids.json').write_text(
    json.dumps(id_data, indent=2, ensure_ascii=False), encoding='utf-8')
print(f'\nSaved: {outfile}')
