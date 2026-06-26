STATUS: ACTIVE
DESC: Signal monitoring system for Philippe Bosquillon — food industry job boards + Exa news monitors → Supabase → Next.js tracker at https://philippe.pamelacoreypc.com

## Structure

```
db/migrations/       — SQL миграции (001 applied, 002+003 pending)
docs/                — OVERVIEW.md / ARCHITECTURE.md / SCHEMA.md / SIGNALS_REGISTRY.md
job_boards/          — Apify акторы: linkedin / indeed / stepstone / xing / cadremploi
  {actor}/
    config.json      — production queries + actor ID
    run_test.mjs     — запуск через Apify API
    ACTOR_NOTES.txt  — статус: WORKS / BROKEN / PARTIAL
    results/         — raw JSON из Apify (gitignored)
exa/
  clients/           — monitor_id маппинги per клиент (philippe-bosquillon.json)
  results/           — all_runs_raw.json + monitor_ids.json (КРИТИЧНО, gitignored)
pipeline/
  clients/           — конфиг per клиент: ICP, sources, copy, sequencer
    _template.json   — дефолты для всех клиентов
    philippe-bosquillon.json
  config/
    icp_filter.json  — ICP правила (читается 02_filter.mjs)
    blacklist.json   — детальный список исключений (staffing agencies)
  lib/normalize/     — нормализаторы raw JSON → raw_signals per источник
  stages/            — 01_scrape_jobs, 02_filter, 03_resolve_companies, 04_find_contacts
  import_historical.mjs — одноразовый импорт 287 сигналов (ещё не запущен)
nextjs/              — Next.js 14 фронт + API routes
  src/app/page.tsx   — трекер лидов
  src/hooks/useLeads.ts — читает signal_monitoring schema
scripts/
  deploy.ps1         — деплой на VPS
  discovery/         — одноразовые скрипты с датой в имени
enrichment/          — исторические CSV + llm_cache.json (КРИТИЧНО, gitignored)
```

## API ключи

Все ключи в `C:/Users/79818/Desktop/Mastr_Leads/.env`
- `APIFY_KEY_KAD2` — основной (LinkedIn/StepStone/Cadremploi)
- `APIFY_KEY_STD` — запасной
- `EXA_API_KEY` — в `signals/.env`
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — в `nextjs/.env.local`

## Job boards — как запускать

`node job_boards/{actor}/run_test.mjs` — Apify KAD2, результаты в `{actor}/results/`
Xing и Indeed — нужна ротация ключа с KAD1_BLOCKED на KAD2 в config.json

## Exa — сейчас через n8n (временно)

33 монитора → n8n `0WmBVaYBGDUMfPSl` → Google Sheet.
Monitor IDs: `exa/clients/philippe-bosquillon.json`
Цель: мигрировать webhook на `/api/exa-webhook` (plan в ARCHITECTURE.md).

## Pipeline — как запускать

```powershell
# Env из nextjs/.env.local
node --env-file=nextjs/.env.local pipeline/stages/01_scrape_jobs.mjs
node --env-file=nextjs/.env.local pipeline/stages/02_filter.mjs
node --env-file=nextjs/.env.local pipeline/import_historical.mjs
```

## DB — как применять миграции

```powershell
# SSH tunnel в отдельном терминале
ssh -i ~/.ssh/id_ed25519_hostinger -L 5434:localhost:5434 leonid@152.53.194.162 -N
# Применить
psql -h localhost -p 5434 -U postgres -d postgres -f db/migrations/003_monitoring_schema.sql
```
