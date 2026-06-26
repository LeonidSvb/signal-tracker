# Changelog

All notable changes to the Philippe Bosquillon signal monitoring system.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

---

## [Unreleased]

## [0.4.0] - 2026-06-26

Structure cleanup + DB schema fixes. Build passes, no functional changes.

### Added
- `db/migrations/` — миграции переехали из `nextjs/supabase/migrations/` в корень проекта
- `exa/clients/philippe-bosquillon.json` — monitor_id маппинг вынесен из кода в файл (документация)
- `pipeline/clients/_template.json` — шаблон клиентского конфига с дефолтами
- `pipeline/clients/philippe-bosquillon.json` — полный конфиг Philippe (ICP, sources, copy, sequencer)
- `pipeline/config/blacklist.json` — детальный блэклист (переехал из корня)
- `scripts/deploy.ps1` — деплой скрипт (переехал из корня)
- `scripts/discovery/` — одноразовые скрипты с датами в именах (переехали из `job_boards/`)
- `docs/SCHEMA.md` — документация всех таблиц БД с полями и описаниями
- `docs/OVERVIEW.md` — высокоуровневый документ: что это, зачем, архитектурные решения

### Changed
- `CLAUDE.md` — обновлён под новую структуру
- `TODO.txt` — task 12 (useLeads rewrite) помечен done, пути миграций обновлены
- `todo.txt` → `TODO.txt` (регистр)

### Fixed (DB schema — 003_monitoring_schema.sql)
- `notes.author` — убран `check (author in ('leo', 'philippe'))`, теперь free text (мультиклиент)
- `signals.meta jsonb` — добавлено для экспериментальных полей
- `companies.meta jsonb` — добавлено для экспериментальных полей

### Added
- `pipeline/` directory with import_historical.mjs, normalize functions
- `nextjs/supabase/migrations/002_new_schema.sql` — schema v2 (companies/signals/contacts/raw_signals)
- `nextjs/supabase/migrations/003_monitoring_schema.sql` — pipeline_runs monitoring table
- `nextjs/src/app/api/` — API routes directory

### Changed
- Architecture reset: dropped n8n → Google Sheets, moving to direct Supabase pipeline
- `app/` archived, new `pipeline/` orchestrator planned

---

## [0.3.0] - 2026-06-24

Signal tracker frontend rewritten to work with normalized schema.

### Fixed
- `useLeads.ts` rewritten to query `signal_monitoring` schema — joins companies + signals + contacts + app_state client-side
- Infinite loading bug eliminated — `setLoading(false)` now always runs via try/finally
- Tracker now shows only companies that have at least one signal (was showing all companies)
- `days_ago` calculated dynamically from `pub_date`; falls back to stored value when date is missing
- `AppState` and `Note` types updated: `lead_id` → `company_id`

---

## [0.2.0] - 2026-06-15

Auto-deploy pipeline on Coolify. Project restructured into monorepo layout.

### Added
- Root `Dockerfile` that builds from `nextjs/` subfolder
- `CLAUDE.md` — project rules and session context
- `docs/ARCHITECTURE.md` — full system map (Exa + job boards + Supabase + Next.js)
- `docs/SIGNALS_REGISTRY.md` — signal types, scoring, routing rules
- `docs/budget.md` — API cost estimates
- `docs/enrichment-services-research.md` — enrichment vendor comparison
- Job boards: `linkedin/`, `indeed/`, `stepstone/`, `xing/`, `cadremploi/` — each with config.json, run_test.mjs, ACTOR_NOTES.txt
- `job_boards/run_pipeline.py` — orchestration script for all actors
- `job_boards/build_output.py` — signal aggregation from raw Apify results
- `exa/EXA_NOTES.md` + all 33-monitor test scripts
- `career_pages/` — ChangeDetection.io integration scripts + LLM classifier
- `nextjs/supabase/migrations/001_initial.sql` — initial DB schema
- `TODO.txt` — project task list with session history

### Changed
- All Next.js files moved from repo root into `nextjs/` subfolder
- `.gitignore` updated: added `nextjs/src/app` unignore rule, added job board exclusions

### Fixed
- Dockerfile: added `ARG` declarations for `NEXT_PUBLIC_*` build-time env vars
- Dockerfile: switched `npm ci` → `npm install` for lock-file compatibility
- Dockerfile: removed non-existent `public/` dir copy step
- Dockerfile: `WORKDIR` corrected to `/build/nextjs` after subfolder move
- Stale root-level Next.js files deleted after move to subfolder
- `.gitignore` root `app/` rule was blocking `nextjs/src/app/` from being tracked — fixed with negation rule

### Verified
- Coolify GitHub App auto-deploy triggered on push
- Webhook auto-deploy working end-to-end
- Webhook with secret header validated

---

## [0.1.0] - 2026-06-15

Initial commit — Next.js signal tracker app.

### Added
- `nextjs/` — Next.js 14 app with Tailwind + shadcn/ui
- Components: `LeadCard`, `ContactCard`, `Header`, `Sidebar`, `NotesLog`
- `useLeads.ts` hook — fetches leads from Supabase
- `src/lib/types.ts` — Lead, Contact, Signal, AppState, Note types
- `src/lib/supabase.ts` — Supabase client init
- `.env.example`, `Dockerfile`, `next.config.js`, `tailwind.config.ts`

---

## Pre-Git History (Sessions 1–9)

Reconstructed from session notes in TODO.txt.

| Session | Date | Summary |
|---------|------|---------|
| S1 | 2026-05-29 | Exa scan — 33 queries, 164 results, 9 TAM hits, 16 lead cards created |
| S2 | 2026-05-31 | Job board RSS/API testing — all direct APIs blocked, Apify Indeed validated |
| S3 | 2026-06-02 | 33 Exa monitors created, n8n workflow `0WmBVaYBGDUMfPSl` built, end-to-end test passed |
| S4 | 2026-06-06 | n8n → Google Sheets live, Blitz enrichment pipeline built, 23 final leads delivered |
| S5 | 2026-06-08 | LinkedIn Apify actor tested — 26 ICP signals, actor selected |
| S6 | 2026-06-08 | StepStone / Xing / Cadremploi / APEC tested, architecture finalized |
| S7 | 2026-06-09 | Indeed FR validated, NL/BE boards tested (broken), 287 signals CSV exported |
| S8 | 2026-06-19 | Apify MCP installed, Philippe LinkedIn profile analyzed |
| S9 | 2026-06-22 | Architecture reset: dropped n8n/Sheets, PRD written, DB schema v2 designed, import_historical.mjs scaffolded, old app/ archived |
