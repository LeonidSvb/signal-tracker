-- Migration 007: signals.event_summary
-- (D3 in docs/adr/009-frontend-v2-concept.md; Q2 in
--  docs/PLAN_2026-07-19_react_migration_prep.md §0)
--
-- Adds:
--   signals.event_summary — one-line AI synthesis of a multi-source event
--   ("DMK is investing €25m in lactoferrin production — confirmed by 3
--   independent outlets"), written by a new summarizeEvent() function
--   (pipeline/lib/companyClassifier.mjs, next to sameEvent()) and called
--   EAGERLY from rank_leads.mjs whenever an event_key group has >=2 unique
--   source_urls. Single-source events keep event_summary = NULL and the
--   frontend falls back to the signal's own title — no LLM call spent on
--   events nobody would read a summary for anyway.
--
--   Denormalized onto ALL member rows sharing one event_key (same pattern
--   as event_key itself), not just the anchor row — lets the frontend read
--   event_summary directly off any signals row without a second join back
--   to a "find the anchor" step.
--
-- Apply (Leo, at the tunnel — see signals/CLAUDE.md "DB — как применять миграции"):
--   ssh -i ~/.ssh/id_ed25519_hostinger -L 5434:localhost:5434 leonid@152.53.194.162 -N
--   psql -h localhost -p 5434 -U postgres -d postgres -f db/migrations/007_event_summary.sql

alter table signal_monitoring.signals
  add column if not exists event_summary text;
