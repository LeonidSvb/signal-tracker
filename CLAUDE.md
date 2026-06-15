STATUS: ACTIVE
DESC: Signal monitoring system for Philippe Bosquillon — food industry job boards + Exa news monitors → Supabase → Next.js tracker at https://philippe.pamelacoreypc.com

## Structure

```
docs/            — ARCHITECTURE.md (полная карта) + SIGNALS_REGISTRY.md (scoring/routing)
job_boards/      — один актор на папку: linkedin / indeed / stepstone / xing / cadremploi
  {actor}/
    config.json       — production queries + actor ID
    run_test.mjs      — запуск через Apify API
    ACTOR_NOTES.txt   — что работает, что нет
    results/          — raw JSON из Apify + all_runs_raw.json
  _archive/      — сломанные акторы (vacaturebank, jobat)
exa/             — 33 Exa Monitors → n8n → Google Sheets + Telegram (автоматически)
  results/monitor_ids.json  — КРИТИЧНО, не удалять
enrichment/      — all_signals_2026-06-09.csv (287 сигналов, входной файл для enrichment)
career_pages/    — отдельный n8n workflow для карьерных страниц
_archive/        — старые скрипты и данные сессий 1-2
```

## API ключи

Все ключи в `C:/Users/79818/Desktop/Mastr_Leads/.env`
- `APIFY_KEY_KAD2` — основной (LinkedIn/Indeed/StepStone/Xing/Cadremploi)
- `APIFY_KEY_STD` — запасной
- `EXA_API_KEY` — в `signals/.env`

## Job boards — как запускать

Каждый актор: `node job_boards/{actor}/run_test.mjs`
Apify аккаунт KAD2, результаты сохраняются в `{actor}/results/`

## Exa — сейчас через n8n (временно)

33 монитора на api.exa.ai, каждые 7 дней → n8n `0WmBVaYBGDUMfPSl` → Google Sheet (старая схема).
Цель: мигрировать на /api/exa-webhook → Supabase (план в ARCHITECTURE.md).

## TODO — следующая сессия (SESSION 5)

### 1. Apify акторы — аудит input/output
- Пройти по каждому актору (linkedin/indeed/stepstone/xing/cadremploi)
- Проверить: запускается? что на входе (config.json), что реально выходит (results/)
- Xing — KAD1 заблокирован, нужно ротировать на KAD2 или STD
- Зафиксировать статус в каждом ACTOR_NOTES.txt: WORKS / BROKEN / PARTIAL
- Итог: понять какие борды реально дают сигналы сейчас

### 2. Exa мониторы — ручная проверка
- Зайти на api.exa.ai, проверить 33 монитора: когда последний раз сработали
- Проверить n8n workflow `0WmBVaYBGDUMfPSl` — живой? последние runs?
- Выяснить: какие мониторы дают реальные сигналы, какие молчат
- Написать /api/exa-webhook в Next.js (план в ARCHITECTURE.md) и мигрировать

### 3. /monitoring страница в Next.js — максимум observability
Новый роут `nextjs/src/app/monitoring/page.tsx`:
- Таблица pipeline_runs: script / status / started_at / duration / rows_scraped / rows_enriched / errors
- Статус по каждому источнику: последний run, сколько сигналов принёс, uptime
- Карточки: всего сигналов / отфильтровано ICP / прошло enrichment / в Supabase
- Цвета: success=зелёный, error=красный, running=жёлтый (пульсация)
- Данные: читает из таблицы `pipeline_runs` в Supabase

### 4. pipeline/run.js — оркестратор
- Создать `pipeline/run.js` (план в ARCHITECTURE.md §Pipeline стадии)
- Каждый запуск пишет в `pipeline_runs` — это и есть источник для /monitoring
- Сначала просто: scrape → filter → enrich → push, логирует каждый шаг
