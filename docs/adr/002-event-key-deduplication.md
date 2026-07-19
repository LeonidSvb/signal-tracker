# 002 — Score and route by grouped events, not raw signal rows

Date: 2026-07-15 · Migration: 005_scoring_routing.sql · Commit: d2ce659

## Context
A single real-world happening (e.g. one company's investment announcement)
gets caught multiple times: different Exa monitors catching the same
article, or different outlets covering the same event with different
headlines. Scoring/routing on raw `signals` rows double-counts and would
double-fire outreach for what is, to Philippe, one thing worth reaching out
about once.

## Decision
`signals.event_key` (migration 005) — a deterministic event id (lowest
member signal's uuid at grouping time) written by `rank_leads.mjs`. Several
`signals` rows describing the same event share one `event_key`. Scoring
(`companies.tier/rank`) and channel idempotency (`channel_actions`) both key
off events, not raw signal count.

Grouping method: union-find over (same `source_url`) ∪ (same normalized
title) ∪ (LLM-confirmed `sameEvent()` verdict within a date window) — see
ADR-003 for the pre-filter history on that last step.

## Consequences
- One company can have multiple *events* over time (a hiring event in March,
  an M&A event in June) — each fires outreach independently, by design.
- Within one event, member signals may still have genuinely different
  `source_url`s (real independent press coverage) vs literal duplicates
  (same URL, different monitor) — the UI needs to distinguish these two
  cases when displaying "N signals" (found live 2026-07-19, see ADR-009).
- `channel_actions` UNIQUE constraint is `(client_id, company_id, channel,
  event_key)` — a new event for an already-contacted company fires again
  correctly; the same event never double-fires.
