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
    icp_filter.json  — ICP правила (читается filter_icp.mjs)
    blacklist.json   — детальный список исключений (staffing agencies)
  lib/normalize/     — нормализаторы raw JSON → raw_signals per источник
  stages/            — scrape_jobs, filter_icp, resolve_companies, find_contacts, score_signals
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
- `BLITZ_API_KEY` — в `blitz/.env` (проверять актуальность там, не тут)
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — в `nextjs/.env.local`

## Rate limits внешних API (проверять здесь перед выбором concurrency)

- **Blitz:** 50 req/sec (Enterprise + "+45 RPS" аддон) — используй ~40/sec с запасом. Источник: `docs/blitz-api/blitz-api-test-results.md`
- **Exa:** RPS не задокументирован публично; free tier 20,000 req/месяц (`exa.ai/pricing`), содержимое (`contents.text`) — отдельная статья расходов $1/1k страниц сверх поиска $7/1k
- **OpenRouter (gpt-oss-120b):** лимиты не проверялись — если скрипт на этой модели идёт медленно, сначала проверить, не в OpenRouter ли узкое место

## Job boards — как запускать

`node job_boards/{actor}/run_test.mjs` — Apify KAD2, результаты в `{actor}/results/`
Xing и Indeed — нужна ротация ключа с KAD1_BLOCKED на KAD2 в config.json

## Exa — прямой webhook (n8n/Google Sheets отключены 2026-06-22, не использовать эти упоминания как current state)

33 монитора → Exa webhook → `nextjs/src/app/api/exa-webhook/route.ts` → `raw_signals` напрямую.
Monitor ID → (signal_type, country) маппинг сейчас захардкожен в самом route.ts
(`MONITOR_LABELS`, TS-словарь) — единый на один deployment/CLIENT_SLUG. Известное
ограничение при переходе на мульти-клиентский фронт, см. PLAN doc.
Полная архитектура + история инцидента: `docs/EXA_INTEGRATION.md`.

## Pipeline — как запускать

```powershell
# Env из nextjs/.env.local
node --env-file=nextjs/.env.local pipeline/stages/scrape_jobs.mjs
node --env-file=nextjs/.env.local pipeline/stages/filter_icp.mjs
node --env-file=nextjs/.env.local pipeline/import_historical.mjs
```

## DB — как применять миграции

```powershell
# SSH tunnel в отдельном терминале
ssh -i ~/.ssh/id_ed25519_hostinger -L 5434:localhost:5434 leonid@152.53.194.162 -N
# Применить
psql -h localhost -p 5434 -U postgres -d postgres -f db/migrations/003_monitoring_schema.sql
```
