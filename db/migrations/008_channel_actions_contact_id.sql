-- Migration 008: channel_actions unique constraint widened to include contact_id
-- (found live 2026-07-19, tracked in TODO.txt; confirmed via a live REST query
--  this session — channel_actions already HAS contact_id populated on real rows
--  from the 2026-07-15 route_email.mjs run, e.g. two different contacts at the
--  same company/event today collide on the OLD constraint).
--
-- OLD: unique (client_id, company_id, channel, event_key)
--   → two different contacts getting outreach for the same company+event
--     collide — only one of them can have a row.
-- NEW: unique (client_id, company_id, contact_id, channel, event_key)
--   → each contact's outreach state is tracked independently, matching how
--     Philippe actually works multiple contacts per company (mockup's
--     per-contact outreach panel, DMK has 5 contacts wired).
--
-- Migration 005's constraint was declared inline (unnamed), so Postgres
-- auto-generated its name. Rather than guess that name, this migration finds
-- it dynamically by matching the exact old column set and drops whichever
-- constraint that turns out to be — safe to re-run (idempotent: does nothing
-- if the old 4-column constraint is already gone).
--
-- pipeline/lib/channelActions.mjs's channelActionKey() must be updated in the
-- same commit as this migration (companyId::contactId::eventKey, was
-- companyId::eventKey) — the JS-side key shape mirrors the DB constraint and
-- both need to change together or the idempotency check silently drifts from
-- what the DB actually enforces.
--
-- contact_id is nullable (fk ... on delete set null) but every real INSERT
-- path always populates it (verified live: route_email.mjs and
-- build_linkedin_queue.mjs both pass contactId: contact.id on every call,
-- 2026-07-19) — NULL only appears retroactively if a contact row is later
-- deleted. Postgres treats NULLs as distinct in unique constraints, so this
-- doesn't reopen the collision bug for the normal write path; it would only
-- stop enforcing uniqueness for rows whose contact was deleted after the
-- fact, an acceptable edge case (not the bug this migration fixes).
--
-- Apply (Leo, at the tunnel — see signals/CLAUDE.md "DB — как применять миграции"):
--   ssh -i ~/.ssh/id_ed25519_hostinger -L 5434:localhost:5434 leonid@152.53.194.162 -N
--   psql -h localhost -p 5434 -U postgres -d postgres -f db/migrations/008_channel_actions_contact_id.sql

do $$
declare
  old_constraint_name text;
begin
  select con.conname into old_constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'signal_monitoring'
    and rel.relname = 'channel_actions'
    and con.contype = 'u'
    and (
      select array_agg(attname order by attname)
      from pg_attribute
      where attrelid = con.conrelid
        and attnum = any(con.conkey)
    ) = array['channel', 'client_id', 'company_id', 'event_key']::name[];

  if old_constraint_name is not null then
    execute format('alter table signal_monitoring.channel_actions drop constraint %I', old_constraint_name);
  end if;
end $$;

alter table signal_monitoring.channel_actions
  add constraint channel_actions_client_company_contact_channel_event_key
  unique (client_id, company_id, contact_id, channel, event_key);
