-- Signal System v2 — Normalized Schema
-- Replaces flat `leads` table with: raw_signals + companies + signals + contacts
-- Run via psql (SSH tunnel required):
--   ssh -i ~/.ssh/id_ed25519_hostinger -L 5434:localhost:5434 leonid@152.53.194.162 -N
--   psql -h localhost -p 5434 -U postgres -d postgres -f 002_new_schema.sql

-- ── Drop old tables ──────────────────────────────────────────────────────────
drop table if exists notes cascade;
drop table if exists app_state cascade;
drop table if exists leads cascade;

-- ── Companies (deduplicated, one row per company forever) ────────────────────
create table if not exists companies (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid references clients(id) on delete cascade,
  name              text not null,
  linkedin_url      text,
  domain            text,
  industry          text,
  employees         int,
  hq_country        text,
  about             text,
  blitz_data        jsonb,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  unique(client_id, linkedin_url)
);

-- ── Raw signals (everything from scrapers, before and after ICP filter) ──────
create table if not exists raw_signals (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid references clients(id) on delete cascade,
  run_id            uuid,               -- FK to pipeline_runs added after
  source            text not null,      -- linkedin | stepstone | xing | cadremploi | indeed | exa
  source_type       text not null,      -- hiring | news
  external_id       text not null,      -- job_id or article URL (dedup key)
  raw_data          jsonb not null,     -- full original object from actor/Exa
  company_name      text,               -- normalized company name
  source_url        text,               -- link to job posting or article
  pub_date          date,
  country           text,               -- DE | FR | NL | BE | LU | CH | AT
  status            text default 'pending',  -- pending | passed_icp | filtered_out
  filter_reason     text,              -- why it was filtered out
  scraped_at        timestamptz default now(),
  unique(client_id, source, external_id)
);

-- ── Processed signals (passed ICP, scored, enriched) ────────────────────────
create table if not exists signals (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid references clients(id) on delete cascade,
  company_id        uuid references companies(id) on delete cascade,
  raw_signal_id     uuid references raw_signals(id) on delete set null,
  signal_type       text,   -- HIRING | MA | CLEVEL | EXPAND | INVEST | CONTRACT
  title             text,
  source            text,
  source_url        text,
  pub_date          date,
  days_ago          int,
  country           text,
  score             int default 0,
  freshness_score   int default 0,
  status            text default 'active',  -- active | stale | filled | expired
  expires_at        timestamptz,
  narrative         text,   -- LLM: what this signal means for executive search
  angle             text,   -- LLM: outreach angle for Philippe
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- ── Contacts (per company, enriched) ────────────────────────────────────────
create table if not exists contacts (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid references clients(id) on delete cascade,
  company_id        uuid references companies(id) on delete cascade,
  first_name        text,
  last_name         text,
  full_name         text,
  title             text,
  linkedin_url      text,
  email             text,
  email_status      text,  -- verified | inferred | invalid | pending
  phone             text,
  is_primary        bool default false,
  source            text,  -- blitz | pattern_inferred | manual
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- ── App state (CRM, one row per company per client) ──────────────────────────
create table if not exists app_state (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid references clients(id) on delete cascade,
  company_id        uuid references companies(id) on delete cascade,
  status            text default 'new' check (status in ('new','sent','replied','meeting','pass')),
  updated_at        timestamptz default now(),
  updated_by        text default 'leo',
  unique(client_id, company_id)
);

-- ── Notes (append-only log) ──────────────────────────────────────────────────
create table if not exists notes (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid references clients(id) on delete cascade,
  company_id        uuid references companies(id) on delete cascade,
  author            text check (author in ('leo', 'philippe')),
  body              text not null,
  created_at        timestamptz default now()
);

-- ── Pipeline runs (observability) ────────────────────────────────────────────
-- Already exists — add missing columns
alter table pipeline_runs add column if not exists source text;
alter table pipeline_runs add column if not exists rows_passed_icp int;
alter table pipeline_runs add column if not exists rows_pushed int;

-- Add FK from raw_signals to pipeline_runs
alter table raw_signals
  add constraint fk_raw_signals_run
  foreign key (run_id) references pipeline_runs(id) on delete set null;

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists idx_companies_client     on companies(client_id);
create index if not exists idx_companies_linkedin   on companies(linkedin_url);
create index if not exists idx_raw_signals_client   on raw_signals(client_id);
create index if not exists idx_raw_signals_source   on raw_signals(source);
create index if not exists idx_raw_signals_status   on raw_signals(status);
create index if not exists idx_raw_signals_ext      on raw_signals(source, external_id);
create index if not exists idx_signals_client       on signals(client_id);
create index if not exists idx_signals_company      on signals(company_id);
create index if not exists idx_signals_score        on signals(score desc);
create index if not exists idx_signals_status       on signals(status);
create index if not exists idx_contacts_company     on contacts(company_id);
create index if not exists idx_app_state_company    on app_state(company_id);
create index if not exists idx_notes_company        on notes(company_id, created_at);

-- ── updated_at triggers ──────────────────────────────────────────────────────
create or replace function update_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger trg_companies_updated
  before update on companies for each row execute function update_updated_at();
create trigger trg_signals_updated
  before update on signals for each row execute function update_updated_at();
create trigger trg_contacts_updated
  before update on contacts for each row execute function update_updated_at();
create trigger trg_app_state_updated
  before update on app_state for each row execute function update_updated_at();
