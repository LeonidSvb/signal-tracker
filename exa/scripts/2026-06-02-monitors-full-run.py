"""
Full Monitors run — all 33 Session 1 queries as Exa Monitors
Compares results vs Session 1 ground truth, scores each monitor,
outputs keep/trim/delete recommendation.
"""
import urllib.request, urllib.error, json, time, sys, pathlib
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT    = pathlib.Path('C:/Users/79818/Desktop/Mastr_Leads')
SIGNALS = ROOT / 'clients/philippe-bosquillon/signals'
EXA_BASE = 'https://api.exa.ai'

ENV = {}
for line in (ROOT / '.env').read_text(encoding='utf-8').splitlines():
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, _, v = line.partition('=')
        ENV[k.strip()] = v.strip()
EXA_KEY = ENV.get('EXA_API_KEY', '')
HEADERS = {'x-api-key': EXA_KEY, 'Content-Type': 'application/json'}

def exa_post(path, body):
    req = urllib.request.Request(
        f'{EXA_BASE}{path}', json.dumps(body).encode(),
        headers=HEADERS, method='POST'
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())

def exa_delete(path):
    req = urllib.request.Request(
        f'{EXA_BASE}{path}',
        headers={k: v for k, v in HEADERS.items() if k != 'Content-Type'},
        method='DELETE'
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return True
    except Exception:
        return False

# ── Load S1 ground truth ──────────────────────────────────────────────────────
cache   = json.loads((SIGNALS / 'tests/exa_cache.json').read_text('utf-8'))
S1_URLS = set()
S1_BY_TYPE = {}  # type -> set of urls
for key, val in cache.items():
    rows  = val.get('rows', []) if isinstance(val, dict) else val
    qtype = key.split('|')[0]
    S1_BY_TYPE.setdefault(qtype, set())
    for r in rows:
        if isinstance(r, dict):
            u = r.get('url', '')
            S1_URLS.add(u)
            S1_BY_TYPE[qtype].add(u)

TAM = {
    'ritter sport', 'vion food', 'solina', 'planet a foods', 'orangeworks',
    'lotus bakeries', 'carbios', 'berief', 'pere olive', 'isigny',
    'frieslandcampina', 'malteurop', 'ardo', 'royal a-ware', 'florette',
    'berentzen', 'lantmannen', 'kipster', 'emmi', 'maasoever', 'cono',
    'melitta', 'van vugt'
}

print(f'S1 ground truth: {len(S1_URLS)} URLs across {len(S1_BY_TYPE)} types')

# ── All 33 queries (from Session 1 cache) ────────────────────────────────────
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

# IDs of the 6 test monitors from earlier (to delete after)
OLD_MONITOR_IDS = [
    '01kt43xg7gqtcs042x4qpw84k6',
    '01kt43xjjt3y0n652ph42hm1xw',
    '01kt43xmxccbkn2zw7nh032vvz',
    '01kt43xq9zdfzdf1yscqvhbz6c',
    '01kt43xsawhva5hhbnh1t9xhtk',
    '01kt43xvs5dmk39s2td9asdn1x',
]

# ── Step 0: New webhook.site token ────────────────────────────────────────────
print('\nStep 0: webhook.site token...')
req = urllib.request.Request(
    'https://webhook.site/token', b'{}',
    headers={'Content-Type': 'application/json'}, method='POST'
)
with urllib.request.urlopen(req, timeout=15) as r:
    wh = json.loads(r.read())
WH_TOKEN = wh['uuid']
WH_URL   = f'https://webhook.site/{WH_TOKEN}'
print(f'  Token: {WH_TOKEN}')
print(f'  Live view: https://webhook.site/#!/{WH_TOKEN}')

# ── Step 1: Create all 33 monitors ───────────────────────────────────────────
print(f'\nStep 1: Creating {len(ALL_QUERIES)} monitors...')
monitor_ids = {}  # label -> id
created = 0
for label, query in ALL_QUERIES:
    try:
        body = {
            'search':  {'query': query, 'numResults': 5},
            'trigger': {'type': 'interval', 'period': '7d'},
            'webhook': {'url': WH_URL},
        }
        resp = exa_post('/monitors', body)
        mid  = resp.get('id', '')
        monitor_ids[label] = mid
        created += 1
        print(f'  [{label}] {mid[:26]}')
    except urllib.error.HTTPError as e:
        err = e.read().decode('utf-8', errors='replace')[:120]
        print(f'  [{label}] ERROR {e.code}: {err}')
        monitor_ids[label] = ''
    except Exception as e:
        print(f'  [{label}] EXC: {e}')
        monitor_ids[label] = ''
    time.sleep(0.15)

print(f'\nCreated: {created}/{len(ALL_QUERIES)}')

# ── Step 2: Trigger all ───────────────────────────────────────────────────────
print(f'\nStep 2: Triggering all monitors...')
triggered = 0
for label, mid in monitor_ids.items():
    if not mid:
        continue
    try:
        exa_post(f'/monitors/{mid}/trigger', {})
        triggered += 1
        print(f'  [{label}] fired', end='  ')
        if triggered % 5 == 0:
            print()
    except urllib.error.HTTPError as e:
        err = e.read().decode('utf-8', errors='replace')[:80]
        print(f'  [{label}] TRIGGER ERR {e.code}: {err}')
    time.sleep(0.1)

print(f'\n\nTriggered: {triggered}. Waiting 120s for runs to complete...')
for i in range(24):
    time.sleep(5)
    print(f'  {(i+1)*5}s...', end=' ', flush=True)
    if (i+1) % 10 == 0:
        print()
print()

# ── Step 3: Collect from webhook.site ────────────────────────────────────────
print('\nStep 3: Collecting from webhook.site...')
req = urllib.request.Request(
    f'https://webhook.site/token/{WH_TOKEN}/requests?per_page=200',
    headers={'Accept': 'application/json'}, method='GET'
)
with urllib.request.urlopen(req, timeout=20) as r:
    wh_data = json.loads(r.read())

payloads = []
for item in wh_data.get('data', []):
    body = item.get('content', '')
    try:
        p = json.loads(body)
        payloads.append(p)
    except Exception:
        pass

# Build mid -> label map (reverse)
mid_to_label = {v: k for k, v in monitor_ids.items()}

# Collect results per label
monitor_results  = {label: {'results': [], 'summary': ''} for label, _ in ALL_QUERIES}
completed_count  = 0
for p in payloads:
    if p.get('type') == 'monitor.run.completed':
        d       = p.get('data', {})
        mid     = d.get('monitorId', '')
        label   = mid_to_label.get(mid, '')
        if label:
            out = d.get('output', {})
            monitor_results[label]['results'] = out.get('results', [])
            monitor_results[label]['summary'] = out.get('content', '')
            completed_count += 1

print(f'  Total payloads: {len(payloads)}')
print(f'  Completed runs matched: {completed_count}/{triggered}')

# Check for any still pending — wait extra 60s if needed
pending = [lb for lb, _ in ALL_QUERIES
           if monitor_ids.get(lb) and not monitor_results[lb]['results']
           and monitor_ids[lb]]
if pending and completed_count < triggered * 0.8:
    print(f'  {len(pending)} monitors still pending — waiting 60s more...')
    time.sleep(60)
    req = urllib.request.Request(
        f'https://webhook.site/token/{WH_TOKEN}/requests?per_page=300',
        headers={'Accept': 'application/json'}, method='GET'
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        wh_data2 = json.loads(r.read())
    for item in wh_data2.get('data', []):
        body = item.get('content', '')
        try:
            p = json.loads(body)
            if p.get('type') == 'monitor.run.completed':
                d   = p.get('data', {})
                mid = d.get('monitorId', '')
                lb  = mid_to_label.get(mid, '')
                if lb and not monitor_results[lb]['results']:
                    out = d.get('output', {})
                    monitor_results[lb]['results'] = out.get('results', [])
                    monitor_results[lb]['summary'] = out.get('content', '')
                    completed_count += 1
        except Exception:
            pass
    print(f'  After extra wait: {completed_count} completed')

# ── Step 4: Full analysis ─────────────────────────────────────────────────────
print('\nStep 4: Analyzing results...')

lines = []
def out(s=''):
    lines.append(s)
    print(s)

out()
out('='*72)
out(f'EXA MONITORS — FULL RUN: ALL 33 QUERIES')
out(f'Run date: {datetime.now().strftime("%Y-%m-%d %H:%M")}')
out(f'vs Session 1 (2026-05-29, manual, 138 URLs, $0.231)')
out('='*72)
out()

# Scoring per monitor
# +3 TAM hit, +1 new relevant, 0 S1 overlap, -1 noise
NOISE_KWORDS = [
    'healthcare partner', 'world cargo', 'sanotact', 'chaincraft',
    'pharmaceutical', 'chemical', 'logistics shipping', 'finance bank',
    'real estate', 'tech startup', 'software', 'ai company',
]
IRRELEVANT_INDUSTRIES = ['pharma', 'medtech', 'fintech', 'proptech']

scores  = {}  # label -> score
totals  = {'results': 0, 'new': 0, 's1': 0, 'noise': 0, 'tam': 0}
monitor_details = []

for label, query in ALL_QUERIES:
    md      = monitor_results.get(label, {})
    results = md.get('results', [])
    summary = md.get('summary', '')
    qtype   = label.split('|')[0]

    score = 0
    row_new = row_s1 = row_noise = row_tam = 0

    for r in results:
        url   = r.get('url', '')
        title = r.get('title', '').lower()
        s1    = url in S1_URLS
        tam   = any(c in title for c in TAM)
        noise = any(n in title for n in NOISE_KWORDS)

        totals['results'] += 1
        if s1:
            row_s1    += 1; totals['s1']    += 1
        elif noise:
            row_noise += 1; totals['noise'] += 1; score -= 1
        else:
            row_new   += 1; totals['new']   += 1; score += 1
        if tam:
            row_tam += 1; totals['tam'] += 1; score += 3

    # Site: queries get capped score (may not work well with Monitors)
    is_site_query = query.startswith('site:')

    scores[label] = score
    monitor_details.append({
        'label': label, 'query': query, 'qtype': qtype,
        'n': len(results), 'new': row_new, 's1': row_s1,
        'noise': row_noise, 'tam': row_tam, 'score': score,
        'summary': summary[:200], 'results': results,
        'is_site': is_site_query,
        'mid': monitor_ids.get(label, ''),
    })

# Sort by score desc
monitor_details.sort(key=lambda x: x['score'], reverse=True)

# ── Output: per monitor ───────────────────────────────────────────────────────
out('RESULTS PER MONITOR (sorted by score):')
out('-'*72)
for d in monitor_details:
    verdict = ('KEEP'   if d['score'] >= 2 else
               'TRIM'   if d['score'] >= 0 else
               'DELETE')
    site_note = ' [site: query — may underperform]' if d['is_site'] else ''
    out(f"  [{verdict}] [{d['label']}] score={d['score']:+d} | "
        f"{d['n']} results: {d['new']} new / {d['s1']} S1 / {d['noise']} noise / {d['tam']} TAM{site_note}")
    for r in d['results'][:4]:
        url   = r.get('url', '')
        title = r.get('title', '')
        pub   = r.get('publishedDate', '')[:10]
        s1f   = '[S1]'  if url in S1_URLS else '[NEW]'
        tamf  = '[TAM]' if any(c in title.lower() for c in TAM) else ''
        out(f'      [{pub}]{s1f}{tamf} {title[:70]}')
    if d['summary']:
        out(f"      SUMMARY: {d['summary'][:160]}")
    out()

# ── Aggregate stats ───────────────────────────────────────────────────────────
out('='*72)
out('AGGREGATE STATS')
out('='*72)
out(f"  Total results    : {totals['results']} (from {completed_count} completed monitors)")
out(f"  NEW signals      : {totals['new']} ({totals['new']*100//max(1,totals['results'])}%)")
out(f"  S1 overlap       : {totals['s1']} ({totals['s1']*100//max(1,totals['results'])}%)")
out(f"  Noise            : {totals['noise']} ({totals['noise']*100//max(1,totals['results'])}%)")
out(f"  TAM hits         : {totals['tam']}")
out()

# ── TAM recall check ─────────────────────────────────────────────────────────
out('TAM RECALL (companies from Session 1 that had hits):')
S1_TAM_FOUND_ORIG = {
    'ritter sport', 'vion food', 'solina', 'planet a foods',
    'orangeworks', 'lotus bakeries', 'carbios', 'berief', 'pere olive'
}
new_tam_found = set()
s1_tam_found  = set()
for d in monitor_details:
    for r in d['results']:
        title = r.get('title', '').lower()
        url   = r.get('url', '')
        for co in TAM:
            if co in title:
                if url in S1_URLS:
                    s1_tam_found.add(co)
                else:
                    new_tam_found.add(co)

for co in sorted(S1_TAM_FOUND_ORIG):
    in_s1  = co in s1_tam_found
    in_new = co in new_tam_found
    if in_new:   tag = 'FOUND NEW'
    elif in_s1:  tag = 'FOUND S1'
    else:        tag = 'MISSED'
    out(f"  [{tag:10s}] {co}")
out()
if new_tam_found - S1_TAM_FOUND_ORIG:
    out(f"  NEW TAM companies found (not in S1 TAM): {new_tam_found - S1_TAM_FOUND_ORIG}")
out()

# ── Recommendations ───────────────────────────────────────────────────────────
keep   = [d for d in monitor_details if d['score'] >= 2]
trim   = [d for d in monitor_details if 0 <= d['score'] < 2]
delete = [d for d in monitor_details if d['score'] < 0]

out('='*72)
out('RECOMMENDATION')
out('='*72)
out()
out(f"KEEP ({len(keep)} monitors — high value, run weekly):")
for d in keep:
    out(f"  {d['label']:25s} score={d['score']:+d}  {d['query'][:55]}")
out()
out(f"TRIM ({len(trim)} monitors — low yield, consider monthly instead of weekly):")
for d in trim:
    out(f"  {d['label']:25s} score={d['score']:+d}  {d['query'][:55]}")
out()
out(f"DELETE ({len(delete)} monitors — noise, not worth running):")
for d in delete:
    out(f"  {d['label']:25s} score={d['score']:+d}  {d['query'][:55]}")
out()

# ── Cost calculation ──────────────────────────────────────────────────────────
keep_n   = len(keep)
trim_n   = len(trim)
wk_cost  = keep_n * 0.015 + trim_n * 0.015 / 4   # trim = monthly
mo_cost  = wk_cost * 4.33
out('COST PROJECTION:')
out(f"  {keep_n} KEEP monitors weekly:   ${keep_n * 0.015:.3f}/week")
out(f"  {trim_n} TRIM monitors monthly:  ${trim_n * 0.015:.3f}/month")
out(f"  Weekly total:               ${wk_cost:.3f}")
out(f"  Monthly total:              ${mo_cost:.2f}")
out(f"  vs Session 1 manual (33q):  $0.231 one-off / $0.495/week if automated")
out()
out(f"  Session 1 cost:       $0.231 (33 × $0.007 Search)")
out(f"  This full run cost:   ~${completed_count * 0.015:.3f} ({completed_count} monitors × $0.015)")
out(f"  Per-result comparison: Search=${0.231/max(1,138):.4f} | Monitors=${completed_count*0.015/max(1,totals['results']):.4f}")

# ── Save output ───────────────────────────────────────────────────────────────
# Also save monitor IDs for production use
prod_monitors = {d['label']: d['mid'] for d in keep + trim if d['mid']}
outfile = SIGNALS / f'tests/full_run_{datetime.now().strftime("%Y%m%d_%H%M")}.txt'
outfile.write_text('\n'.join(lines), encoding='utf-8')

ids_file = SIGNALS / 'tests/monitor_ids.json'
ids_file.write_text(json.dumps({
    'created': datetime.now().isoformat(),
    'webhook_token': WH_TOKEN,
    'all_monitors':  monitor_ids,
    'keep':  [d['label'] for d in keep],
    'trim':  [d['label'] for d in trim],
    'delete':[d['label'] for d in delete],
}, indent=2, ensure_ascii=False), encoding='utf-8')

# ── Delete old test monitors from session earlier ─────────────────────────────
print('\nCleaning up old test monitors from earlier session...')
for mid in OLD_MONITOR_IDS:
    ok = exa_delete(f'/monitors/{mid}')
    print(f'  DELETE {mid[:20]} -> {"ok" if ok else "failed"}')

print(f'\nReport saved: {outfile}')
print(f'Monitor IDs saved: {ids_file}')
print(f'Live webhook: https://webhook.site/#!/{WH_TOKEN}')
print(f'Total test cost: ~${created * 0.015:.3f}')
