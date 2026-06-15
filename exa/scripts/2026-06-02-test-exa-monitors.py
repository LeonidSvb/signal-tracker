"""
Exa Monitors test — Philippe Bosquillon signal monitoring
Compares:
  TEST A: Exa Monitors vs Session 1 manual Exa scan (same queries)
  TEST B: Exa Search for job board signals vs Apify Indeed (Session 2)

Output: signals/tests/monitor_test_YYYYMMDD.txt
"""
import urllib.request, urllib.error, json, time, sys, re, csv
from pathlib import Path
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# ── Config ────────────────────────────────────────────────────────────────────
ROOT       = Path('C:/Users/79818/Desktop/Mastr_Leads')
SIGNALS    = ROOT / 'clients/philippe-bosquillon/signals'
CACHE_S1   = SIGNALS / 'tests/exa_cache.json'
OUT_FILE   = SIGNALS / f'tests/monitor_test_{datetime.now().strftime("%Y%m%d_%H%M")}.txt'

ENV = {}
for line in (ROOT / '.env').read_text(encoding='utf-8').splitlines():
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, _, v = line.partition('=')
        ENV[k.strip()] = v.strip()

EXA_KEY = ENV.get('EXA_API_KEY', '')
if not EXA_KEY:
    print('ERROR: EXA_API_KEY not found in .env')
    sys.exit(1)

print(f'Exa key: ...{EXA_KEY[-6:]}')

EXA_BASE = 'https://api.exa.ai'
HEADERS  = {'x-api-key': EXA_KEY, 'Content-Type': 'application/json'}

def exa_post(path, body):
    req = urllib.request.Request(
        f'{EXA_BASE}{path}',
        json.dumps(body).encode(),
        headers=HEADERS,
        method='POST'
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read()), int(r.headers.get('x-api-cost-dollars', 0) or 0)

def exa_get(path):
    req = urllib.request.Request(
        f'{EXA_BASE}{path}',
        headers={k: v for k, v in HEADERS.items() if k != 'Content-Type'},
        method='GET'
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

# ── Load Session 1 ground truth ───────────────────────────────────────────────
s1_cache = json.loads(CACHE_S1.read_text('utf-8')) if CACHE_S1.exists() else {}
s1_urls  = set()
s1_companies = set()
S1_TAM_COMPANIES = {
    'ritter sport', 'vion food', 'solina', 'planet a foods', 'orangeworks',
    'lotus bakeries', 'isigny', 'pere olive', 'carbios', 'berief'
}
s1_query_map = {}
for key, val in s1_cache.items():
    rows  = val.get('rows', []) if isinstance(val, dict) else val
    qtype = key.split('|')[0] if '|' in key else ''
    s1_query_map.setdefault(qtype, set())
    for r in rows:
        if not isinstance(r, dict):
            continue
        url = r.get('url', '')
        s1_urls.add(url)
        s1_query_map[qtype].add(url)
        title_lower = r.get('title', '').lower()
        for co in S1_TAM_COMPANIES:
            if co in title_lower:
                s1_companies.add(co)

print(f'Session 1 ground truth: {len(s1_urls)} URLs, TAM companies: {s1_companies}')

# ── Indeed ground truth (Session 2) ──────────────────────────────────────────
INDEED_COMPANIES = {
    'malteurop': ('FR', 'stale_60d', 'Directeur d\'usine'),
    'ardo':      ('BE', 'fresh_14d', 'Group Sales Director Food Service'),
    'royal a-ware': ('NL', 'active', 'exec role'),
    'florette':  ('FR', 'fresh_14d', 'Coordinateur SQCDME'),
}
print(f'Indeed ground truth: {len(INDEED_COMPANIES)} ICP companies')

lines = []
total_cost = 0.0

def log(s=''):
    print(s)
    lines.append(s)

# ══════════════════════════════════════════════════════════════════════════════
# TEST A — Exa Monitors: same queries as Session 1
# Sample: 6 queries covering 3 signal types × 2 countries each
# ══════════════════════════════════════════════════════════════════════════════
log()
log('=' * 70)
log('TEST A: Exa Monitors — 6 sample queries vs Session 1')
log('=' * 70)
log('Signal: M&A×DE, M&A×FR, C-Level×DE, C-Level×NL, Expand×BE, Expand×NL')
log()

MONITOR_QUERIES = [
    ('MA_DE',       'food manufacturing Germany acquisition merger takeover',           'MA'),
    ('MA_FR',       'food company France acquisition merger rachat agroalimentaire',    'MA'),
    ('CLEVEL_DE',   'food company Germany new CEO managing director appointment',       'CLEVEL'),
    ('CLEVEL_NL',   'food company Netherlands new CEO directeur managing director',     'CLEVEL'),
    ('EXPAND_BE',   'food company Belgium expansion new production site factory',       'EXPAND'),
    ('EXPAND_NL',   'food company Netherlands expansion new facility investment',       'EXPAND'),
]

monitor_results = {}   # label -> list of results
monitor_ids     = {}   # label -> monitor_id
A_cost          = 0.0

# Step A0: Create a temporary webhook.site token to receive Monitor results
log('Step A0: Creating webhook.site token...')
wh_token = ''
wh_url   = ''
try:
    req = urllib.request.Request(
        'https://webhook.site/token',
        b'{}',
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        wh_data  = json.loads(r.read())
        wh_token = wh_data.get('uuid', '')
        wh_url   = f'https://webhook.site/{wh_token}'
    log(f'  Webhook URL: {wh_url}')
    log(f'  View live at: https://webhook.site/#!/{wh_token}')
except Exception as e:
    log(f'  webhook.site failed ({e}) — using httpbin fallback')
    wh_url = 'https://httpbin.org/post'

# Step A1: Create monitors
log()
log('Step A1: Creating monitors...')
for label, query, qtype in MONITOR_QUERIES:
    try:
        body = {
            'search': {
                'query': query,
                'numResults': 5,
                'startPublishedDate': '2026-04-29',
            },
            'trigger': {
                'type': 'interval',
                'period': '7d'
            },
            'webhook': {'url': wh_url},
        }
        resp, _ = exa_post('/monitors', body)
        mid = resp.get('id') or resp.get('monitorId', '')
        monitor_ids[label] = mid
        A_cost += 0.015
        log(f'  [{label}] created: {mid}')
    except urllib.error.HTTPError as e:
        err = e.read().decode('utf-8', errors='replace')[:300]
        log(f'  [{label}] CREATE ERROR {e.code}: {err}')
    except Exception as e:
        log(f'  [{label}] ERROR: {e}')

# Step A2: Trigger all monitors manually
log()
log('Step A2: Triggering monitors manually...')
run_ids = {}
for label, mid in monitor_ids.items():
    if not mid:
        continue
    try:
        resp, _ = exa_post(f'/monitors/{mid}/trigger', {})
        rid = resp.get('id') or resp.get('runId', '')
        run_ids[label] = rid
        log(f'  [{label}] triggered, run_id: {rid}')
    except urllib.error.HTTPError as e:
        err = e.read().decode('utf-8', errors='replace')[:200]
        log(f'  [{label}] TRIGGER ERROR {e.code}: {err}')

# Step A3: Wait then collect from webhook.site (60s to let monitors fire)
log()
log('Step A3: Waiting 60s for monitors to fire → collecting from webhook.site...')
for i in range(12):
    print(f'  {(i+1)*5}s...', end=' ', flush=True)
    time.sleep(5)
print()

# Collect all webhook payloads from webhook.site
wh_payloads = []
if wh_token:
    try:
        req = urllib.request.Request(
            f'https://webhook.site/token/{wh_token}/requests?per_page=50',
            headers={'Accept': 'application/json'},
            method='GET'
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            wh_resp    = json.loads(r.read())
            wh_data_list = wh_resp.get('data', [])
            log(f'  webhook.site: {len(wh_data_list)} payloads received')
            for item in wh_data_list:
                try:
                    body_str = item.get('content', '') or item.get('body', '')
                    payload  = json.loads(body_str) if body_str else {}
                    wh_payloads.append(payload)
                except Exception:
                    pass
    except Exception as e:
        log(f'  webhook.site collect error: {e}')

# Map payloads back to monitor labels by matching monitor_id in payload
for label, mid in monitor_ids.items():
    matched = []
    for p in wh_payloads:
        if p.get('monitorId') == mid or p.get('id') == mid:
            matched.extend(p.get('results', p.get('items', [])))
    # fallback: if only 1 monitor fired and 1 payload, assign by order
    monitor_results[label] = matched

# If webhook gave nothing, try to get results via runs API
if not any(monitor_results.values()):
    log('  No webhook payloads matched — trying runs API...')
    for label, mid in monitor_ids.items():
        if not mid:
            monitor_results[label] = []
            continue
        try:
            data = exa_get(f'/monitors/{mid}/runs')
            runs = data if isinstance(data, list) else data.get('runs', data.get('items', []))
            if runs:
                latest = runs[0]
                results = latest.get('results', latest.get('items', []))
                monitor_results[label] = results
                log(f'  [{label}] runs API: {len(results)} results (status={latest.get("status")})')
            else:
                monitor_results[label] = []
                log(f'  [{label}] runs API: no runs yet')
        except urllib.error.HTTPError as e:
            err = e.read().decode('utf-8', errors='replace')[:200]
            log(f'  [{label}] runs API error {e.code}: {err}')
            monitor_results[label] = []

for label in monitor_ids:
    n = len(monitor_results.get(label, []))
    A_cost += 0.015 * max(1, n)

# Step A4: Analyze results
log()
log('Step A4: Analysis vs Session 1')
log('-' * 70)

total_monitor_results = 0
total_overlap_urls    = 0
total_new_urls        = 0
total_tam_hits        = 0
noise_count           = 0

for label, query, qtype in MONITOR_QUERIES:
    results = monitor_results.get(label, [])
    s1_qurls = s1_query_map.get(qtype, set())

    overlap = [r for r in results if r.get('url', '') in s1_urls]
    new_res = [r for r in results if r.get('url', '') not in s1_urls]
    tam_hits = [r for r in results
                if any(co in r.get('title', '').lower() for co in S1_TAM_COMPANIES)]

    total_monitor_results += len(results)
    total_overlap_urls    += len(overlap)
    total_new_urls        += len(new_res)
    total_tam_hits        += len(tam_hits)

    log(f'  [{label}] {len(results)} results | overlap_s1={len(overlap)} | new={len(new_res)} | TAM_hits={len(tam_hits)}')
    for r in results[:5]:
        title = r.get('title', r.get('text', ''))[:70]
        pub   = r.get('publishedDate', '')[:10]
        tam   = ' [TAM]' if any(co in title.lower() for co in S1_TAM_COMPANIES) else ''
        log(f'      [{pub}]{tam} {title}')

log()
log(f'TOTALS A: {total_monitor_results} results | overlap_s1={total_overlap_urls} | new={total_new_urls} | TAM={total_tam_hits}')
if total_monitor_results > 0:
    log(f'  Overlap rate: {total_overlap_urls/total_monitor_results:.0%} (expected ~70-80% for same time window)')
    log(f'  New signals:  {total_new_urls} not seen in Session 1')

# ══════════════════════════════════════════════════════════════════════════════
# TEST B — Exa Search for job board signals vs Apify Indeed
# Use regular Search (not Monitors) to see if Exa finds job postings
# ══════════════════════════════════════════════════════════════════════════════
log()
log('=' * 70)
log('TEST B: Exa Search for job board signals vs Indeed (Session 2)')
log('=' * 70)
log('Ground truth: Malteurop (FR), ardo (BE), Royal A-ware (NL), Florette (FR)')
log()

JOB_QUERIES = [
    ('JOBS_DE', 'food company Germany executive director job vacancy hiring 2026',         'DE'),
    ('JOBS_FR', 'agroalimentaire France directeur poste ouvert recrutement 2026',          'FR'),
    ('JOBS_NL', 'food bedrijf Nederland directeur vacature werving 2026',                  'NL'),
    ('JOBS_BE', 'food company Belgium director vacancy recruitment executive 2026',        'BE'),
    # Targeted queries for our Session 2 companies
    ('MALTEUROP', 'Malteurop directeur usine recrutement poste 2026',                      'FR'),
    ('ARDO',      'ardo food Belgium director vacancy sales 2026',                          'BE'),
    ('RAAWARE',   'Royal A-ware Netherlands director vacancy executive 2026',               'NL'),
    ('FLORETTE',  'Florette France directeur recrutement poste executif 2026',              'FR'),
]

job_results  = {}
B_cost       = 0.0
indeed_found = {co: False for co in INDEED_COMPANIES}

log('Running Exa Search queries for job board signals...')
for label, query, country in JOB_QUERIES:
    try:
        body = {
            'query':               query,
            'numResults':          5,
            'startPublishedDate':  '2026-03-01',  # wider window — stale jobs too
            'type':                'neural',
        }
        resp, _ = exa_post('/search', body)
        results = resp.get('results', [])
        B_cost += 0.007 * max(1, len(results))
        job_results[label] = results
        log(f'  [{label}] {len(results)} results (${0.007*max(1,len(results)):.3f})')
        for r in results[:4]:
            title = r.get('title', '')[:70]
            url   = r.get('url', '')[:60]
            pub   = r.get('publishedDate', '')[:10]
            # Check if this is one of our Indeed companies
            hit = ''
            for co_key in INDEED_COMPANIES:
                if co_key in title.lower() or co_key in url.lower():
                    indeed_found[co_key] = True
                    hit = f' [INDEED_MATCH: {co_key}]'
            log(f'      [{pub}]{hit} {title}')
        time.sleep(0.3)
    except urllib.error.HTTPError as e:
        err = e.read().decode('utf-8', errors='replace')[:200]
        log(f'  [{label}] ERROR {e.code}: {err}')
        job_results[label] = []
    except Exception as e:
        log(f'  [{label}] ERROR: {e}')
        job_results[label] = []

log()
log('Test B — Indeed company recall:')
for co, found in indeed_found.items():
    status = 'FOUND' if found else 'MISSED'
    meta   = INDEED_COMPANIES[co]
    log(f'  [{status}] {co} ({meta[0]}, {meta[1]})')

total_B_results = sum(len(v) for v in job_results.values())
found_count     = sum(1 for v in indeed_found.values() if v)
log()
log(f'TOTALS B: {total_B_results} Exa results | Indeed recall: {found_count}/{len(INDEED_COMPANIES)} companies')
log(f'          Indeed cost (Session 2): ~$2.10 | Exa cost this test: ${B_cost:.3f}')
log(f'          Indeed queries: 14 | Exa queries: {len(JOB_QUERIES)}')

# ══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ══════════════════════════════════════════════════════════════════════════════
log()
log('=' * 70)
log('COST SUMMARY')
log('=' * 70)
log()
log('Test A — Monitors (6 monitors × create + trigger):')
log(f'  Exa Monitors cost this test:   ${A_cost:.3f}')
log(f'  Session 1 manual Exa cost:     $0.231 (33 queries, one-off)')
log(f'  Weekly Monitors cost (40 q):   $0.60/week vs $0.28/week manual (+$0.32/wk)')
log()
log('Test B — Exa vs Indeed for job signals:')
log(f'  Exa Search cost this test:     ${B_cost:.3f} ({len(JOB_QUERIES)} queries)')
log(f'  Indeed cost (Session 2):       $2.10 (14 queries, 349 results)')
log(f'  Exa at 14 queries/week:        ${0.007*14*5:.3f}/week vs Indeed $1.80/week')
log()
log('VERDICT (fill in after seeing results):')
log('  [ ] Monitors: coverage comparable to manual? (same TAM companies found)')
log('  [ ] Monitors: meaningful new signals not in Session 1?')
log('  [ ] Monitors: acceptable noise ratio?')
log('  [ ] Exa job boards: recall Malteurop/ardo/Royal A-ware/Florette?')
log('  [ ] Exa job boards: stale job detection (60d+)?')
log('  [ ] Worth switching Indeed → Exa for job signals?')
log()
log(f'Total test cost: ${A_cost + B_cost:.3f}')
log(f'Run completed: {datetime.now().strftime("%Y-%m-%d %H:%M")}')

# ── Write output file ─────────────────────────────────────────────────────────
OUT_FILE.write_text('\n'.join(lines), encoding='utf-8')
print(f'\nOutput saved to: {OUT_FILE}')
print(f'Total test cost: ${A_cost + B_cost:.3f}')
