-- Migration 004: preserve full Exa data instead of the trimmed subset captured until now.
--
-- Context (2026-07-13 investigation, see docs/EXA_INTEGRATION.md):
-- 1. Cross-monitor duplicates were silently losing category attribution. Live analysis of all 33
--    monitors found 39 of 310 unique URLs (12.6%) get caught by 2+ DIFFERENT monitor categories
--    (e.g. one article caught by MA|DE + INVEST|DE + INVEST|EU + CONTRACT|DE + SECTOR|INGREDIENTS
--    simultaneously). The old unique(client_id, source, external_id) constraint kept only whichever
--    monitor's delivery landed first and discarded the other labels — making the PRD's "multi-signal
--    +2" scoring bonus impossible to compute, since the evidence of multiple categories was gone by
--    the time anything read raw_signals. Widening the key to include monitor_label fixes this.
-- 2. Within-monitor re-surfacing (same monitor re-finding the same URL in a later weekly run) was
--    checked and found to happen ZERO times across all 33 monitors' full run history — not a real
--    concern, no special handling added for it.
-- 3. Exa's per-run AI-synthesized digest ("content") and its citation list ("grounding") were never
--    persisted anywhere — thrown away by both the webhook route and the backfill script. These are
--    per-RUN, not per-article, so they belong on pipeline_runs (one row per run), not duplicated
--    onto every raw_signals row.
-- 4. contents.text (full article body, Markdown-formatted) is now requested on all 33 monitors
--    (enabled live via PATCH the same day) — previously no monitor had it enabled, so every
--    raw_signals.raw_data.text will be null for anything captured before this migration.

-- ── 1. monitor_label as a real column, not just raw_data->>'monitor_label' ─────────────────────
-- Default '' (not null) is deliberate: Postgres treats NULL as distinct from every other NULL in a
-- unique constraint, so nullable monitor_label would have silently stopped deduping non-Exa sources
-- (linkedin/stepstone/indeed/...) entirely. '' keeps their dedup behavior identical to before.
alter table signal_monitoring.raw_signals
  add column if not exists monitor_label text not null default '';

update signal_monitoring.raw_signals
  set monitor_label = coalesce(raw_data->>'monitor_label', '')
  where source = 'exa' and monitor_label = '';

-- ── 2. Widen the dedup key to (client_id, source, external_id, monitor_label) ──────────────────
-- Drop the old 3-column constraint (name as created by migration 003's inline `unique(...)`) and
-- replace it. Same real-world article caught by 5 different monitor categories now keeps 5 rows —
-- one per (monitor, url) pair — instead of collapsing to 1.
alter table signal_monitoring.raw_signals
  drop constraint if exists raw_signals_client_id_source_external_id_key;

alter table signal_monitoring.raw_signals
  add constraint raw_signals_dedup_key unique (client_id, source, external_id, monitor_label);

create index if not exists idx_raw_signals_monitor_label
  on signal_monitoring.raw_signals(monitor_label) where monitor_label <> '';

-- ── 3. Per-run digest storage on pipeline_runs ──────────────────────────────────────────────────
-- content = Exa's AI-synthesized paragraph for that run (plain text, numbered [n] citations, not
-- markdown/html). grounding = citation list backing that paragraph — confirmed via live testing to
-- sometimes reference MORE sources than the run's own results[] array (once saw a LinkedIn post
-- cited in grounding that never appeared in results at all). Both belong here, not on raw_signals,
-- since one digest covers every result in the run, not a single article.
alter table signal_monitoring.pipeline_runs
  add column if not exists digest text,
  add column if not exists digest_citations jsonb;
