-- Migration 003: move all signal tables from public в†’ signal_monitoring schema
-- Run via: ssh leonid@152.53.194.162 then docker exec supabase-db psql -U postgres -d postgres -f /tmp/003_signal_monitoring_schema.sql

-- в”Ђв”Ђ 1. Create schema + grant access to API roles в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
create schema if not exists signal_monitoring;

grant usage on schema signal_monitoring to anon, authenticated, service_role;
alter default privileges in schema signal_monitoring
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema signal_monitoring
  grant all on sequences to anon, authenticated, service_role;

-- в”Ђв”Ђ 2. Create tables in signal_monitoring schema в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

create table if not exists signal_monitoring.clients (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  created_at  timestamptz default now()
);

create table if not exists signal_monitoring.pipeline_runs (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid references signal_monitoring.clients(id) on delete cascade,
  script          text not null,
  source          text,
  status          text default 'running',
  started_at      timestamptz default now(),
  finished_at     timestamptz,
  rows_scraped    int,
  rows_passed_icp int,
  rows_pushed     int,
  errors          jsonb,
  stats           jsonb
);

create table if not exists signal_monitoring.companies (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references signal_monitoring.clients(id) on delete cascade,
  name         text not null,
  linkedin_url text,
  domain       text,
  industry     text,
  employees    int,
  hq_country   text,
  about        text,
  blitz_data   jsonb,
  meta         jsonb,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique(client_id, linkedin_url)
);

create table if not exists signal_monitoring.raw_signals (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references signal_monitoring.clients(id) on delete cascade,
  run_id      uuid references signal_monitoring.pipeline_runs(id) on delete set null,
  source      text not null,
  source_type text not null,
  external_id text not null,
  raw_data    jsonb not null,
  company_name text,
  source_url  text,
  pub_date    date,
  country     text,
  status      text default 'pending',
  filter_reason text,
  scraped_at  timestamptz default now(),
  unique(client_id, source, external_id)
);

create table if not exists signal_monitoring.signals (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid references signal_monitoring.clients(id) on delete cascade,
  company_id      uuid references signal_monitoring.companies(id) on delete cascade,
  raw_signal_id   uuid references signal_monitoring.raw_signals(id) on delete set null,
  signal_type     text,
  title           text,
  source          text,
  source_url      text,
  pub_date        date,
  days_ago        int,
  country         text,
  score           int default 0,
  freshness_score int default 0,
  status          text default 'active',
  expires_at      timestamptz,
  narrative       text,
  angle           text,
  meta            jsonb,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create table if not exists signal_monitoring.contacts (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references signal_monitoring.clients(id) on delete cascade,
  company_id   uuid references signal_monitoring.companies(id) on delete cascade,
  first_name   text,
  last_name    text,
  full_name    text,
  title        text,
  linkedin_url text,
  email        text,
  email_status text,
  phone        text,
  is_primary   bool default false,
  source       text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create table if not exists signal_monitoring.app_state (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid references signal_monitoring.clients(id) on delete cascade,
  company_id uuid references signal_monitoring.companies(id) on delete cascade,
  status     text default 'new' check (status in ('new','sent','replied','meeting','pass')),
  updated_at timestamptz default now(),
  updated_by text default 'leo',
  unique(client_id, company_id)
);

create table if not exists signal_monitoring.notes (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid references signal_monitoring.clients(id) on delete cascade,
  company_id uuid references signal_monitoring.companies(id) on delete cascade,
  author     text not null,
  body       text not null,
  created_at timestamptz default now()
);

-- в”Ђв”Ђ 3. Migrate existing data from public в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
insert into signal_monitoring.clients select * from public.clients on conflict do nothing;
insert into signal_monitoring.raw_signals select * from public.raw_signals on conflict do nothing;

-- в”Ђв”Ђ 4. Drop old public tables (our ones only вЂ” leave skool/tg/communities) в”Ђв”Ђв”Ђв”Ђ
drop table if exists public.notes cascade;
drop table if exists public.app_state cascade;
drop table if exists public.signals cascade;
drop table if exists public.contacts cascade;
drop table if exists public.raw_signals cascade;
drop table if exists public.companies cascade;
drop table if exists public.pipeline_runs cascade;
drop table if exists public.clients cascade;

-- в”Ђв”Ђ 5. Indexes в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
create index if not exists idx_companies_client     on signal_monitoring.companies(client_id);
create index if not exists idx_companies_linkedin   on signal_monitoring.companies(linkedin_url);
create index if not exists idx_raw_signals_client   on signal_monitoring.raw_signals(client_id);
create index if not exists idx_raw_signals_source   on signal_monitoring.raw_signals(source);
create index if not exists idx_raw_signals_status   on signal_monitoring.raw_signals(status);
create index if not exists idx_raw_signals_ext      on signal_monitoring.raw_signals(source, external_id);
create index if not exists idx_signals_client       on signal_monitoring.signals(client_id);
create index if not exists idx_signals_company      on signal_monitoring.signals(company_id);
create index if not exists idx_signals_score        on signal_monitoring.signals(score desc);
create index if not exists idx_signals_status       on signal_monitoring.signals(status);
create index if not exists idx_contacts_company     on signal_monitoring.contacts(company_id);
create index if not exists idx_app_state_company    on signal_monitoring.app_state(company_id);
create index if not exists idx_notes_company        on signal_monitoring.notes(company_id, created_at);

-- в”Ђв”Ђ 6. updated_at trigger (create in signal_monitoring schema) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
create or replace function signal_monitoring.update_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger trg_companies_updated
  before update on signal_monitoring.companies for each row execute function signal_monitoring.update_updated_at();
create trigger trg_signals_updated
  before update on signal_monitoring.signals for each row execute function signal_monitoring.update_updated_at();
create trigger trg_contacts_updated
  before update on signal_monitoring.contacts for each row execute function signal_monitoring.update_updated_at();
create trigger trg_app_state_updated
  before update on signal_monitoring.app_state for each row execute function signal_monitoring.update_updated_at();

