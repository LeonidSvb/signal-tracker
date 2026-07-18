-- Migration 006: email validation tracking (B-D2 in
-- docs/PLAN_2026-07-18_backend_hardening.md)
--
-- contacts had no way to answer "when was this email last validated" —
-- updated_at changes on ANY patch (e.g. a title correction), not just
-- validation. Adds a dedicated timestamp + verdict detail, same shape
-- convention as channel_actions.detail (migration 005).
--
-- Apply (Leo, at the tunnel — see signals/CLAUDE.md "DB — как применять миграции"):
--   ssh -i ~/.ssh/id_ed25519_hostinger -L 5434:localhost:5434 leonid@152.53.194.162 -N
--   psql -h localhost -p 5434 -U postgres -d postgres -f db/migrations/006_email_validation.sql

alter table signal_monitoring.contacts
  add column if not exists email_validated_at      timestamptz,
  add column if not exists email_validation_detail  jsonb;

create index if not exists idx_contacts_email_validated_at
  on signal_monitoring.contacts(client_id, email_validated_at);
