-- Signal Tracker — Initial Schema
-- Run via: psql -h localhost -p 5434 -U postgres -d postgres -f 001_initial.sql
-- (requires SSH tunnel: ssh -L 5434:localhost:5434 leonid@152.53.194.162 -N)

-- Clients
create table if not exists clients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  created_at timestamptz default now()
);

insert into clients (name, slug) values ('Philippe Bosquillon', 'philippe-bosquillon')
on conflict (slug) do nothing;

-- Leads
create table if not exists leads (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid references clients(id) on delete cascade,
  company_name         text not null,
  company_linkedin_url text,
  company_domain       text,
  company_industry     text,
  company_employees    int,
  company_hq_country   text,
  company_about        text,
  company_snapshot     text,
  signal_title         text,
  signal_source        text,
  signal_pub_date      date,
  signal_days_ago      int,
  signal_country       text,
  signal_url           text,
  signal_narrative     text,
  angle                text,
  icp_score            int,
  score                int,
  contacts             jsonb default '[]',
  all_signals          jsonb default '[]',
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

create index if not exists leads_client_id_idx on leads(client_id);
create index if not exists leads_score_idx on leads(score desc);

-- App state (per lead, per user)
create table if not exists app_state (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid references leads(id) on delete cascade,
  client_id   uuid references clients(id) on delete cascade,
  status      text not null default 'new'
                check (status in ('new','sent','replied','meeting','pass')),
  updated_at  timestamptz default now(),
  updated_by  text default 'leo',
  unique (lead_id)
);

create index if not exists app_state_lead_id_idx on app_state(lead_id);
create index if not exists app_state_client_status_idx on app_state(client_id, status);

-- Notes (append-only conversation log per lead)
create table if not exists notes (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid references leads(id) on delete cascade,
  client_id   uuid references clients(id) on delete cascade,
  author      text not null check (author in ('leo','philippe')),
  body        text not null,
  created_at  timestamptz default now()
);

create index if not exists notes_lead_id_idx on notes(lead_id, created_at);

-- Pipeline runs (monitoring)
create table if not exists pipeline_runs (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references clients(id) on delete cascade,
  script        text not null,
  status        text not null default 'running'
                  check (status in ('running','success','error')),
  rows_scraped  int default 0,
  rows_enriched int default 0,
  errors        jsonb default '[]',
  started_at    timestamptz default now(),
  finished_at   timestamptz,
  meta          jsonb default '{}'
);

-- Trigger: auto-update leads.updated_at
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists leads_updated_at on leads;
create trigger leads_updated_at
  before update on leads
  for each row execute function update_updated_at();

-- RLS (enable after testing)
-- alter table leads enable row level security;
-- alter table app_state enable row level security;
-- alter table notes enable row level security;
-- create policy "read by client" on leads for select using (true);
-- create policy "write by service role only" on leads for all using (auth.role() = 'service_role');
