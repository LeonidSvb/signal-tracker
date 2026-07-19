# Changelog

All notable changes to the Philippe Bosquillon signal monitoring system.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

---

## [Unreleased]

### Added — real frontend v2.0, Stages 1-8 (2026-07-19, docs/HANDOFF_2026-07-19_frontend_build.md)
The full real React rebuild against `mockups/signals_v2_concept.html`, executed stage by stage per the handoff, each stage gated on `tsc`/`next build`/`node --test`/`vitest` and committed separately (9 commits, `e0ebef1`..`13947ed`). Summary — see each stage's own commit message for full detail:
- **DB**: migrations 007 (`signals.event_summary`), 008 (`channel_actions` unique constraint widened to include `contact_id`), 009 (`contact_state`) — written, applied live via direct Postgres connection, verified via REST + a direct SQL constraint check. Real bug found and fixed in `route_email.mjs`/`build_linkedin_queue.mjs`: both built their dedup key before picking the contact, incompatible with the new per-contact key.
- **Events**: `summarizeEvent()` next to `sameEvent()` in `companyClassifier.mjs`, wired eagerly into `rank_leads.mjs`, cache-first. Verified with a real `--llm` run: 34 real events summarized, cache confirmed working on a second run (0 new LLM calls).
- **Copy**: the planned `copy_templates.json` migration turned out unnecessary — the real playbook (v2, 2026-07-17) already has no step-3/follow-up content, and the file/its consumers were already in sync. Added shape-validation tests instead, including an assertion that the stale planned field names never landed.
- **Translation**: `localizeMessage()` (full multi-line, preserves `{placeholders}`/`[bracket tokens]`) + `/api/translate` route, self-contained (not importing `copyEngine.mjs` — cross-boundary path-resolution risk). Verified with a real DE translation call.
- **Frontend foundation**: design system ported verbatim into `app-shell.css`; shared `Rail` component; old `LeadCard`/`Sidebar`/`ContactCard`/`Header`/`NotesLog` deleted; `lib/supabase.ts` + `useNotes()`'s realtime subscription kept unchanged. Two real incompatibilities found reusing outreach-cockpit's `DateRangePicker` (not silently copied): its `popover.tsx` depends on `@base-ui/react` (different library) — wrote a standard Radix `popover.tsx` instead; its trigger used Base UI's `render` prop — adapted to Radix's `asChild`.
- **Leads module**: slim sidebar select + lazy per-company detail fetch; `aggregateStatus()`/`resolveCompanyStatus()` (app_state fallback) and the sidebar filter predicate extracted as pure, vitest-tested functions; real per-contact outreach (status → `contact_state`, copy via new `/api/copy`, translation via `/api/translate`); real `channel_actions`-backed Activity tab. Found and fixed a real gap: the mockup's `meeting` status showed a fabricated "propose a call" script with no real playbook backing — replaced with an honest note.
- **Settings**: real page, ICP Filter promoted from an external link to a genuine inline panel (new `/api/icp-filter` route); Templates panel reads live `copy_templates.json` via new `GET /api/copy`, without the mockup's fabricated "Universal Step 3" block.
- **Analytics**: real page, `next/dynamic`-loaded (confirmed: 1.93kB route vs. the Leads page's 128kB — genuinely code-split). New `/api/analytics` route aggregates real `raw_signals` data. Disclosed scope reduction: the mockup's 4-segment funnel needs data (`raw_signals.company_id`/`contact_id`) that doesn't exist in the schema — built 2 honest real segments instead of 4 approximated ones.

### Fixed — Stage 9, the real Chrome visual/interactive pass (2026-07-19/20)
Ran once the browser extension connected. Found and fixed real bugs, each deployed the same session (commits `f5f4a44`..`a0c5929`):
- `/api/copy` + `/api/icp-filter` 500'd in prod — the Coolify Docker image never copied `pipeline/config/*.json` in; fixed the Dockerfile, and while there discovered the actual deploy topology was a dead-end trap (`scripts/deploy.ps1`→systemd never served the public domain, Coolify's Docker container always did) — deleted the dead path, wrote `docs/deploy.md`, rotated the exposed VPS password.
- Calendar had zero real CSS (cockpit's own `calendar.tsx` is Tailwind-v4-only syntax this project's v3.4 can't compile) — rewrote against the actual cockpit reference: 3-letter weekday labels, one uniform solid range fill, 27px cells, fixed locale (was leaking "май" from the browser), and swapped `captionLayout="dropdown"` (renders real un-stylable native `<select>`s) for plain text + the existing chevrons.
- Connection-note copy always read "...at , Lars" — `vars.company` was hardcoded to `""`.
- Analytics' funnel/volume charts silently dropped zero-signal days from the API response (fine at 60 days, broke completely at 7 — 1 bar instead of 7); rebuilt the chart layer on `recharts` with real clickable legends, a labeled Y-axis, and a zero-fill date range. Renamed "Exa Analytics" → "Analytics" (aggregates 6 sources).
- Two near-invisible chart colors (legend swatches, "Filtered/pending" bar) fixed to real, visible values.
- Status buttons (New/Sent/Replied/…) wrote to `contact_state` successfully every time but the UI never refreshed — `onStatusChanged` was a literal no-op. Added real `refetch()` to both list/detail hooks.
- A duplicate React key (`IcpFilterPanel`), a `<style>`-tag hydration mismatch (`HealthPanel`), and a missing `OPENROUTER_KEY` in Coolify's env store (translate 500'd) — all fixed/hotfixed.
- Health was a separate `/health` route with its own duplicate rail — folded into Settings as a third tab per Leo's call mid-pass (asked first, this was a real structural change).
- Also refreshed the pipeline's live VPS cron copy (`/opt/apps/projects/philippe-signals-pipeline/`) — it was still running the OLD 2-arg `channelActionKey()` against the NEW 3-column DB constraint from migration 008, a real live-production risk caught before it caused a bad dedup.

Full bug-by-bug detail: `TODO.txt`'s Stage 9 entry.

### Added
- `docs/PLAN_2026-07-19_react_migration_prep.md` — prep doc for the real React rebuild session: old-frontend keep/delete verdict, full field-by-field data-source audit of `signals_v2_concept.html` (what's live-real vs. needs a build step vs. currently mock), 7 pitfalls mined from outreach-cockpit's own past HTML→React port with concrete avoidance notes, and a suggested build order.
- Same doc, same-day update: §0 flags the 2 hardest open architecture questions (per-contact status storage, event-summary generation trigger) explicitly for a Fable session rather than deciding blind; §2.5 catalogs reusable components
- §0 questions resolved (Fable, same day): Q1 — per-contact CRM status gets a new additive `contact_state` table (migration 009) with `unique(client_id, contact_id)`; deriving from `channel_actions` rejected as semantically impossible (replied/meeting are human-observed outcomes, outreach mechanics can't produce them), widening `app_state` rejected as a mixed-grain footgun against live rows. Company chip = `aggregateStatus()` over `contact_state` with `app_state` fallback. Q2 — `event_summary` generated eagerly in `rank_leads.mjs` via `summarizeEvent()` next to `sameEvent()` (same model, same cache-first pattern); lazy generation rejected — it trades a new API route, a frontend OpenRouter key, and a visible first-open wait for pennies of savings on a cents-per-call model. from `outreach-cockpit` (`IconRail.tsx`, `DateRangePicker.tsx`, missing shadcn primitives — same shadcn/Radix/Tailwind foundation as ours) to avoid rebuilding them from scratch; §2.6 adds performance requirements (lazy-loading, route-level code splitting, slimmer initial fetch) so the rebuild matches real-SaaS load times instead of the current frontend's slow load.

### Fixed
- Real `/health` Next.js page had no persistent nav at all — added the same icon rail as the mockups (PB avatar, Leads → real `/`, Health active). Settings/Analytics rail icons intentionally NOT added yet since those aren't real Next.js routes (mockups only) — adding a rail icon to a page that doesn't exist would just be a second kind of dead link.
- `mockups/exa-analytics.html` had NO icon rail at all — just a floating X-close button back to settings.html. That's why the nav strip appeared to "disappear" when switching into Analytics. Added the same rail markup/order (avatar, Leads, Analytics active, spacer, Settings) used by settings.html and signals_v2_concept.html, matching reply-agent/inbox.html + settings.html's actually-identical rail across pages.
- Real `/health` page was missing an entire section: reply-agent's Health concept (CONCEPTS.md §6.7/6.8) keeps "Database tables" (MAX(write-timestamp) per table, no drilldown — a table has no "run" concept) separate from "Sync jobs"/pipeline stages (which DO get the Runs▾ drilldown). Ours only had the stages section. Added a Database tables card (9 real schema_monitoring tables, live MAX(timestamp) query per table, stale-after-14-days warn pill) to `api/health/route.ts` + `health/page.tsx`.

### Added — frontend v2.0 real build, Stages 1-3 (2026-07-19, docs/HANDOFF_2026-07-19_frontend_build.md)
- Migrations 007 (`signals.event_summary`), 008 (`channel_actions` unique constraint widened to `(client_id, company_id, contact_id, channel, event_key)`), 009 (`contact_state`, per-contact CRM status) — written, applied live via a direct Postgres connection through the SSH tunnel, and verified live via REST queries and a direct SQL constraint check.
- `summarizeEvent()` in `pipeline/lib/companyClassifier.mjs` — eager event-summary generation, wired into `rank_leads.mjs`. `uniqueSourceCount()`/`needsEventSummary()` in `eventGrouping.mjs`, unit tested (6 new tests). Verified with a real `--llm` dry run: 34 events summarized, cache-first confirmed working on a second run (34/34 from cache, 0 new LLM calls).
- Shape-validation tests for `copy_templates.json` (`pipeline/test/copyEngine.test.mjs`) — validates the real current LinkedIn-copy shape and asserts the originally-planned-but-stale field names (`li_step1_connection`/`li_step2_qualify`/`li_step3_call`/`li_followup`) never landed.

### Fixed — Stage 1
- `route_email.mjs` and `build_linkedin_queue.mjs` both built their `channelActionKey()` dedup lookup BEFORE picking which contact the action was for — harmless under the old company+event-only key, but migration 008's new key needs `contact_id` up front. Reordered both call sites so contact selection happens before the dedup lookup.
- `docs/SCHEMA.md` claimed migration 005 was "written, not applied to the live DB" — stale; verified live this session that 005 has been applied (tier/rank/event_key all populated on real rows). Corrected, and 007/008/009 + the widened `channel_actions` constraint documented.

### Added — Stage 4
- `localizeMessage()` in `pipeline/lib/copyEngine.mjs` — sibling of `localizeHookLine()`, translates a full multi-line message instead of just the hook line, preserving `{placeholders}` and literal `[bracket tokens]` (e.g. `[Calendly link]`) untouched. New `hashCacheKey()` export (sha256-based, `hash(text+lang)` per ADR-009 D5).
- `/api/translate` Next.js route — server-side OpenRouter call for the frontend's on-demand "Translate" button, deliberately self-contained rather than importing `copyEngine.mjs` (its file-path resolution breaks once Next.js bundles it elsewhere — flagged in ADR-009's own build note). In-memory cache at module level. Verified with a real translation call (DE, formal register, placeholders/brackets preserved) and a confirmed cache hit on repeat.

### Corrected — Stage 3 (was going to be a migration, turned out not to be)
- `copy_templates.json`'s planned migration (ADR-009 D4) was written against an OLD LinkedIn spec (v1, 2026-07-15). The real playbook was rewritten to v2 on 2026-07-17 (`clients/philippe-bosquillon/copy/copy_signals_linkedin.txt`) — explicitly "no follow-ups from Philippe," connection note + first message only, any reply routes to Leo. `copy_templates.json` and its consumers (`copyEngine.mjs`, `build_linkedin_queue.mjs`) were already re-transcribed to match v2 on 2026-07-17 — nothing needed migrating. Fabricating the planned `li_step3_call`/`li_followup` fields would have reintroduced the rigid step-tracker ADR-009's own D2 decision already rejected in the same document. ADR-009 D4 updated to record this.

### Changed
- Settings IA review: Analytics moved off Settings onto its own rail icon (data view, not config, both in `mockups/signals_v2_concept.html` and `mockups/settings.html`).
- Staleness Rules folded into the ICP Filter panel instead of being a separate page — same source file (`pipeline/config/icp_filter.json`'s `staleness_days`), so a second nav entry duplicated one config.
- `mockups/settings.html`'s ICP Filter panel rebuilt against the real live `icp_filter.json` (previously said "not created yet"; the file has been real and in production use since filter_icp.mjs shipped) — now a read-only preview, no fake editable inputs.
- Real `/health` page (`nextjs/src/app/health/`) gained a drill-down: each stage row can expand to a 7-day success rollup + last 5 runs with inline error text, replacing the standalone Runs page/panel — same table (`pipeline_runs`), one place to read it.

### Removed
- `mockups/settings.html`'s hand-maintained Runs + Health panels (dated 2026-06-26/07-13, predated cron and the real health page) — deleted, not superseded by a mockup duplicate.
- `mockups/database.html` retired from navigation — generic raw-table browser duplicating Supabase Table Editor, visually inconsistent with the rest of the product (Tailwind CDN vs the hand-styled token system elsewhere). File kept on disk for reference, unlinked everywhere.

### Fixed
- Corrected a wrong claim from the previous session: staleness windows are NOT unimplemented — `lib/staleness.mjs` reads `icp_filter.json`'s `staleness_days` live and is used in `filter_icp.mjs`, `rank_leads.mjs`, and `eventGrouping.mjs`. The "07_recalc_scores.mjs not implemented" warning in the old mockup was stale; that logic was folded into existing stages instead of a standalone script.

## [0.18.0] - 2026-07-19

Frontend v2.0 concept — designed and finalized through several review rounds
with Leo (real screenshots, real feedback each pass), backfilled as ADRs.
No production code changed this entry — deliverable is
`mockups/signals_v2_concept.html`, the reference for the real Next.js rebuild.

### Added
- `mockups/signals_v2_concept.html` — single-file concept covering the whole
  frontend: Leads (icon-rail + filter sidebar + compact row-list + company
  detail), Activity (module tab, built on real `channel_actions` rows),
  Settings (grouped sidebar, Templates rendered inline, everything else links
  to the real existing page instead of a third duplicate copy).
- `docs/adr/001` through `009` — new lightweight ADR system (Context/Decision/
  Consequences), backfilling every real architectural fork since 2026-07-15
  (two-channel split, event-key dedup, Jaccard-filter removal, copy model
  swap, LinkedIn 3-step redesign, dedicated validation stage, cron-triggered
  actors, VPS deployment) plus today's full frontend design record (ADR-009).
- `CLAUDE.md` rule: no Artifact publishing for mockup iteration unless asked
  directly — local HTML file instead, faster to edit.

### Fixed (found live while building the mockup, documented for the real build)
- DMK's "5 signals" was actually 3 real sources + 2 literal Exa-monitor
  duplicates of one URL — events now dedupe by `source_url` before display.
- `LeadCard.tsx`'s contact cap at 2 (same bug reproduced and fixed in the
  mockup) — contacts list is uncapped, compact rows instead of cards so it
  doesn't cost vertical space.
- `channel_actions.contact_id` exists as a column (migration 005) but isn't
  part of the unique constraint — two contacts at one company/event collide
  today. Outreach status needed to move to per-contact (Philippe realistically
  messages 2-3 people per company independently) — this is the real schema
  gap that surfaced, needs migration 008 before it's production-real.
- `.dot-sep`'s CSS rule (the separator dots in the company meta line) was lost
  in an earlier mockup rewrite — line rendered glued together, fixed.

### Design decisions (full reasoning: docs/adr/009-frontend-v2-concept.md)
- Flat status row (new/sent/replied/meeting/pass), not a forced LinkedIn
  step-tracker — reverted after Leo's own catch that real conversations
  aren't linear.
- Sidebar status filter collapses to an accordion (defaults to "All leads"),
  matching reply-agent/inbox.html's mix of one always-visible primary item
  plus collapsed secondary lists.
- Company-level status in the sidebar aggregates its contacts' statuses live:
  most-advanced wins, except "pass" only shows when EVERY contact has passed
  (one declined contact can't hide that another conversation is still active).
- Signal-origin filter (Exa / Job boards) added — verified live the two
  populations barely overlap (4 of 409 companies have both), so it's a real,
  non-redundant axis.
- Activity is a module tab next to Leads, not a separate rail destination —
  same relationship as reply-agent's Inbox/Overview split (Activity is what
  actually happened as a result of using Leads).

## [0.17.0] - 2026-07-18

Backend-hardening Phase 1 complete (docs/PLAN_2026-07-18_backend_hardening.md,
items 1-8): honest run logging, validation-in-pipeline, weekly/daily orchestrator,
health page, live discovery numbers. Split execution: Fable items 1-2+6, Sonnet
items 3-5+7-8. No live spend this phase.

### Fixed
- Dry runs no longer write `pipeline_runs` rows (`resolve_companies`,
  `classify_company`, `find_contacts_exa` had unconditional startRun/finishRun —
  root cause of the "6-second success" resolve_companies mystery from 2026-07-15:
  that row was a dry run logged as a real pass, meaning a live resolve_companies
  has in fact NEVER run). `route_email`/`rank_leads` were already correct.
- `lib/log.mjs` finishRun now persists the full `stats` jsonb (column existed,
  was always null — nothing ever wrote it).

### Added
- `db/migrations/006_email_validation.sql` — `contacts.email_validated_at` +
  `email_validation_detail` (NOT yet applied — needs the SSH tunnel + Leo's go).
- `pipeline/lib/emailValidationPolicy.mjs` — pure `needsValidation()` rule
  (90-day re-check, `invalid` terminal), shared by both validating stages.
- `pipeline/stages/validate_contacts.mjs` — dedicated weekly fleet-wide email
  validation stage over the proven MV+BounceBan cascade. Dry-run by default.
- `nextjs /health` page + `/api/health` route — latest pipeline_runs per stage +
  live email-validation coverage (approved scope exception, PLAN C-D6).
- `scripts/discovery/2026-07-18-layer0-hitrate.mjs` (F-1) — measured live:
  Layer-0 hit-rate 69.7% (398/571 free via sourcing.companies; 224 pass / 174
  reject among hits), 173 companies (30.3%) would need fresh Blitz/Exa spend.
- `scripts/discovery/2026-07-18-blitz-tam-backlog.mjs` (F-2, scope corrected:
  0_blitz/002+003 are Philippe's OWN harvest, not another niche's) — the 07-15
  "6,566 unscored" backlog is already essentially closed: 003 fully in
  sourcing.companies (3627/3627), 002 at 3970/4016, only 46 domains left.
  Backlog-scoring work removed from the plan.

### Changed
- `pipeline/run.mjs` rewritten into the cron orchestrator: `--weekly` / `--daily`
  chains, `--live` gate, stages spawned as child processes (the old import-based
  version made every stage parse the orchestrator's argv at module load). Weekly
  chain starts with scrape_jobs, which already triggers Apify actors itself via
  apify-key-pool rotation — no native Apify Schedules (Leo's key-rotation call).
  Rehearsal mode skips inherently-live stages entirely, runs flagged stages dry
  (verified live on the daily chain: rank_leads 87.7s + build_linkedin_queue 6.9s,
  zero spend). Orchestrator writes its own run_weekly/run_daily pipeline_runs row
  with per-stage status/duration in stats jsonb. 2h hard timeout per stage.
- `pipeline/stages/route_email.mjs` — trusts a fresh validate_contacts verdict
  (skips inline re-validation for `verified` + <90d contacts), stamps
  `email_validated_at` only when its own run actually called the cascade.

### Tests
- 39/39 (33 pre-existing + 6 new emailValidationPolicy).

## [0.16.0] - 2026-07-17/18

Full redesign of the client-facing outreach flow: LinkedIn and email split into
clearly distinct roles, a 3-step LinkedIn structure (connection → qualify → propose
call) replacing the old per-signal-type message pairs, and a bilingual EN/DE
reference doc for Philippe built through several iterative review passes.

### Changed
- LinkedIn outreach redesigned from "11 full connection+message pairs per signal
  type" to a 3-step universal structure: Step 1 (connection note, varies by signal —
  one intro line) → Step 2 (first message, ONE question tied to what the signal
  actually implies, not generic "still open?") → Step 3 (propose a call, fully
  universal text, only after a substantive reply to Step 2). Added an optional
  "deeper qualification" callout (decision-maker / role priority / timeline
  questions) for when a conversation is clearly engaged — explicitly excludes
  budget/comp, reserved for the actual call. Added a shared follow-up template
  (max 1-2 nudges per stuck step, 4-5 day cadence).
- Email reply-handling reframed to mirror the same qualify-then-propose-call shape
  (was: jump straight to a pitch). Booking is self-serve (prospect picks their own
  slot via a Calendly link) rather than manual time-finding. Corrected: the call-
  proposal step links to Philippe's calendar (not Leo's) and loops Philippe directly
  into the email thread at that point — he sees the full conversation, not a
  summary.
- Clarified ownership split explicitly: LinkedIn is 100% Philippe's own action (Leo
  has no access to his LinkedIn account, only supplies signal + contact + angle);
  email is 100% Leo's, shown to Philippe purely for situational awareness.

### Added
- `clients/philippe-bosquillon/docs/linkedin_email_flow_philippe_2026-07-17.html` —
  final EN/DE client-facing reference: the "why short messages" principle, one
  fully worked LinkedIn scenario, one fully worked email scenario, a compact table
  of what varies per signal type (6 rows, only Steps 1-2 differ), and short tips
  (Open Profile, InMail/Sales Navigator — deliberately left to Philippe's own
  judgment, no prescribed numbers; optional post-liking). Built after several
  review passes to avoid repeating the same 3-step explanation 6 times.
- `clients/philippe-bosquillon/docs/DRAFT_2026-07-17_linkedin_email_flow_v2.txt` —
  the working discussion draft this was designed through (kept for history/
  traceability of the design decisions above).
- `pipeline/lib/copyEngine.mjs` — model swapped `openai/gpt-oss-120b` ->
  `anthropic/claude-sonnet-4.5` for localization (gpt-oss-120b reads noticeably
  more literal/weaker on DE/FR/NL business copy per research; cost difference at
  this volume is cents/week). Prompt now explicitly instructs "localize, not
  translate word-for-word" + per-language register guidance. `{relevant_case}` is
  now a real fallback line (not a bare `[FILL IN]` marker) with a returned
  `usedFallbackCase` flag so callers can flag generic rows.
- `pipeline/lib/eventGrouping.mjs` + the duplicate inline clustering in
  `pipeline/stages/classify_company.mjs` — removed the Jaccard word-overlap
  pre-filter gating which same-company signal pairs reached the `sameEvent()` LLM
  call (found live on DMK Group: two headlines about the same €25m investment
  shared too few words to ever reach the LLM). Every same-company pair inside the
  date window is now a candidate; `sameEvent()` alone decides. 18/18
  `eventGrouping.test.mjs` tests pass (2 updated/added for this).
- `pipeline/stages/build_copy_review.mjs` — renders `copy_templates.json` (the
  actual production source) into one HTML page, email + LinkedIn side by side per
  signal type, zero-cost to rerun (lang forced to 'en', no OpenRouter calls) — the
  answer to "combine channels for review" without hand-duplicating content.
- `scripts/utils/api-balances.mjs` — one-command read-only Apify + BounceBan
  balance check, reusing existing per-service auth rather than reimplementing it.
- DeepL dropped entirely as an option (was "maybe test later" — decided: no).

## [0.15.0] - 2026-07-17 (part 3)

DeepL removed as an option entirely (Leo's call — not worth the discussion, drop
it), {relevant_case} got a real fallback instead of a bare instruction marker, and
a generated (not hand-maintained) HTML review combining email + LinkedIn copy per
signal type with real pipeline examples.

### Changed
- `clients/philippe-bosquillon/copy/copy_signals_linkedin.txt` — removed the DeepL
  mention entirely (was framed as "could test later" — Leo: no, drop it).
- `pipeline/lib/copyEngine.mjs` `fill()` — `{relevant_case}` now defaults to an
  honest, safe fallback line ("I've placed similar roles at comparable food
  companies in the region") instead of a bare `[FILL IN]` marker, when the caller
  doesn't supply one. Returns `usedFallbackCase: true/false` so callers can flag
  which rows are still generic.
- `pipeline/stages/build_linkedin_queue.mjs` — surfaces `usedFallbackCase` as a
  visible "generic case — worth personalizing" badge per row in the exported HTML,
  instead of silently shipping the fallback with no indication.

### Added
- `pipeline/stages/build_copy_review.mjs` — renders `copy_templates.json` (the
  actual production source copyEngine.mjs reads) into one static HTML page: email
  + LinkedIn side by side per signal type, fallback vs targeted `{relevant_case}`
  shown together to calibrate how specific that line should read, tagged REAL
  (grounded in an actual signal/company pulled from the DB 2026-07-17) or
  ILLUSTRATIVE (no real example on hand yet) per type — so nothing is presented as
  real when it isn't. Zero-cost to rerun (lang forced to 'en', no OpenRouter
  calls) — this is the answer to "combine email+LinkedIn review, don't hand-
  maintain a second doc": single source of truth, regenerated, not duplicated.
  Output: `docs/copy_review_2026-07-17.html`, also published as a Claude Artifact
  for easy viewing.

## [0.14.0] - 2026-07-17 (part 2)

Removed the free text pre-filter from event clustering (accuracy over token cost,
Leo's explicit call) + full LinkedIn copy rewrite based on Leo's v1 review comments
and research on translation models / LinkedIn outreach mechanics.

### Changed
- `pipeline/lib/eventGrouping.mjs` `findCandidateClusters()` + the duplicate inline
  version in `pipeline/stages/classify_company.mjs` — dropped the Jaccard word-
  overlap >=0.3 pre-filter that gated which same-company signal pairs even reached
  the `sameEvent()` LLM call. Found live on DMK Group (see [0.13.0]): "invests €25m
  in lactoferrin production..." vs "invests in German dairy plant" are probably the
  same story but share almost no significant words — the old filter silently never
  sent that pair to the LLM at all. Now every same-company pair inside the date
  window (7d in rank_leads, 4d in classify_company) becomes a cluster candidate;
  `sameEvent()` is the only judge. Cost impact: a few more LLM calls/week, cents.
  `pipeline/test/eventGrouping.test.mjs` updated (2 tests changed/added), 18/18
  pass. Note: dry-run mode without `--llm` still only uses cached verdicts —
  uncached clusters stay unmerged (`pendingLlm`), same as before.
- `pipeline/lib/copyEngine.mjs` — translation model swapped `openai/gpt-oss-120b` ->
  `anthropic/claude-sonnet-4.5` (per research: gpt-oss-120b reads as noticeably
  weaker/more literal on DE/FR/NL translation of short outreach copy; cost
  difference at this volume, ~50-200 translations/week, is cents). Localization
  prompt now explicitly instructs "localize, not translate word-for-word" +
  per-language register guidance (DE/FR formal Sie/vous for a first cold touch,
  NL can be more direct) instead of leaving register to the model's guess.
- `clients/philippe-bosquillon/copy/copy_signals_linkedin.txt` — full v2 rewrite
  (v1 was Fable's untouched 2026-07-15 draft, never reviewed). Leo's inline review
  comments folded in: removed the generic "30 years in food leadership" credential
  line that was byte-identical across every connection note (AI-tell + no real
  content); credentials moved to a new manual-fill `{relevant_case}` variable in
  the first message (Philippe/Leo picks something actually relevant per prospect,
  not auto-generated); every first message now ends on a light qualifying question
  ("still open?") instead of a direct call pitch; removed the literal "Thanks for
  connecting, {first_name}." opener repeated everywhere (varied per template now);
  rewrote the specific AI-sounding phrases Leo flagged ("that's exactly the level I
  place", "serious scaling", the "not X, it's Y" pattern in HIRING_STALE). Kept the
  connection note itself (not omitted) — research supports it for senior EU targets
  culturally + reply-rate impact after accept, though raw accept-rate data is
  genuinely mixed. Added a volume guideline (20-30 connection requests/day) and
  flagged that a single fixed template per type is a real "volume tax" risk at
  scale if this grows — not addressed yet, `{relevant_case}` is the only built-in
  variance today.
- `pipeline/config/copy_templates.json` — `li_connection_note`/`li_first_message`
  re-transcribed for all 11 signal types from the v2 file above. Email variants
  (A/B/C) intentionally left untouched — adapting them to the same principles is
  the next step, deliberately sequenced after LinkedIn per Leo's call.
- `pipeline/lib/copyEngine.mjs` `fill()` — `{relevant_case}` now renders as an
  explicit `[FILL IN — one relevant case/credential for THIS prospect, not a
  generic line]` marker when not supplied, instead of leaking the raw `{relevant_case}`
  token into exported copy.

### Added
- `scripts/utils/api-balances.mjs` — one-command read-only balance check (Apify
  5-account pool + BounceBan), reuses existing per-service check logic rather than
  reimplementing auth against either API.
- `clients/philippe-bosquillon/copy/linkedin_playbook_for_philippe.md` — draft
  client-facing (English) how-to-use guide: daily workflow, what `{relevant_case}`
  means and why it's manual, connection-note default, volume guidance, InMail
  eligibility, tier explanation. Not yet sent — Leo reviews first.

## [0.13.0] - 2026-07-17

Reconstructed + wrote up the 2026-07-15 evening scoring/routing build session (was
never committed or documented at the time — see signals/TODO.txt STATUS 2026-07-17
block for the full writeup). This entry covers only what changed TODAY on top of it.

### Fixed
- `pipeline/lib/channelActions.mjs` / `pipeline/stages/route_email.mjs` — the live
  `route_email.mjs --limit=20` run on 2026-07-15 wrote 20 `channel_actions` rows (17
  `skipped_no_campaign`, because PlusVibe campaigns don't exist yet). The candidate
  filter treated ANY existing row as terminal, so those 17 companies would have been
  silently unreachable forever once campaigns are created. Added
  `isRetryable()`/`upsertChannelAction()` — only `skipped_no_campaign` is retryable;
  `pushed`/`skipped_validation` stay terminal (validation verdicts don't change).
  Syntax-checked, no live re-test yet (needs a real run after D5 campaign creation).

### Verified live (read-only checks, 2026-07-17)
- Apify account balances: KAD2 $4.10 / STD $3.86 / KAD1 $5.00 / PIH $3.87 (4
  working keys) — healthy.
- BounceBan: 3094 credits remaining, pay-as-you-go, no subscription — healthy.
- The 2026-07-15 `route_email.mjs --live` run's MV+BounceBan validation cascade
  really did spend real money (~$0.016 Apify + 2 BounceBan credits) on 20 real
  contact emails — 17 sendable / 2 unknown / 1 dead. Confirmed no PlusVibe push
  happened (campaign_map empty, PV_API_KEY/PV_WORKSPACE_ID not configured) — zero
  emails actually sent to anyone.
- DMK Group event-grouping audited by hand: 10 signals -> 6 events is real, but 2 of
  those 6 are the same €25m lactoferrin investment reported by different outlets
  with different headlines days apart — the word-overlap clustering (A1) doesn't
  catch semantically-same/lexically-different headlines. Doesn't change DMK's tier
  (still correctly T1), inflates rank/multi-event bonus slightly. Documented in
  `clients/philippe-bosquillon/docs/REVIEW_2026-07-17_dmk_and_copy.txt`, not fixed.

### Added
- `clients/philippe-bosquillon/docs/REVIEW_2026-07-17_dmk_and_copy.txt` — human-
  readable review doc: the DMK event breakdown above, plus every signal type's
  email + LinkedIn (connection note + first message) copy side by side, for Leo to
  review `copy_signals_linkedin.txt` (drafted by Fable 2026-07-15, never reviewed)
  without having to read raw JSON.

## [0.11.0] - 2026-07-15 (part 4)

Q6 near-duplicate signal clustering built.

### Added
- `pipeline/lib/companyClassifier.mjs` `sameEvent()` — given a cluster of headlines, one LLM
  call groups the ones describing the same real-world event vs coincidentally sharing words.
- `pipeline/stages/classify_company.mjs` — free word-overlap heuristic (Jaccard >= 0.3 on
  title words, published within 4 days) narrows to plausible clusters before calling
  sameEvent() once per cluster (not per pair, so cost can't multiply back up). Confirmed
  same-event headlines fold into the existing exact-title dedup group, so they extract once
  and share the resolved company — same mechanism, same writeOne() path. Live-tested against
  the day's remaining pending signals (no crash); real behavioral validation needs a future
  multi-outlet-same-event case to actually exercise the clustering.

## [0.10.0] - 2026-07-15 (part 3)

Closed out the remaining enrichment gaps: email recovery for existing contacts, the
no-company-linkedin segment, the HTML report delivery, and the Q5 name-mismatch backlog.
Exa-signal coverage now: 230 companies, 172 with a contact, 116 with email.

### Added
- `find_contacts_exa.mjs` gained two new modes on top of the original zero-contact `gap`:
  `email_gap` (companies with a contact but no email — tops up 1-2 more people, never
  re-adds someone already known, seeds dedup from existing linkedin_urls) and
  `no_linkedin_gap` (companies where Blitz never resolved a company LinkedIn page at all —
  the person-search query only ever needed the company NAME, never linkedin_url, so this
  works the same way; 28/28 companies got a hit, actually a slightly higher email rate than
  the linkedin-confirmed segment).
- Data-driven contact cap (both find_contacts.mjs and find_contacts_exa.mjs): 3 contacts max
  per company, is_primary reserved for the first (highest cascade-priority) hit only. Capping
  loses just 6pp of email-discovery rate (63% -> 57%) vs no cap while cutting the volume that
  was reaching 9-15 contacts on some multinationals.
- `build_signal_report.mjs` finally run end to end (earlier attempts hit Supabase network
  flakiness, unrelated to the script) — output: C:/Users/79818/Downloads/
  philippe_exa_signals_2026-07-15.html, delivered to Leo.

### Resolved
- Q5 (name-mismatch limbo) — one-off LLM adjudication over the 15 mismatches from the day's
  reclassify_via_blitz.mjs run: 6 confirmed same-entity (Sodexo -> Pluxee France rebrand,
  Fisherman's Friend -> its real legal manufacturer, etc.) and reclassified with real data
  (all -> reject for independent reasons — wrong geography or industry once actually
  screened); 9 confirmed genuinely different domains, correctly left alone. One borderline
  call worth a human second look: ITM Entreprises/Groupement Mousquetaires.

### Found
- `raw_data.text` (full article Markdown) infrastructure is deployed (webhook route confirmed
  capturing `item.text`) but not yet populated in any of the 346 current passed_icp signals —
  either monitors haven't re-fired with the new contents.text:true config yet, or something's
  broken. Needs a recheck in a few days. See signals/TODO.txt.

## [0.9.0] - 2026-07-15 (part 2)

Applied the [0.8.0] classifier fix live for the first time, backfilled the linkedin_url sync
gap, and built a working Exa People Search contact-finding fallback. Exa-signal contact
coverage: 96 -> 144 of 230 companies (42% -> 62.6%).

### Added
- `pipeline/stages/backfill_linkedin_sync.mjs` — one-time, idempotent, syncs linkedin_url/
  employees/industry/about/hq_country from sourcing.companies into signal_monitoring.companies
  by domain match. Result: 79/571 -> 255/571 companies now have linkedin_url.
- `pipeline/stages/find_contacts_exa.mjs` — Exa People Search fallback for companies where
  Blitz's own cascade found zero contacts. Filters candidates by sourcing icp_status first
  (never spends on a known 'reject'), 3-tier search (exec/ops/HR), Blitz email retry on
  every found profile, disk-cached (exa/cache/people_search_cache.json,
  people_email_cache.json).
- `pipeline/stages/build_signal_report.mjs` — static HTML report generator for handing signal
  data to Philippe without the (currently-being-rebuilt) frontend. Not yet exercised end to
  end this session — see Fixed below.

### Fixed
- `pipeline/stages/find_contacts.mjs` — title-parsing bug: was preferring the raw LinkedIn
  headline over Blitz's structured `curExp.job_title`, backwards. Flipped priority, added more
  separator handling. Only fixes new contacts going forward (51 existing "unknown"-titled rows
  not backfilled).
- `pipeline/stages/find_contacts_exa.mjs` — two bugs caught during its own first live run: (1)
  inserted a `tier` field the `contacts` table doesn't have (folded into `source` as
  `exa_{tier}` instead — first batch's 202 rows all failed to insert, deleted and rerun after
  the fix); (2) was reading title from Exa's `.title` field (almost always just the person's
  name) instead of `.text` (where the real headline lives right after the markdown heading) —
  left title null for ~95% of contacts on the first successful-insert attempt. Also added a
  company-name-in-headline noise filter after finding "Acomo" search results matching an
  unrelated Ugandan school founder named Acomo Alice.

### Verified live (first real application of the [0.8.0] classifier, not just regression-tested)
- Ran `reclassify_via_blitz.mjs --live` on all 181 previously-resolved sourcing companies: 46
  changed status. Confirmed the flagship Grolsch fix applied for real (reject -> pass, "size
  501-1000... professional operation that can afford senior hires") plus 10 other geography-
  driven correct rejects (LIVEKINDLY, Nomad Foods, Huel, Mutti, Vilvi Group — all correctly
  flipped pass -> reject for being outside DE/FR/NL/BE/LU/CH/AT with no local-expansion signal).
- Found live: of the 84 exa-origin companies with linkedin_url but zero Blitz contacts, 48 were
  actually icp_status='reject' in sourcing (stale pre-fix verdicts) — running the reclassify
  above first avoided wasting ~55% of the Exa spend on companies Philippe won't pursue.
- find_contacts_exa.mjs test batch (15 companies) -> scaled to the full 50-company pass-
  filtered target list: 48/50 got >=1 contact (96%, matches the original 2026-06-29 14/14
  validation), 310 contacts, 88 with email. Known residual noise: generic/common company names
  ("Starck", "Direct Source International", "Traiteur de Paris") pull in unrelated companies
  sharing the word — distinctive names (Culinor, Eurolysine, Zertus) were clean. See
  signals/TODO.txt Q12(a) for full detail.

## [0.8.0] - 2026-07-15

Resolution pipeline Q1+Q2+Q3+Q4 merge (single classifier, resolve-all-then-choose) —
regression-tested against 4 real cached edge cases, all pass. Real TAM/contact gap audit.

### Changed
- `pipeline/lib/companyClassifier.mjs` — new `classifyCompany()` replaces the two divergent
  classifiers (`deterministicClassify` hard employee-count cutoff in `blitzEnrich.mjs`,
  `classifyIcp` LLM-only). One LLM call per signal: picks the outreach target among ALL
  resolved candidates AND screens ICP, given real evidence (Blitz LinkedIn data / own TAM
  DB / Exa about-text) instead of guessing off a headline alone. `blacklistHit()` stays the
  one deterministic pre-check (categorical, not numeric).
- `pipeline/lib/blitzEnrich.mjs` — `deterministicClassify()` removed; `blitzEmployees()`
  fixes the Grolsch bug (size-bracket midpoint now primary over `employees_on_linkedin`,
  which systematically undercounts).
- `pipeline/stages/classify_company.mjs` — resolves up to 4 plausible candidates per signal
  (was: only the LLM's first guess) BEFORE choosing — the Q4 fix for the 41%-of-mentions
  gap. Not-chosen resolved candidates get written back to `sourcing.companies` as
  `unscored` (data isn't wasted) instead of discarded; a Layer-0 hit with `unscored` status
  now gets a real screen instead of blind trust.
- `pipeline/stages/reclassify_via_blitz.mjs` — now spends OpenRouter (fractions of a cent/
  company) via `classifyCompany()` instead of being fully deterministic.

### Verified
- Regression test (cached data only, zero Blitz/Exa spend) on 4 known edge cases: Grolsch
  (was wrongly rejected on employees_on_linkedin=37 vs real size 501-1000) → now `pass`;
  Dry4Good (14-employee French food-tech, was wrongly rejected on raw headcount) → `pass`;
  synthetic Emma-mismatch (Nantes bakery headline resolving to Emma The Sleep Company,
  1267 employees) → `entity_mismatch=true`, `icp_status=reject`; Bleu-Blanc-Coeur
  (association, not a producer) → `reject`. 4/4 passed.

### Found — TAM data is mostly unprocessed local backlog, not a scraping gap
- `0_blitz/002_tam_50-200/tam_blitz.csv` is a RAW keyword-matched pool (4,535 companies,
  heavy noise — e.g. a real-estate trade magazine, a biodiversity NGO, a drone
  manufacturer all matched on loose keywords) — only 101 of those 4,535 were ever
  ICP-scored (46 passed). ~4,434 companies sit locally, fetched, never scored.
  `002`'s `manifest.json` claims employee_range `["11-50","51-200"]` combined
  (15,743 total) but the live `config.json` + actual CSV row count (4,535) show only
  `51-200` — the manifest is stale, `11-50` bracket data is not confirmed to exist.
- `0_blitz/003_tam_industry_nf/` (industry-tag filtered, much cleaner signal) has 7,268
  raw candidates, 5,136 scored (1,763 pass / 3,350 reject / 23 needs_website — 34% pass
  rate) — leaving ~2,132 unscored locally.
- Live `sourcing.companies` count (queried 2026-07-15): 11,941 total, 4,485 `pass`
  (the real usable TAM), 7,384 `reject`, 52 `needs_website`, 20 `unscored`. 97% already
  have `linkedin_url`, 89% have `employees`. Origin breakdown: 11,412 `blitz`, 329
  `apollo`, 20 `contact_import`, 180 `signal_monitoring_exa`.
- Contact gap: of 4,485 `pass` companies, 2,371 have ZERO contacts (2,355 of those already
  have `linkedin_url` and are find_contacts-ready with no further enrichment needed).
  Exa-signal-origin specifically: 180 companies, 57 passed ICP, 44 of those still lack a
  contact.
- Conclusion: the cheapest, fastest win is NOT a new Blitz harvest — it's scoring the
  ~6,566 already-fetched-but-unscored local candidates (002+003) with the new
  `classifyCompany()` (LLM-only cost, zero new Blitz/Exa calls) and running
  `find_contacts` against the 2,371-company backlog (Blitz is the unlimited-credit
  subscription, this is free beyond time). A genuinely new Blitz TAM scrape (e.g. a real
  11-50 bracket, industry-filtered like `003`) is a distinct, lower-priority next step.

## [0.7.1] - 2026-07-14

Exa Analytics mockup: daily-granularity charts + collapsible drill-down tables. No pipeline/schema changes this session.

### Changed
- `mockups/exa-analytics.html` — Weekly Activity bar chart replaced with two daily charts
  (60-day window, 2026-05-16..2026-07-14), skeleton ported wholesale from
  `outreach-cockpit/mockups/reply-agent/detailed-analytics.html` (persistent-DOM bars,
  ctrl+wheel zoom, per-boundary tooltip anchoring, smooth-spline lines, full date-range
  picker with presets + manual calendar range):
  - **Daily Signal Quality** — stacked funnel per day (raw → passed ICP → company resolved
    → contact found), Exa only, exclusive deltas computed from real cumulative counts.
  - **Signal Volume by Source** — one line per source (Exa/LinkedIn/Indeed/StepStone/Xing/
    Cadremploi) on the same day axis. Makes the 2026-06-22 job-board scraping cliff visible
    next to Exa's own (separately backfilled) gap — all five job-board actors' last
    `scraped_at` is 2026-06-22, i.e. `01_scrape_jobs.mjs` hasn't run since, unrelated to the
    Exa webhook incident.
  - Both **Monitor Performance** (Exa, 33 monitors) and new **Job Board Actors** (Apify,
    5 actors) tables collapsed by default behind a computed 1-line summary. Job Board
    Actors stays at actor granularity (not per-query — no per-query breakdown exists in
    `raw_signals`), columns swapped to match what actually varies for Apify (status,
    Apify key rotation, cadence) vs Exa (category, country). Drill-down lists each actor's
    configured queries from `config.json`/`ACTOR_NOTES.txt` as reference, not fabricated
    per-query counts.
  - 6-color source-line palette validated via the dataviz skill's `validate_palette.js`
    (CVD-safe, contrast pass).

### Found (not yet acted on)
- `04_find_contacts.mjs` (Blitz contact enrichment) has not run since 2026-06-26. Of the
  130 distinct companies behind Exa signals, only 3 have a contact — all three predate
  2026-06-26; every company recovered by the 2026-07-13 webhook-fix backfill (124 of them)
  has zero contact-finding attempts.
- Manual cross-reference (ad hoc SQL, not wired into any script) of the 130 Exa-signal
  companies against the separate `sourcing` schema's 11,793-company TAM base (see the
  outer Mastr_Leads repo's `clients/philippe-bosquillon/db/migrations/`) found 16
  name-matches, 8 of which already have contacts there for free — e.g. VION Food Group (9
  contacts), Crisp (9), Eurolysine (4). No code integration yet; `sourcing` and
  `signal_monitoring` remain two separate schemas on the same Supabase instance.

## [0.7.0] - 2026-07-13

Exa webhook incident (3-week silent outage) found and fixed, full-data-capture migration,
scoring bugs fixed, deployed to production. Full writeup: docs/EXA_INTEGRATION.md.

### Fixed
- `nextjs/src/app/api/exa-webhook/route.ts` — route expected a flat `{monitorId, results}`
  body; Exa actually sends an event envelope (`{type, data:{monitorId, output:{results,
  content, grounding}}}`). Confirmed empirically against a live test monitor — Exa's docs
  don't show an example payload. Zero exa rows had landed in `raw_signals` since the
  2026-06-22 webhook repoint away from n8n, despite all 33 monitors firing weekly the
  whole time. Also now acks (200, no-op) `monitor.created`/`monitor.run.created` instead
  of erroring on them.
- `pipeline/stages/05_score_llm.mjs` — two bugs: (1) `company_name` was hardcoded null for
  every Exa/news signal, so `03_resolve_companies.mjs` silently skipped all of them and
  `resolveCompany()` here searched against `''`; added one LLM call per news signal to
  extract company name + angle together. (2) numeric score used a job-posting exec-keyword
  regex against news headlines, which almost never matched — replaced with signal_type-based
  weighting (MA/CLEVEL +3, EXPAND/INVEST +2, else +1) + a multi-signal bonus. Verified live:
  198 signals re-scored, 195/198 (98.5%) resolved to a company, score distribution now
  spreads 1-8 instead of clustering at 1-4.
- `scripts/deploy.ps1` — `$NEXTJS_DIR` pointed at `scripts/nextjs` (never existed) since the
  script moved into `scripts/` on 2026-06-26; every deploy attempt since then failed at the
  build step. Also the server `.env` this script writes was missing
  `SUPABASE_SERVICE_ROLE_KEY`, which the webhook route requires.

### Added
- `exa/scripts/backfill_monitor_runs.mjs` — pulls `GET /monitors/{id}/runs` for all 33
  monitors, upserts into `raw_signals`, logs a `pipeline_runs` row per monitor. Recovered
  153 signals the broken webhook had silently dropped.
- `db/migrations/004_exa_full_capture.sql` — `raw_signals.monitor_label` real column, dedup
  key widened to `(client_id, source, external_id, monitor_label)`. Live analysis of all 33
  monitors found 39 of 310 unique URLs (12.6%) get caught by 2+ different monitor categories
  at once — the old 3-column key kept only whichever monitor's delivery landed first,
  discarding the others' category attribution and making the PRD's multi-signal scoring
  bonus impossible to compute. `pipeline_runs.digest`/`digest_citations` columns added for
  Exa's per-run AI-synthesized summary, previously thrown away entirely.
- `contents.text: true` enabled on all 33 production monitors (was on none) — full article
  body (Markdown-formatted) now captured per signal instead of headline-only. Takes effect
  from each monitor's next scheduled run (2026-07-14 onward).
- `docs/EXA_INTEGRATION.md` — current architecture + full incident writeup, supersedes the
  n8n/Google-Sheets-era content in `exa/EXA_NOTES.md`.
- `mockups/database.html`, `mockups/settings.html`, `mockups/exa-analytics.html` — new
  Database (TAM explorer), Settings (ICP Filter/Staleness Rules/Runs/Health), and Exa
  Analytics pages, built on real production data.

### Known gaps (not fixed this session)
- `calcExpires()` in `05_score_llm.mjs` hardcodes 30 days for all news signals regardless of
  `signal_type`, ignoring `icp_filter.json`'s per-type staleness windows (MA:90/CLEVEL:30/
  EXPAND:60/INVEST:60) that `02_filter.mjs` already respects correctly.
- Webhook signature verification (`exa-signature` header) isn't possible for the 33
  production monitors — their `webhookSecret` was only returned once at creation (2026-06-02,
  before this route existed) and was never captured; `PATCH` doesn't re-issue it.

## [0.6.0] - 2026-06-29

Full TAM expansion (003 batch) + MV+BB email validation pipeline + shared utils.

### Added
- `scripts/validation/validate-mv-apify.py` — Million Verifier via Apify VJ5w50TP6mAbyimyO, batch mode (300/run), key rotation, cache
- `scripts/validation/validate-catchall-apify.py` — Catch-all via BlitzAPI actor XdSG0jjZbmrqwcUwV, concurrent (15)
- `scripts/validation/validate-catchall-bounceban.py` — BounceBan bulk API с `--balance`, `--route-only`, `--recheck` флагами
- `scripts/validation/validate-mailsso.py` — mails.so batch validation (переименован из validate_emails.py)
- `scripts/validation/validate-million-verifier.py` — manual MV upload flow (`--prepare` / `--results`)
- `scripts/validation/pipelines/mv-then-bounceban.py` — оркестратор: MV → BB на catch_all → merge final
- `scripts/utils/apify-key-pool.mjs` — shared JS util: loadKeyPool / pickKey / apifyRun (5 аккаунтов)
- `scripts/utils/apify_key_pool.py` — Python эквивалент того же
- `clients/philippe-bosquillon/prompts/icp_check_v4_micro.txt` — ultra-strict ICP для 25-50 emp (default reject)
- `clients/philippe-bosquillon/prompts/icp_check_v5_decisive.txt` — needs_website re-score + exa_worth_it flag
- `scripts/discovery/2026-06-29-rescore-by-size.cjs` — hard cut <25 emp, size-based ICP prompt routing
- `scripts/discovery/2026-06-29-merge-003-to-db.cjs` — merge contacts_003_raw.jsonl → master_contacts.jsonl
- `scripts/discovery/2026-06-29-export-003-emails.cjs` — export emails → Downloads + validation meta

### Changed
- `clients/philippe-bosquillon/signals/pipeline/stages/01_scrape_jobs.mjs` — extracted key pool to scripts/utils, removed 80+ lines inline
- `clients/philippe-bosquillon/TODO_MASTER.txt` — 1B/1C/2C validation marked DONE, 2D unblocked

### Results
- 003 TAM batch: 7,268 scraped → 5,136 new after dedup → DB 6,832 → 11,968 total
- ICP rescore: pass=4,443 | reject=7,503 | needs_website=21
- 1B contact finding: 1,666 cos → 1,030 contacts → 301 emails
- 1C contact finding: 1,676 cos → 845 contacts → 354 emails
- MV+BB pipeline (672 emails): ok=470 | catchall_BB=92 | unknown=77 | dead=33 → sendable=562
- Apify accounts: 4/5 working (KAD2=$4.10, STD=$4.10, KAD1=$4.17, PIH=$4.16; LEO=unpaid invoice)
- BounceBan: 95 catchall → 92 deliverable | 3,428 credits remaining

## [0.5.0] - 2026-06-29

TAM DB built + Exa Finder API validated as primary contact-finding fallback.

### Added
- `clients/philippe-bosquillon/db/` — TAM intelligence database
  - `README.md` — описание всех файлов и lookup логики
  - `TAM_ENRICHMENT_STRATEGY.txt` — полный intersection анализ (73 сигнальных компании: 19 в DB, 54 нет), 10 архитектурных улучшений
  - `blitz_all_scored.jsonl` — 6,773 компаний из Blitz (полный universe, ICP scored)
  - `apollo_all_scored.jsonl` — 673 компании из Apollo (pass+reject+unscored)
  - `tam_companies.jsonl` — 2,953 ICP pass компаний (объединённый)
  - `master_contacts.jsonl` — 2,064 контактов (L3:1577, risky:205, L2:282)
  - `apollo_contacts.jsonl` — 1,308 Apollo контактов
- `clients/philippe-bosquillon/TODO_MASTER.txt` — мастер TODO на все работы по Philippe
- `clients/philippe-bosquillon/copy/copy_signals_v2.txt` — полный copy playbook
  - 5 типов job board сигналов (HIRING_EXEC/MID/SURGE/STALE/RECRUITER)
  - 5 типов Exa news сигналов (CLEVEL/M&A/EXPAND/INVEST/CONTRACT)
  - Для каждого: 2-3 email варианта + LinkedIn + cold call скрипт + 3-5 фоллоу-апов
- `signals/exa/test_cat1.json` — 4 Cat1 компании (ICP pass в Blitz, нет контактов)
- `signals/exa/test_cat2.json` — 60 Cat2 компаний (не в DB, ICP неизвестен)
- `signals/exa/test_finder.cjs` — Exa Finder test: company description + people search
- `signals/exa/blitz_email_test.cjs` — Blitz /enrichment/email тест на LinkedIn URL из Exa
- `signals/pipeline/stages/02_filter.mjs` — ICP фильтр по blacklist + keyword
- `signals/pipeline/stages/03_resolve_companies.mjs` — LinkedIn company resolver
- `signals/pipeline/stages/04_find_contacts.mjs` — contact finding stage
- `signals/pipeline/stages/05_score_llm.mjs` — LLM ICP scoring stage
- `signals/pipeline/run.mjs` — pipeline orchestrator
- `signals/scripts/` — утилиты для signals pipeline
- `scripts/discovery/2026-06-29-build-tam-db.cjs` — скрипт сборки TAM DB
- `scripts/discovery/2026-06-29-build-blitz-scored.cjs` — Blitz scored JSONL builder
- `scripts/discovery/2026-06-29-build-final-jsonl.cjs` — финальный JSONL для leads
- `scripts/discovery/2026-06-29-score-apollo-unscored.cjs` — ICP scoring Apollo unscored
- `blitz/scripts/source_resolve_companies.js` — Blitz company resolver

### Changed
- `signals/exa/EXA_NOTES.md` — добавлен раздел "Exa Finder API — Test Results (2026-06-29)"
- `signals/CLAUDE.md` — обновлён под новую структуру pipeline + db/
- `signals/pipeline/lib/supabase.mjs` — добавлены helper функции для bulk insert

### Research results (Exa Finder test — 14 companies)
- **Company description:** 10/10 (100%) — domain → includeDomains → full description
- **People search:** 14/14 (100%) — category "linkedin profile" → 13 LinkedIn URLs/company
- **Blitz email enrichment:** 45% overall (exec 41%, ops 52%, hr 41%)
  - Big companies (100+ emp): 54-92% email hit rate
  - Small companies (<100 emp): 0-33%
- **Cost:** ~$0.021 Exa per company (people only) + $0 Blitz (unlimited plan)
- **Recommended pipeline:** signal → DB lookup → if not found: Exa company desc → LLM ICP → Exa people → Blitz email

## [0.4.0] - 2026-06-26

Structure cleanup + DB schema fixes. Build passes, no functional changes.

### Added
- `db/migrations/` — миграции переехали из `nextjs/supabase/migrations/` в корень проекта
- `exa/clients/philippe-bosquillon.json` — monitor_id маппинг вынесен из кода в файл (документация)
- `pipeline/clients/_template.json` — шаблон клиентского конфига с дефолтами
- `pipeline/clients/philippe-bosquillon.json` — полный конфиг Philippe (ICP, sources, copy, sequencer)
- `pipeline/config/blacklist.json` — детальный блэклист (переехал из корня)
- `scripts/deploy.ps1` — деплой скрипт (переехал из корня)
- `scripts/discovery/` — одноразовые скрипты с датами в именах (переехали из `job_boards/`)
- `docs/SCHEMA.md` — документация всех таблиц БД с полями и описаниями
- `docs/OVERVIEW.md` — высокоуровневый документ: что это, зачем, архитектурные решения

### Changed
- `CLAUDE.md` — обновлён под новую структуру
- `TODO.txt` — task 12 (useLeads rewrite) помечен done, пути миграций обновлены
- `todo.txt` → `TODO.txt` (регистр)

### Fixed (DB schema — 003_monitoring_schema.sql)
- `notes.author` — убран `check (author in ('leo', 'philippe'))`, теперь free text (мультиклиент)
- `signals.meta jsonb` — добавлено для экспериментальных полей
- `companies.meta jsonb` — добавлено для экспериментальных полей

### Added
- `pipeline/` directory with import_historical.mjs, normalize functions
- `nextjs/supabase/migrations/002_new_schema.sql` — schema v2 (companies/signals/contacts/raw_signals)
- `nextjs/supabase/migrations/003_monitoring_schema.sql` — pipeline_runs monitoring table
- `nextjs/src/app/api/` — API routes directory

### Changed
- Architecture reset: dropped n8n → Google Sheets, moving to direct Supabase pipeline
- `app/` archived, new `pipeline/` orchestrator planned

---

## [0.3.0] - 2026-06-24

Signal tracker frontend rewritten to work with normalized schema.

### Fixed
- `useLeads.ts` rewritten to query `signal_monitoring` schema — joins companies + signals + contacts + app_state client-side
- Infinite loading bug eliminated — `setLoading(false)` now always runs via try/finally
- Tracker now shows only companies that have at least one signal (was showing all companies)
- `days_ago` calculated dynamically from `pub_date`; falls back to stored value when date is missing
- `AppState` and `Note` types updated: `lead_id` → `company_id`

---

## [0.2.0] - 2026-06-15

Auto-deploy pipeline on Coolify. Project restructured into monorepo layout.

### Added
- Root `Dockerfile` that builds from `nextjs/` subfolder
- `CLAUDE.md` — project rules and session context
- `docs/ARCHITECTURE.md` — full system map (Exa + job boards + Supabase + Next.js)
- `docs/SIGNALS_REGISTRY.md` — signal types, scoring, routing rules
- `docs/budget.md` — API cost estimates
- `docs/enrichment-services-research.md` — enrichment vendor comparison
- Job boards: `linkedin/`, `indeed/`, `stepstone/`, `xing/`, `cadremploi/` — each with config.json, run_test.mjs, ACTOR_NOTES.txt
- `job_boards/run_pipeline.py` — orchestration script for all actors
- `job_boards/build_output.py` — signal aggregation from raw Apify results
- `exa/EXA_NOTES.md` + all 33-monitor test scripts
- `career_pages/` — ChangeDetection.io integration scripts + LLM classifier
- `nextjs/supabase/migrations/001_initial.sql` — initial DB schema
- `TODO.txt` — project task list with session history

### Changed
- All Next.js files moved from repo root into `nextjs/` subfolder
- `.gitignore` updated: added `nextjs/src/app` unignore rule, added job board exclusions

### Fixed
- Dockerfile: added `ARG` declarations for `NEXT_PUBLIC_*` build-time env vars
- Dockerfile: switched `npm ci` → `npm install` for lock-file compatibility
- Dockerfile: removed non-existent `public/` dir copy step
- Dockerfile: `WORKDIR` corrected to `/build/nextjs` after subfolder move
- Stale root-level Next.js files deleted after move to subfolder
- `.gitignore` root `app/` rule was blocking `nextjs/src/app/` from being tracked — fixed with negation rule

### Verified
- Coolify GitHub App auto-deploy triggered on push
- Webhook auto-deploy working end-to-end
- Webhook with secret header validated

---

## [0.1.0] - 2026-06-15

Initial commit — Next.js signal tracker app.

### Added
- `nextjs/` — Next.js 14 app with Tailwind + shadcn/ui
- Components: `LeadCard`, `ContactCard`, `Header`, `Sidebar`, `NotesLog`
- `useLeads.ts` hook — fetches leads from Supabase
- `src/lib/types.ts` — Lead, Contact, Signal, AppState, Note types
- `src/lib/supabase.ts` — Supabase client init
- `.env.example`, `Dockerfile`, `next.config.js`, `tailwind.config.ts`

---

## Pre-Git History (Sessions 1–9)

Reconstructed from session notes in TODO.txt.

| Session | Date | Summary |
|---------|------|---------|
| S1 | 2026-05-29 | Exa scan — 33 queries, 164 results, 9 TAM hits, 16 lead cards created |
| S2 | 2026-05-31 | Job board RSS/API testing — all direct APIs blocked, Apify Indeed validated |
| S3 | 2026-06-02 | 33 Exa monitors created, n8n workflow `0WmBVaYBGDUMfPSl` built, end-to-end test passed |
| S4 | 2026-06-06 | n8n → Google Sheets live, Blitz enrichment pipeline built, 23 final leads delivered |
| S5 | 2026-06-08 | LinkedIn Apify actor tested — 26 ICP signals, actor selected |
| S6 | 2026-06-08 | StepStone / Xing / Cadremploi / APEC tested, architecture finalized |
| S7 | 2026-06-09 | Indeed FR validated, NL/BE boards tested (broken), 287 signals CSV exported |
| S8 | 2026-06-19 | Apify MCP installed, Philippe LinkedIn profile analyzed |
| S9 | 2026-06-22 | Architecture reset: dropped n8n/Sheets, PRD written, DB schema v2 designed, import_historical.mjs scaffolded, old app/ archived |
