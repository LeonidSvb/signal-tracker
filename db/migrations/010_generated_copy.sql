-- Migration 010: generated_copy — server-side cache for AI-generated outreach copy
--
-- /api/copy was calling generateHookBridge() (OpenRouter LLM call) on EVERY
-- contact-row open, with no persistence — found live 2026-08-17: latency
-- ranged 7-13s per call (gpt-oss-120b with the real prompt shape), and the
-- same fact/company got re-generated (paying + waiting again) every time a
-- browser tab reloaded or a different contact at the same company was opened.
-- The AI output is grounded in the COMPANY's fact/signal, not the individual
-- contact — {first_name} is filled in afterward as a literal placeholder —
-- so one cached row per (company, channel, li_mode, fact) serves every
-- contact at that company, and every future page load, forever (until the
-- underlying signal changes, which changes fact_hash and just writes a new row).
--
-- fact_hash = md5(resolved_template_key || fact || hook_context) computed in
-- route.ts — deterministic on the INPUT the AI saw, so a new/different signal
-- naturally misses the cache and regenerates once, while re-opening the same
-- signal's copy never re-calls the LLM.
--
-- Apply (Leo, at the tunnel — see signals/CLAUDE.md "DB — как применять миграции"):
--   ssh -i ~/.ssh/id_ed25519_hostinger -L 5434:localhost:5434 leonid@152.53.194.162 -N
--   psql -h localhost -p 5434 -U postgres -d postgres -f db/migrations/010_generated_copy.sql

create table if not exists signal_monitoring.generated_copy (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references signal_monitoring.clients(id)   on delete cascade,
  company_id   uuid references signal_monitoring.companies(id) on delete cascade,
  channel      text not null check (channel in ('linkedin', 'email')),
  li_mode      text not null default 'na' check (li_mode in ('connect_note', 'connect_no_note', 'inmail', 'na')),  -- 'na' (not NULL) so the unique constraint below actually dedupes email rows — Postgres treats NULL as distinct from NULL
  fact_hash    text not null,
  connect      text,
  qualify      text,
  initial      text,
  followup     text,
  reply_qualify text,
  subject      text,
  variant_used text,
  source       text not null,  -- 'ai' | 'static_fallback' — mirrors /api/copy's existing response field
  created_at   timestamptz default now(),
  unique (company_id, channel, li_mode, fact_hash)
);

create index if not exists idx_generated_copy_lookup
  on signal_monitoring.generated_copy(company_id, channel, li_mode, fact_hash);
