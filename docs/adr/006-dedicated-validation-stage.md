# 006 — Email validation as its own weekly stage, not inline-only

Date: 2026-07-18 · Migration: 006_email_validation.sql · Commits: 2d3ef71, 71d4474

## Context
Email validation (MV+BounceBan cascade, `validateEmail.mjs`) only ran
inline inside `route_email.mjs`, at send time, on whatever small batch was
about to be pushed. This left the majority of contacts with an email
(~115 of ~135 at the time) never independently validated — still on
Blitz's raw pattern-inference guess (`email_status = 'inferred'`). Leo's
explicit ask: validation must be automatic, cover ALL current contacts, and
be timestamped/visible, not a manual occasional script.

## Decision
- New stage `pipeline/stages/validate_contacts.mjs` — runs on the weekly
  cron, selects `email IS NOT NULL AND email_status <> 'invalid' AND
  (email_validated_at IS NULL OR >90 days stale)`, reuses the existing
  `validateEmail.mjs` cascade verbatim.
- `contacts.email_validated_at` / `email_validation_detail` (migration 006)
  — dedicated timestamp, since `updated_at` changes on any patch and can't
  answer "when was this specifically validated".
- `route_email.mjs` now trusts a fresh (`verified`, <90d) verdict instead
  of re-validating inline — inline validation becomes a safety net only for
  contacts the weekly stage hasn't reached yet, not the primary mechanism.

## Consequences
- 90-day re-check policy for anything not `invalid`; `invalid` is terminal
  (a dead mailbox that resurrects isn't worth re-spending credits on).
- First backfill run (2026-07-18) validated 339 contacts: 279 sendable
  (217 ok + 62 confirmed catch-all), 10 dead, 50 unknown — real spend,
  under $1 total.
- `/health` page (see ADR-008) surfaces validation coverage as a live query
  against `contacts.email_validated_at`, not a hand-maintained snapshot.
