# Enrichment Services Research — Email + Mobile Phone API
Date: 2026-06-10
Use case: single-record API enrichment triggered by job board signals (Philippe project)
Requirements: EU coverage (DE/FR/NL), single-record API, PAYG preferred, no annual lock-in

---

## Cost comparison: 100 emails + 10 mobile phones (EU)

| Service | 100 emails | 10 mobiles | Total | Plan |
|---|---|---|---|---|
| FullEnrich | $0.50 | $0.50 | **$1.00** | $5/mo min — VERIFY pricing, may be $55/mo |
| LeadMagic | $2.04 | $1.02 | **$3.06** | $490/year only (annual lock-in) |
| Enrow | $1.20 | $6.00 | **$7.20** | $24/mo, credits rollover |
| Prospeo | $3.90–$2.45 | $2.45–$1.00 | **$7.80** | $49/mo, 2,000 credits |
| Tomba.io | $3.90 | $3.90 | **$7.80** | $39/mo, no lock-in |
| Datagma | $1.63 | $14.70 | **$16.33** | $49/mo |
| People Data Labs | $28.00 | included | **~$33** | $98/mo |

---

## Prospeo — детальный разбор ($49/mo = 2,000 кредитов)

Credit structure:
- Email find: 1 credit ($0.025)
- Mobile find: 10 credits ($0.245)
- Email + mobile pair: 11 credits ($0.27)

Capacity per month at $49/mo:
- Emails only: 2,000
- Mobiles only: 200
- Email+mobile pairs: ~181

Billing model:
- API single-record: pay only for found results (0 credits if not found)
- CSV bulk upload: charged per row regardless of result — avoid for this use case

EU mobile coverage: claims 125M+ EU mobiles, EMEA coverage documented
Single-record API: yes, "Enrich Person" endpoint

---

## True PAYG (no subscription) — market status 2026

| Service | Status |
|---|---|
| Proxycurl | Was the best PAYG — shut down July 2025 (LinkedIn lawsuit) |
| BookYourData | Credits never expire, no subscription. ~$0.40/email — expensive |
| Hunter.io | Extra credits purchasable ad-hoc but email-only, no mobile |
| All others | Minimum $5–$49/mo mandatory |

Conclusion: market has moved to subscription minimums. No major service offers clean self-serve PAYG in 2026.

---

## Services eliminated

| Service | Reason |
|---|---|
| Findymail | EU mobile blocked by GDPR policy |
| Dropcontact | Landlines only, no mobile by design |
| Cognism | Best EU mobile but $15K+/year minimum |
| Hunter.io | No phone data at all |
| Seamless.ai | Weak EU coverage, API enterprise-only |
| Apollo.io | Weak EU phones, annual subscription |
| Lusha | API only on Scale plan ($10K+/year) |
| Clearbit/HubSpot | No phone, deprecated API |
| Dealfront/Echobot | Best for DACH/DE but custom enterprise contract |
| Kaspr | Requires LinkedIn URL as input, not name+company |

---

## Full service overview

### Enrow
- Email: $0.012/valid find (cheapest on market)
- Mobile: $0.60/find
- API: included, webhook support
- Billing: pay-per-valid-result, credits rollover monthly
- Note: French company, EU email likely good, EU mobile not benchmarked

### Icypeas
- Email: $0.019/find, credits never expire
- Mobile: not available ("coming soon")
- API: from $19/mo, n8n/Make/Zapier integrations

### LeadMagic
- Email: $0.020/find
- Mobile: $0.083–$0.10/find (cheapest mobile on market)
- API: 15+ endpoints, sub-200ms, MCP server available
- Billing: annual only ($490/year) — biggest downside
- Note: MCP-compatible, good fit for AI agent pipelines

### Prospeo
- Email: 1 credit, Mobile: 10 credits ($49/mo = 2,000 credits)
- API: single-record endpoint, pay-per-result on API mode
- EU mobile: 125M+ EU mobiles claimed
- No lock-in, monthly billing

### FullEnrich
- Email: $0.055/valid, Mobile: $0.55/valid
- Model: waterfall through 15+ providers (Apollo + Kaspr + Dropcontact + RocketReach etc.)
- Best for maximizing hit rate when primary provider misses
- Pricing discrepancy: $5/mo seen in one source, $55/mo in another — verify before use

### Datagma
- Email: ~$0.039, Mobile: ~$1.17 (30 credits each)
- Unique strength: best French "06" mobile accuracy per G2 user reviews
- Only justifiable if French mobile accuracy is top priority over cost

### Tomba.io
- Email: $0.039, Mobile: $0.39
- API: REST + SDKs (Python, Node.js, PHP, Ruby, Go, Java)
- Monthly no lock-in, no-match = no charge
- EU mobile quality: unknown

### Surfe
- Email: ~$0.022, Mobile: ~$0.065
- Monthly no annual lock-in, 3-month credit expiry
- EU-based (French company)
- Single-record API terms unclear — need to verify

---

## Recommendation for Philippe signals

Primary: Prospeo — single API call returns email+mobile, $49/mo, monthly no lock-in, EU coverage documented.

If hit rate insufficient: FullEnrich as fallback (waterfall through 15+ providers).

If French mobile accuracy is critical: Datagma for phone call ($1.17/mobile) + Enrow for email ($0.012).

Next step: test Prospeo API with 5–10 real signals from job board results before committing.
