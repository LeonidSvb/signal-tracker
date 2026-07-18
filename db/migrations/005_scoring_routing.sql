-- Migration 005: scoring/tiering + two-channel routing state
-- (B1 + A7 in clients/philippe-bosquillon/docs/HANDOFF_2026-07-15_scoring_two_channel.md)
--
-- Adds:
--   1. signals.event_key — deterministic event id (lowest member signal uuid at grouping
--      time), written by pipeline/stages/rank_leads.mjs. Several signals rows describing
--      the SAME real-world event (same source_url across monitors / same normalized title /
--      Q6 near-dup cluster confirmed by sameEvent()) share one event_key, so scoring and
--      channel idempotency count EVENTS, not raw signal rows (A1: DMK's "9 signals" are one
--      plant investment).
--   2. companies.tier/rank/tier_reason/ranked_at — company-level tier (T1/T2/T3 or NULL
--      with tier_reason 'icp_reject'/'needs_screen'/'no_fresh_event') + 0-11 rank for
--      ordering within tier (A2). Written by rank_leads.mjs --live on every daily run.
--   3. channel_actions — one row per (company, channel, event): both channels' idempotency
--      + audit state (A7). Same event never double-fires on a channel; a NEW event for the
--      same company fires again by design.
--
-- Apply (Leo, at the tunnel — see signals/CLAUDE.md "DB — как применять миграции"):
--   ssh -i ~/.ssh/id_ed25519_hostinger -L 5434:localhost:5434 leonid@152.53.194.162 -N
--   psql -h localhost -p 5434 -U postgres -d postgres -f db/migrations/005_scoring_routing.sql

-- ── 1. signals.event_key ────────────────────────────────────────────────────────────────
alter table signal_monitoring.signals
  add column if not exists event_key text;

create index if not exists idx_signals_client_event_key
  on signal_monitoring.signals(client_id, event_key);

-- ── 2. companies tier/rank ──────────────────────────────────────────────────────────────
alter table signal_monitoring.companies
  add column if not exists tier        text,
  add column if not exists rank        int,
  add column if not exists tier_reason text,
  add column if not exists ranked_at   timestamptz;

create index if not exists idx_companies_client_tier
  on signal_monitoring.companies(client_id, tier);

-- ── 3. channel_actions (A7) ─────────────────────────────────────────────────────────────
create table if not exists signal_monitoring.channel_actions (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid references signal_monitoring.clients(id)   on delete cascade,
  company_id uuid references signal_monitoring.companies(id) on delete cascade,
  contact_id uuid references signal_monitoring.contacts(id)  on delete set null,
  event_key  text not null,
  channel    text not null check (channel in ('email', 'linkedin')),
  -- email:    'validated' | 'pushed' | 'skipped_no_email' | 'skipped_validation'
  -- linkedin: 'queued' | 'exported' | 'done' | 'skipped'
  status     text not null,
  detail     jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (client_id, company_id, channel, event_key)
);

create index if not exists idx_channel_actions_company
  on signal_monitoring.channel_actions(company_id, channel);

-- updated_at trigger, same pattern as migration 003
create trigger trg_channel_actions_updated
  before update on signal_monitoring.channel_actions
  for each row execute function signal_monitoring.update_updated_at();
