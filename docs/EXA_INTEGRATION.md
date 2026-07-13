# Exa Integration — current state

Last verified: 2026-07-13, against the live Exa API and production Supabase (`signal_monitoring`
schema). This document supersedes anything n8n/Google-Sheets-related in `exa/EXA_NOTES.md` —
that file describes the 2026-06-02 prototype, which was fully decommissioned 2026-06-22
(see CHANGELOG.md `[0.4.0]` "Architecture reset: dropped n8n → Google Sheets"). There is no n8n
workflow and no Google Sheet in this pipeline anymore. Everything writes to `signal_monitoring.raw_signals`
in Supabase — that is the only destination.

---

## Architecture (current, verified)

```
33 Exa Monitors (interval trigger, every 7 days, Exa-managed schedule — not our cron)
  → webhook POST → https://philippe.pamelacoreypc.com/api/exa-webhook (Next.js API route)
  → normalizes into signal_monitoring.raw_signals (source='exa', status='pending')
  → 02_filter.mjs (not yet run on exa rows post-fix) → status='passed_icp' | 'filtered_out'
```

No polling, no manual step, no intermediate storage. One monitor = one persistent query Exa
re-runs on its own schedule; we only receive the webhook push.

---

## The 33 monitors

IDs and original queries: `exa/results/monitor_ids.json` (created 2026-06-02, never recreated).
Verified live via `GET https://api.exa.ai/monitors` on 2026-07-13 — **all 33 `status: "active"`**,
all with `webhook.url = "https://philippe.pamelacoreypc.com/api/exa-webhook"`, trigger
`{ type: "interval", period: "7d" }`.

7 categories × country:

| Category | Countries | Signal meaning |
|---|---|---|
| MA | DE, FR, NL, BE, CH, EU | Mergers & acquisitions |
| CLEVEL | DE, FR, NL, BE, DE7, FR7 | Leadership change (CEO/MD/HR Director) |
| EXPAND | DE, FR, NL, BE, EU | New facility / plant / production capacity |
| INVEST | DE, FR, EU | Funding raised / capital invested |
| CONTRACT | DE, FR | Major contract / partnership signed |
| NICHE | FN-DEFRBE, FN-NL, FOODBEV, JUST-FOOD, BAKINGBISCUIT, DAIRYREPORTER | Pinned to one trade-media domain (foodnavigator.com, foodbev.com, just-food.com, bakingbiscuit.com, dairyreporter.com) |
| SECTOR | DAIRY-DE, BAKERY-EU, INGREDIENTS, MEAT-DE, BEVERAGE-DE | Sub-industry-specific query |

Country label suffix maps to ISO code for the `raw_signals.country` column (`DE7`→`DE`, `FR7`→`FR`,
`EU`→`null`, others unchanged) — mapping lives in both `nextjs/src/app/api/exa-webhook/route.ts`
(`COUNTRY_MAP`) and `exa/scripts/backfill_monitor_runs.mjs`.

---

## What actually happens when a monitor fires

Confirmed empirically 2026-07-13 by creating a disposable test monitor pointed at a webhook
capture tool and manually triggering a run (`POST /monitors/{id}/trigger`, undocumented but
functional). **Exa's own docs do not show an example webhook payload** — this was reverse-engineered
from a real delivery, not read from documentation.

Exa POSTs an **event envelope**, not a flat body. Three event types hit the same URL:

```json
// 1. Fired once when a monitor is created or its config changes
{ "type": "monitor.created", "data": { "id": "...", "status": "active", "webhook": {...}, ... } }

// 2. Fired when a scheduled run starts
{ "type": "monitor.run.created", "data": { "id": "<runId>", "monitorId": "...", "status": "running", "output": null } }

// 3. Fired when a run finishes — THIS is the one with actual results
{
  "id": "event_...",
  "object": "event",
  "type": "monitor.run.completed",
  "data": {
    "id": "<runId>",
    "monitorId": "01kt44...",
    "status": "completed",
    "output": {
      "results": [
        { "id": "<url>", "url": "...", "title": "...", "author": "...", "image": "...", "publishedDate": "2026-07-01 15:35:51.000000000" }
      ],
      "content": "<AI-synthesized summary paragraph citing the results>",
      "grounding": [ { "field": "content", "citations": [...] } ]
    }
  },
  "createdAt": "..."
}
```

`GET /monitors/{id}/runs` (used for polling/backfill) returns the same `output.results` shape per run.

### The bug this uncovered

`nextjs/src/app/api/exa-webhook/route.ts` was written expecting a flat `{ monitorId, results }` body
— it silently 400'd (or worse, silently accepted-and-dropped, depending on the exact malformed shape)
every real delivery since the webhook was repointed away from n8n on 2026-06-22. All 33 monitors kept
firing weekly the entire time; **zero of those results ever reached `raw_signals`**. This was invisible
because Exa doesn't tell you a webhook consumer is rejecting deliveries — no retry-failure alerting
on our side either, and there was no Health page yet to surface it.

**Fixed 2026-07-13**: route now reads `body.data.monitorId` / `body.data.output.results`, and
explicitly acknowledges (200, no-op) `monitor.created` / `monitor.run.created` instead of erroring
on them.

### Signature verification — not currently possible, documented gap

Exa signs deliveries with an `exa-signature: t=<timestamp>,v1=<hmac>` header. The HMAC key
(`webhookSecret`) is returned **only once**, in the response body of the `POST /monitors` call that
created the monitor. The 33 production monitors were created 2026-06-02 — before this webhook route
existed — and that secret was never captured or stored anywhere. `PATCH /monitors/{id}` does not
re-issue it (verified: patching a monitor's webhook URL returns no `webhookSecret` field). The only
way to get a fresh secret is deleting and recreating all 33 monitors, which is not worth the
disruption (loses monitor-native run history, brief signal gap) for a single-user internal tool with
a non-public webhook URL. Current mitigation: reject any `monitorId` not in our own `MONITOR_LABELS`
map — not cryptographic, but stops anything not targeting one of our known monitor IDs.

---

## Backfill script — recovering what the bug lost

`exa/scripts/backfill_monitor_runs.mjs` — pulls `GET /monitors/{id}/runs` for all 33 monitors,
normalizes every result the same way the webhook route does, and upserts into `raw_signals`
(dedup on `client_id, source, external_id` — safe to re-run any time). Also writes one
`pipeline_runs` row per monitor (`script='exa_backfill'`) so each backfill pass is itself
auditable in the Runs panel.

**First run (2026-07-13)**: 202 API-visible runs across 33 monitors, 363 total results, **153
newly inserted** into `raw_signals` (210 were already present from the earlier 2026-06-22 manual
polling snapshot in `exa/results/all_runs_raw.json`, which is a static file — not this table).

Run it manually any time you suspect a gap (e.g. before the fix was deployed, or after any
future webhook outage):

```
node exa/scripts/backfill_monitor_runs.mjs
```

Requires `EXA_API_KEY` (root `Mastr_Leads/.env`) and `NEXT_PUBLIC_SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` (`nextjs/.env.local`).

---

## Current raw_signals state for source='exa' (as of 2026-07-13, post-backfill)

- **310 total rows** (157 pre-existing from the original 2026-06-22 manual push + 153 from this
  backfill)
- Status breakdown: `pending` 153 · `passed_icp` 148 · `filtered_out` 9 — the 153 pending rows are
  everything the backfill just inserted; `02_filter.mjs` hasn't run over them yet
- By `signal_type`: MA 63 · CLEVEL 61 · EXPAND 57 · SECTOR 40 · INVEST 36 · NICHE 35 · CONTRACT 18
- Newest `pub_date` in the table: 2026-07-07 (e.g. "Palacios Alimentación acquires Ñaming",
  monitor `MA|EU`; "Fortifi expands... acquisition of Deighton Manufacturing", `NICHE|FOODBEV`)

---

## Separate thing: Exa Finder (manual Search API, not monitors)

Tested 2026-06-29, unrelated to the monitor/webhook pipeline above — this is an on-demand
`POST /search` call, not a persistent monitor. Two use cases validated:

1. **Company description** (`includeDomains: [domain]`) — 10/10 success rate on a test batch, used
   to backfill ICP-scoring input for companies missing from the Blitz TAM.
2. **People search** (`category: "linkedin profile"`, 3 seniority tiers: exec / plant-ops / HR) —
   14/14 companies matched, avg 3-5 LinkedIn profiles per company per tier.

Motivation: 74% of signal companies (54/73 in the test batch) weren't in the Blitz TAM at all.
Exa Finder closes that gap for description + LinkedIn URLs; it does **not** return email — a
separate Blitz/pattern-inference step is still needed after it. Not wired into the pipeline yet;
recommended lookup order documented in `exa/EXA_NOTES.md` ("Recommended pipeline (new)" section)
is still the intended shape, just not implemented as code.

Cost: ~$0.035–0.042 per company (3 people-search + 2-3 company-search calls) — the historical
gap-fill for 54 companies was ~$2 total. Ongoing cost, if wired into the live pipeline, scales with
however many signal companies land outside the TAM cache per run.

---

## Cost summary (Exa API, all modes)

| Mode | $/week | $/month |
|---|---|---|
| Monitors (current — 33 active, automated) | $0.60 | $2.40 |
| Manual Search equivalent (no automation) | $0.23 | $0.92 |
| Exa Finder (one-off gap-fill, not recurring) | — | ~$2 per 54-company batch |

Exa Monitors API: $15/1k requests. Exa Search API: $7/1k requests (used by Finder).
