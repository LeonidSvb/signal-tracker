# Changelog

All notable changes to the Philippe Bosquillon signal monitoring system.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

---

## [Unreleased]

## [0.7.0] - 2026-07-13

Exa webhook incident (3-week silent outage) found and fixed, full-data-capture migration,
scoring bugs fixed, deployed to production. Full writeup: docs/EXA_INTEGRATION.md.

### Fixed
- `nextjs/src/app/api/exa-webhook/route.ts` — route expected a flat `{monitorId, results}`
  body; Exa actually sends an event envelope (`{type, data:{monitorId, output:{results,
  content, grounding}}}`). Confirmed empirically against a live test monitor — Exa's docs
  don't show an example payload. Zero exa rows had landed in `raw_signals` since the
  2026-06-22 webhook repoint away from n8n, despite all 33 monitors firing weekly the
  whole time. Also now acks (200, no-op) `monitor.created`/`monitor.run.created` instead
  of erroring on them.
- `pipeline/stages/05_score_llm.mjs` — two bugs: (1) `company_name` was hardcoded null for
  every Exa/news signal, so `03_resolve_companies.mjs` silently skipped all of them and
  `resolveCompany()` here searched against `''`; added one LLM call per news signal to
  extract company name + angle together. (2) numeric score used a job-posting exec-keyword
  regex against news headlines, which almost never matched — replaced with signal_type-based
  weighting (MA/CLEVEL +3, EXPAND/INVEST +2, else +1) + a multi-signal bonus. Verified live:
  198 signals re-scored, 195/198 (98.5%) resolved to a company, score distribution now
  spreads 1-8 instead of clustering at 1-4.
- `scripts/deploy.ps1` — `$NEXTJS_DIR` pointed at `scripts/nextjs` (never existed) since the
  script moved into `scripts/` on 2026-06-26; every deploy attempt since then failed at the
  build step. Also the server `.env` this script writes was missing
  `SUPABASE_SERVICE_ROLE_KEY`, which the webhook route requires.

### Added
- `exa/scripts/backfill_monitor_runs.mjs` — pulls `GET /monitors/{id}/runs` for all 33
  monitors, upserts into `raw_signals`, logs a `pipeline_runs` row per monitor. Recovered
  153 signals the broken webhook had silently dropped.
- `db/migrations/004_exa_full_capture.sql` — `raw_signals.monitor_label` real column, dedup
  key widened to `(client_id, source, external_id, monitor_label)`. Live analysis of all 33
  monitors found 39 of 310 unique URLs (12.6%) get caught by 2+ different monitor categories
  at once — the old 3-column key kept only whichever monitor's delivery landed first,
  discarding the others' category attribution and making the PRD's multi-signal scoring
  bonus impossible to compute. `pipeline_runs.digest`/`digest_citations` columns added for
  Exa's per-run AI-synthesized summary, previously thrown away entirely.
- `contents.text: true` enabled on all 33 production monitors (was on none) — full article
  body (Markdown-formatted) now captured per signal instead of headline-only. Takes effect
  from each monitor's next scheduled run (2026-07-14 onward).
- `docs/EXA_INTEGRATION.md` — current architecture + full incident writeup, supersedes the
  n8n/Google-Sheets-era content in `exa/EXA_NOTES.md`.
- `mockups/database.html`, `mockups/settings.html`, `mockups/exa-analytics.html` — new
  Database (TAM explorer), Settings (ICP Filter/Staleness Rules/Runs/Health), and Exa
  Analytics pages, built on real production data.

### Known gaps (not fixed this session)
- `calcExpires()` in `05_score_llm.mjs` hardcodes 30 days for all news signals regardless of
  `signal_type`, ignoring `icp_filter.json`'s per-type staleness windows (MA:90/CLEVEL:30/
  EXPAND:60/INVEST:60) that `02_filter.mjs` already respects correctly.
- Webhook signature verification (`exa-signature` header) isn't possible for the 33
  production monitors — their `webhookSecret` was only returned once at creation (2026-06-02,
  before this route existed) and was never captured; `PATCH` doesn't re-issue it.

## [0.6.0] - 2026-06-29

Full TAM expansion (003 batch) + MV+BB email validation pipeline + shared utils.

### Added
- `scripts/validation/validate-mv-apify.py` — Million Verifier via Apify VJ5w50TP6mAbyimyO, batch mode (300/run), key rotation, cache
- `scripts/validation/validate-catchall-apify.py` — Catch-all via BlitzAPI actor XdSG0jjZbmrqwcUwV, concurrent (15)
- `scripts/validation/validate-catchall-bounceban.py` — BounceBan bulk API с `--balance`, `--route-only`, `--recheck` флагами
- `scripts/validation/validate-mailsso.py` — mails.so batch validation (переименован из validate_emails.py)
- `scripts/validation/validate-million-verifier.py` — manual MV upload flow (`--prepare` / `--results`)
- `scripts/validation/pipelines/mv-then-bounceban.py` — оркестратор: MV → BB на catch_all → merge final
- `scripts/utils/apify-key-pool.mjs` — shared JS util: loadKeyPool / pickKey / apifyRun (5 аккаунтов)
- `scripts/utils/apify_key_pool.py` — Python эквивалент того же
- `clients/philippe-bosquillon/prompts/icp_check_v4_micro.txt` — ultra-strict ICP для 25-50 emp (default reject)
- `clients/philippe-bosquillon/prompts/icp_check_v5_decisive.txt` — needs_website re-score + exa_worth_it flag
- `scripts/discovery/2026-06-29-rescore-by-size.cjs` — hard cut <25 emp, size-based ICP prompt routing
- `scripts/discovery/2026-06-29-merge-003-to-db.cjs` — merge contacts_003_raw.jsonl → master_contacts.jsonl
- `scripts/discovery/2026-06-29-export-003-emails.cjs` — export emails → Downloads + validation meta

### Changed
- `clients/philippe-bosquillon/signals/pipeline/stages/01_scrape_jobs.mjs` — extracted key pool to scripts/utils, removed 80+ lines inline
- `clients/philippe-bosquillon/TODO_MASTER.txt` — 1B/1C/2C validation marked DONE, 2D unblocked

### Results
- 003 TAM batch: 7,268 scraped → 5,136 new after dedup → DB 6,832 → 11,968 total
- ICP rescore: pass=4,443 | reject=7,503 | needs_website=21
- 1B contact finding: 1,666 cos → 1,030 contacts → 301 emails
- 1C contact finding: 1,676 cos → 845 contacts → 354 emails
- MV+BB pipeline (672 emails): ok=470 | catchall_BB=92 | unknown=77 | dead=33 → sendable=562
- Apify accounts: 4/5 working (KAD2=$4.10, STD=$4.10, KAD1=$4.17, PIH=$4.16; LEO=unpaid invoice)
- BounceBan: 95 catchall → 92 deliverable | 3,428 credits remaining

## [0.5.0] - 2026-06-29

TAM DB built + Exa Finder API validated as primary contact-finding fallback.

### Added
- `clients/philippe-bosquillon/db/` — TAM intelligence database
  - `README.md` — описание всех файлов и lookup логики
  - `TAM_ENRICHMENT_STRATEGY.txt` — полный intersection анализ (73 сигнальных компании: 19 в DB, 54 нет), 10 архитектурных улучшений
  - `blitz_all_scored.jsonl` — 6,773 компаний из Blitz (полный universe, ICP scored)
  - `apollo_all_scored.jsonl` — 673 компании из Apollo (pass+reject+unscored)
  - `tam_companies.jsonl` — 2,953 ICP pass компаний (объединённый)
  - `master_contacts.jsonl` — 2,064 контактов (L3:1577, risky:205, L2:282)
  - `apollo_contacts.jsonl` — 1,308 Apollo контактов
- `clients/philippe-bosquillon/TODO_MASTER.txt` — мастер TODO на все работы по Philippe
- `clients/philippe-bosquillon/copy/copy_signals_v2.txt` — полный copy playbook
  - 5 типов job board сигналов (HIRING_EXEC/MID/SURGE/STALE/RECRUITER)
  - 5 типов Exa news сигналов (CLEVEL/M&A/EXPAND/INVEST/CONTRACT)
  - Для каждого: 2-3 email варианта + LinkedIn + cold call скрипт + 3-5 фоллоу-апов
- `signals/exa/test_cat1.json` — 4 Cat1 компании (ICP pass в Blitz, нет контактов)
- `signals/exa/test_cat2.json` — 60 Cat2 компаний (не в DB, ICP неизвестен)
- `signals/exa/test_finder.cjs` — Exa Finder test: company description + people search
- `signals/exa/blitz_email_test.cjs` — Blitz /enrichment/email тест на LinkedIn URL из Exa
- `signals/pipeline/stages/02_filter.mjs` — ICP фильтр по blacklist + keyword
- `signals/pipeline/stages/03_resolve_companies.mjs` — LinkedIn company resolver
- `signals/pipeline/stages/04_find_contacts.mjs` — contact finding stage
- `signals/pipeline/stages/05_score_llm.mjs` — LLM ICP scoring stage
- `signals/pipeline/run.mjs` — pipeline orchestrator
- `signals/scripts/` — утилиты для signals pipeline
- `scripts/discovery/2026-06-29-build-tam-db.cjs` — скрипт сборки TAM DB
- `scripts/discovery/2026-06-29-build-blitz-scored.cjs` — Blitz scored JSONL builder
- `scripts/discovery/2026-06-29-build-final-jsonl.cjs` — финальный JSONL для leads
- `scripts/discovery/2026-06-29-score-apollo-unscored.cjs` — ICP scoring Apollo unscored
- `blitz/scripts/source_resolve_companies.js` — Blitz company resolver

### Changed
- `signals/exa/EXA_NOTES.md` — добавлен раздел "Exa Finder API — Test Results (2026-06-29)"
- `signals/CLAUDE.md` — обновлён под новую структуру pipeline + db/
- `signals/pipeline/lib/supabase.mjs` — добавлены helper функции для bulk insert

### Research results (Exa Finder test — 14 companies)
- **Company description:** 10/10 (100%) — domain → includeDomains → full description
- **People search:** 14/14 (100%) — category "linkedin profile" → 13 LinkedIn URLs/company
- **Blitz email enrichment:** 45% overall (exec 41%, ops 52%, hr 41%)
  - Big companies (100+ emp): 54-92% email hit rate
  - Small companies (<100 emp): 0-33%
- **Cost:** ~$0.021 Exa per company (people only) + $0 Blitz (unlimited plan)
- **Recommended pipeline:** signal → DB lookup → if not found: Exa company desc → LLM ICP → Exa people → Blitz email

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
