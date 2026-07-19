-- Migration 009: contact_state — per-contact CRM status
-- (Q1 in docs/PLAN_2026-07-19_react_migration_prep.md §0)
--
-- The mockup's per-contact statusState (new/sent/replied/meeting/pass) has
-- no home in the existing schema:
--   - app_state is scoped to (client_id, company_id) — wrong grain, one row
--     per company, not per contact. It also has LIVE rows Leo/Philippe
--     already set in the old frontend — not safe to widen/repurpose.
--   - channel_actions.status is a DIFFERENT vocabulary describing outreach
--     MECHANICS the machine performed (validated/pushed/skipped_* for
--     email, queued/exported/done/skipped for LinkedIn) — it cannot express
--     "Philippe saw a reply", because the machine never observes replies.
--
-- contact_state is additive, not a repurposing of either table. app_state
-- is left untouched and keeps backing the OLD frontend until cutover; the
-- new frontend reads contact_state per contact, aggregating up to a
-- company-level chip via the mockup's aggregateStatus() (most-advanced-wins,
-- 'pass' only if EVERY contact has passed) — WITH a fallback to
-- app_state.status for any company that has zero contact_state rows yet, so
-- every status already set by a human keeps displaying correctly through
-- the transition. Retiring app_state entirely is a later, explicit step —
-- not done here.
--
-- Apply (Leo, at the tunnel — see signals/CLAUDE.md "DB — как применять миграции"):
--   ssh -i ~/.ssh/id_ed25519_hostinger -L 5434:localhost:5434 leonid@152.53.194.162 -N
--   psql -h localhost -p 5434 -U postgres -d postgres -f db/migrations/009_contact_state.sql

create table if not exists signal_monitoring.contact_state (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid references signal_monitoring.clients(id)   on delete cascade,
  company_id uuid references signal_monitoring.companies(id) on delete cascade,  -- denormalized, cheap joins (same pattern as notes/channel_actions)
  contact_id uuid references signal_monitoring.contacts(id)  on delete cascade,
  status     text not null check (status in ('new', 'sent', 'replied', 'meeting', 'pass')),
  updated_by text,
  updated_at timestamptz default now(),
  unique (client_id, contact_id)
);

create index if not exists idx_contact_state_company
  on signal_monitoring.contact_state(company_id);

-- updated_at trigger, same pattern as migrations 003/005
create trigger trg_contact_state_updated
  before update on signal_monitoring.contact_state
  for each row execute function signal_monitoring.update_updated_at();
