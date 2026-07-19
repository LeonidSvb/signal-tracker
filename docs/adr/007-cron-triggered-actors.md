# 007 — Apify actors triggered by our own cron + key pool, not native Apify Schedules

Date: 2026-07-18 · Commit: d14478c (`pipeline/run.mjs`)

## Context
Job-board scraping (5 Apify actors) had never run on any recurring
schedule — every run was manually triggered from Leo's Windows machine.
Apify has a native platform feature (Actor Schedules) that could run each
actor on a cron directly inside the Apify console, no code needed. Initial
plan (in `HANDOFF_2026-07-18_backend_hardening.md`) proposed using it.

## Decision — reversed the initial plan
Leo's objection: native Apify Schedules live inside ONE Apify account.
The project's key rotation (`scripts/utils/apify-key-pool.mjs`, 4 keys,
picks whichever has budget) can't apply to a schedule that's pinned to a
single account — a drained account would need manual schedule migration.
Decision: the weekly orchestrator (`pipeline/run.mjs --weekly`) starts each
green actor itself through the Apify API using the existing pool rotation,
then proceeds to the downstream stages once scraping lands. No native
Schedules, no webhook-on-completion — the cron IS the trigger and the
sequencer in one.

## Consequences
- Simpler mental model than originally planned: "the weekly chain starts
  with `scrape_jobs`, which already knows how to rotate keys" — no separate
  actor-trigger step needed, `scrape_jobs.mjs` already did this.
- No debounce/aggregation logic needed for 5 actors finishing at different
  times — sequential execution inside one cron job handles it naturally.
- Daily cadence (`rank_leads` + `build_linkedin_queue`) touches zero Apify
  — confirmed cost-neutral relative to a weekly-only design, since fresh-
  signal ranking is DB reads + LLM tokens on new signals only.
