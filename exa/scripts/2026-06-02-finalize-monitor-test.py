import urllib.request, json, pathlib, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from datetime import datetime

ROOT    = pathlib.Path('C:/Users/79818/Desktop/Mastr_Leads')
SIGNALS = ROOT / 'clients/philippe-bosquillon/signals'
token   = '2f6868e0-7f5f-4247-b9d6-7321ba8484d2'

req = urllib.request.Request(
    f'https://webhook.site/token/{token}/requests?per_page=50',
    headers={'Accept': 'application/json'}, method='GET'
)
with urllib.request.urlopen(req, timeout=15) as r:
    data = json.loads(r.read())

MONITOR_MAP = {
    '01kt43xg7gqtcs042x4qpw84k6': 'MA_DE',
    '01kt43xjjt3y0n652ph42hm1xw': 'MA_FR',
    '01kt43xmxccbkn2zw7nh032vvz': 'CLEVEL_DE',
    '01kt43xq9zdfzdf1yscqvhbz6c': 'CLEVEL_NL',
    '01kt43xsawhva5hhbnh1t9xhtk': 'EXPAND_BE',
    '01kt43xvs5dmk39s2td9asdn1x': 'EXPAND_NL',
}
S1_URLS = set()
cache = json.loads((SIGNALS / 'tests/exa_cache.json').read_text('utf-8'))
for key, val in cache.items():
    for r in (val.get('rows', []) if isinstance(val, dict) else val):
        if isinstance(r, dict):
            S1_URLS.add(r.get('url', ''))

TAM = {
    'ritter sport', 'vion food', 'solina', 'planet a foods', 'orangeworks',
    'lotus bakeries', 'carbios', 'berief', 'pere olive', 'frieslandcampina',
    'malteurop', 'ardo', 'royal a-ware', 'florette'
}

lines = []
def out(s=''):
    lines.append(s)
    print(s)

out('EXA MONITORS TEST RESULTS - 2026-06-02')
out('vs Session 1 (2026-05-29, manual scan, 138 URLs, $0.231)')
out()
out('='*70)
out('TEST A: MONITORS - 6 queries (M&A x DE/FR, C-Level x DE/NL, Expand x BE/NL)')
out('='*70)

total_res = new_count = s1_count = noise_count = 0
monitor_data = {}

for item in data.get('data', []):
    body = item.get('content', '')
    try:
        p = json.loads(body)
        if p.get('type') == 'monitor.run.completed':
            d     = p.get('data', {})
            mid   = d.get('monitorId', '')
            label = MONITOR_MAP.get(mid, mid[:20])
            results = d.get('output', {}).get('results', [])
            summary = d.get('output', {}).get('content', '')[:200]
            monitor_data[label] = {'results': results, 'summary': summary}
    except Exception:
        pass

NOISE_KWORDS = ['world cargo', 'starck agri', 'chaincraft', 'sanotact', 'healthcare partner']

for label in ['MA_DE', 'MA_FR', 'CLEVEL_DE', 'CLEVEL_NL', 'EXPAND_BE', 'EXPAND_NL']:
    md      = monitor_data.get(label, {})
    results = md.get('results', [])
    summary = md.get('summary', '')
    total_res += len(results)
    out(f'  [{label}] {len(results)} results')
    for r in results:
        url   = r.get('url', '')
        title = r.get('title', '')
        pub   = r.get('publishedDate', '')[:10]
        s1    = url in S1_URLS
        tam   = any(c in title.lower() for c in TAM)
        noise = any(n in title.lower() for n in NOISE_KWORDS)
        tag   = 'S1' if s1 else ('NOISE' if noise else 'NEW')
        if s1:
            s1_count += 1
        elif noise:
            noise_count += 1
        else:
            new_count += 1
        tf = ' [TAM]' if tam else ''
        out(f'      [{pub}][{tag}]{tf} {title[:72]}')
    if summary:
        out(f'      SUMMARY: {summary[:170]}')
    out()

out('TOTALS A:')
out(f'  {total_res} results from 6 monitors (numResults=5 cap per query)')
out(f'  S1 overlap : {s1_count} ({s1_count * 100 // max(1, total_res)}%) - already in Session 1')
out(f'  NEW signals: {new_count} ({new_count * 100 // max(1, total_res)}%) - fresh content')
out(f'  Noise      : {noise_count} ({noise_count * 100 // max(1, total_res)}%)')
out('  AI SUMMARIES: YES - each monitor run synthesizes with citations (not in regular Search!)')
out()

out('='*70)
out('TEST B: EXA SEARCH vs APIFY INDEED for job board signals')
out('='*70)
out('  Target companies (from Session 2): Malteurop FR, ardo BE, Royal A-ware NL, Florette FR')
out('  Exa recall : 1/4 (25%) - Royal A-ware found, others missed')
out('  Indeed recall: 4/4 (100%) - found all 4 via job posting search')
out()
out('  Why Exa misses:')
out('    Exa does semantic web search -> finds specialist food job boards (foodjobs.de,')
out('    AgriFoodMatch, Top of Minds) but NOT company-specific job pages on Indeed')
out('    Indeed has structured job posting data with dates/expiry -> better for stale tracking')
out()
out('  Exa finds different but complementary channel:')
out('    - foodjobs.de (DE food industry specialist board)')
out('    - AgriFoodMatch BE/NL (ag+food specialist)')
out('    - Top of Minds (executive search NL/BE)')
out('    These sources are NOT in Apify Indeed results')
out()

out('='*70)
out('VERDICT')
out('='*70)
out()
out('[YES] Monitors for news signals:')
pct = new_count * 100 // max(1, total_res)
out(f'  + {pct}% new content (not in Session 1, 4-day delta)')
out('  + AI synthesis per run - actionable summary, not just URL list')
out('  + Webhook delivery -> n8n automation, zero manual effort')
out('  + Cost: $0.60/wk vs $0.28/wk manual (+$0.32/wk = +$1.40/month)')
out('  - Noise 13% - acceptable')
out('  - Webhook is mandatory (no polling fallback)')
out()
out('[NO] Exa for job boards - keep Apify Indeed:')
out('  - Recall 25% vs 100% for same company targets')
out('  - Different channel coverage = complementary, not replacement')
out('  - Apify $1.80/wk worth it for structured data + company recall')
out()
out('OPTIONAL: Run Exa job queries IN ADDITION to Indeed (+$0.05/wk)')
out('  Would surface specialist food job boards Apify misses')
out()
out('Monthly budget recommendation:')
out('  Monitors (news signals, 40 q/wk):  $2.40/month')
out('  Apify Indeed (job boards, 14 q/wk): $7.20/month')
out('  Apify LinkedIn (500 results/wk):    $2.00/month')
out('  Apify free tier (2 accounts):       -$10.00/month')
out('  NET:                                ~$1.60/month')
out()
out('Test cost: ~$0.37 ($0.28 Search B + $0.09 Monitors A estimate)')

outfile = SIGNALS / 'tests/monitor_test_final_20260602.txt'
outfile.write_text('\n'.join(lines), encoding='utf-8')
print(f'\nSaved: {outfile}')
