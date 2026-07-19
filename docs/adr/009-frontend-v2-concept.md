# 009 — Frontend v2.0 concept: event summaries, single copy source, on-demand translation, flat status

Date: 2026-07-19 · Status: DESIGN AGREED, mockup in progress — no production code yet
Reviewed by: Fable (session 2026-07-19)

## Context
The live React frontend (`nextjs/src/app/page.tsx` + `Sidebar`/`LeadCard`)
predates migration 005/006 and several real UX gaps had accumulated:
sorted by the old raw `signals.score` instead of `companies.tier/rank`;
`email_status` type (`validated/invalid/no_email`) doesn't match what the
DB actually writes now (`verified/invalid/pending/inferred`); no visibility
into `channel_actions` state; tier/rank shown nowhere. Separately, the
product mockups (`mockups/database.html`, `settings.html`) use a considered
design language (indigo `#4F5FD1` accent, Lato, drawer pattern) the current
React app never adopted.

Leo reviewed a first interactive mockup (Artifact, real DMK/BRATA data,
LinkedIn 3-step progress tracker) and gave detailed feedback. Four design
questions were escalated to Fable for judgment before building further.

## Decisions

**D1 — Mockup process.** Real data throughout: many companies with light
list-only data (name/tier/industry/employee count/signal count), 1-2
companies with full real detail (contacts, events, outreach copy). No
fabricated companies. **No Artifact publishing unless asked directly** —
iterate on a local HTML file instead (faster to edit); this rule is now in
`CLAUDE.md`.

**D2 — Status model: flat, not a step-tracker.** The first mockup pass used
a rigid 3-step LinkedIn progress tracker (connect → qualify → propose call)
with forced "next step" advancement. Leo's own objection: real
conversations aren't linear (a contact might reply with an InMail directly,
skip steps, go sideways) — a forced stepper misrepresents reality and adds
friction Philippe won't tolerate. Reverted to the existing React app's flat
status row pattern (`new/sent/replied/meeting/pass`, one click, no
sequencing enforced) — but the matching playbook copy text (from ADR-005)
is shown contextually under whichever status is currently active, as a
copy-paste aid, not a gate.

**D3 — Event display: AI-summarized, not a raw signal-count.** Live finding
(DMK case, see ADR-002): "5 signals" on one event can be 3 genuinely
different sources plus 2 literal duplicates (same `source_url`, caught by
different Exa monitors). Decision: dedupe by `source_url` first; when ≥2
unique sources remain, generate one synthesis line via a new
`summarizeEvent()` call (same OpenRouter/claude-sonnet-4.5 infra as
`sameEvent()`); single-source events skip the LLM call entirely (summary =
the title, free). Computed once in `rank_leads.mjs`, written to a new
`signals.event_summary` column (on the anchor row only — event_key already
IS one member signal's id, no new table needed) — NOT file-cached only,
since the frontend reads the DB, not pipeline-local files. Each unique
source's URL is shown as a direct link (drill-down gap Leo flagged — the
data already existed, just wasn't surfaced).

**D4 — `copy_templates.json` becomes the single source of truth**, closing
the divergence flagged in ADR-005. Migration approach (Fable's correction
to an initial 10→6 key-collapse proposal, which would have broken the
EMAIL A/B/C variants that genuinely differ per key): keep all 9 existing
signal-type keys as-is; add `li_step1_connection` / `li_step2_qualify` PER
KEY (the 5 HIRING_* keys duplicate the same playbook text — accepted
duplication, zero risk to existing email logic); add `li_step3_call` and
`li_followup` as TOP-LEVEL fields, not per-key, because the playbook
deliberately made these universal across all signal types (ADR-005) — the
JSON structure should reflect that design intent, not flatten it away.
`route_email.mjs` is untouched by this migration; only the LinkedIn-reading
code (`build_linkedin_queue.mjs`, and the future frontend) changes.

**D5 — Translation: on-demand via a new `localizeMessage()`, not by
stretching `localizeHookLine()`.** `localizeHookLine()` (ADR-004) is
prompt-shaped specifically for a single short opening line (lowercase
style, terse). A sibling function handles full multi-line messages
(preserve line breaks, `{placeholders}`, and literal `[Calendly link]`
untouched), same `REGISTER_BY_LANG` map, cache key = hash(text+lang) so
identical step text across different events/companies dedupes automatically
rather than keying on (event+step+lang). UI: a "Translate" button next to
"Copy", English shown by default — not an automatic/forced translation.
**Build note for whoever implements this**: `copyEngine.mjs` is a pipeline
(Node) module, not reachable directly from the Next.js frontend on the VPS
— a thin `/api/translate` route (server-side OpenRouter call + DB cache)
is needed as the real integration point. Not needed for the mockup itself.

**D6 — `rank` (0-11) is an internal sort key only** — never rendered as a
raw number in the UI, used purely to order companies within a tier.
`tier`/`tier_reason` get a tooltip explaining what T1/T2/T3 and the reason
string mean, since neither is self-explanatory to Philippe.

## Consequences
- Requires migration 007 (`signals.event_summary` — not yet written).
- `copy_templates.json` migration touches data the live pipeline reads in
  production (`build_linkedin_queue.mjs`) — schema change, not cosmetic;
  needs the same care as any other production data migration.
- `localizeMessage()` + `/api/translate` are net-new build items, not
  covered by any existing HANDOFF/PLAN doc before this session.
