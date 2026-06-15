# Signal System — Architecture
# Last updated: 2026-06-11

---

## Принципы (финальные решения)

- Пайплайн (signals/) НЕ переносится — скрипты пишут в Supabase вместо CSV
- app/ = только фронтенд + лёгкие API routes (нет бизнес-логики)
- Telegram — НЕ нужен, всё видно в приложении
- Google Sheets — убрать полностью
- n8n — убрать полностью (сейчас костыль). Миграция ниже.
- Оркестрация = plain cron + pipeline/run.js
- Каждый enrichment/validation = pluggable adapter (не хардкод провайдера)
- Мониторинг = страница /monitoring в Next.js (читает pipeline_runs)
- Домен = philippe.pamelacoreypc.com
- Аутентификация = открытая ссылка (без логина, пока один клиент)
- Dedup = компания как сущность (по company_linkedin_url), сигналы в all_signals[]

---

## Два типа сигналов — разная логика

### HIRING (job boards)
Источники: LinkedIn / Indeed / StepStone / Xing / Cadremploi
Staleness: >60 дней = stale
Scoring: freshness (3/2/1) + vacancy tier (top/mid/other) + multi-signal (+2)
LLM: signal_narrative + angle (что именно нанимают → зачем Philippe)
Фильтр ICP: food industry + ≤10k employees + exec/management level

### NEWS (Exa monitors — 33 штуки)
Типы: MA | CLEVEL | EXPAND | INVEST | CONTRACT | NICHE | SECTOR
Staleness: зависит от типа (MA — 90d, CLEVEL — 30d, EXPAND — 60d)
Scoring: другие веса (тип события > freshness)
LLM: другая инструкция (что означает это событие для executive search)
Фильтр ICP: те же company criteria, но не нужен vacancy tier

### Как сигналы доходят до Supabase (целевой поток)
- Job boards: run_test.mjs → results/*.json → pipeline/stages/06-push.js → Supabase leads
- Exa: api.exa.ai → webhook → наш /api/exa-webhook (Next.js) → LLM scoring → Supabase leads

### Миграция n8n → собственный webhook (TODO)
Сейчас: Exa → n8n workflow 0WmBVaYBGDUMfPSl → Google Sheets + Telegram
Цель:   Exa → POST /api/exa-webhook → OpenRouter scoring → Supabase leads

Шаги миграции:
1. Написать POST /api/exa-webhook в Next.js (принимает Exa payload, вызывает OpenRouter, upsert в leads)
2. Обновить webhook URL в 33 мониторах на api.exa.ai (сейчас они смотрят на n8n URL)
3. Тест: убедиться что 1-2 монитора пишут в Supabase
4. Удалить n8n workflow + Google Sheets таблицу

---

## Pipeline стадии

```
[1-scrape]   job boards (Apify) + Exa (авто, n8n)
     ↓
[2-filter]   ICP: отрасль + размер + тайтл уровень + staleness
             HIRING → один набор правил
             NEWS   → другой набор правил
     ↓
[3-enrich]   contacts + company data
             адаптеры: blitz (primary) | apollo (fallback) | datagma (phone, если нужно)
     ↓
[4-validate] email validation
             адаптеры: bounceban (manual upload) | neverbounce (API)
             статус: validated / invalid / no_email / pending
     ↓
[5-llm]      narratives + angles + snapshots
             модель: openai/gpt-oss-120b через OpenRouter
             кэш: enrichment/llm_cache.json (не удалять)
     ↓
[6-push]     Supabase upsert → leads table
             логирование → pipeline_runs table
```

---

## Папочная структура (фактическая, не трогать)

```
signals/
├── job_boards/          ← Apify акторы + конфиги
│   ├── linkedin/
│   ├── indeed/
│   ├── stepstone/
│   ├── xing/
│   ├── cadremploi/
│   └── _archive/        ← сломанные акторы
│
├── exa/                 ← 33 монитора, n8n webhook
│   └── results/monitor_ids.json  ← КРИТИЧНО не удалять
│
├── enrichment/          ← обработанные данные
│   ├── all_signals_2026-06-09.csv  ← 287 сигналов (raw)
│   ├── signal_contacts_enriched.csv ← 44 контакта (финал)
│   └── llm_cache.json   ← КРИТИЧНО не удалять
│
├── scripts/             ← discovery скрипты (по дате)
│   └── YYYY-MM-DD-*.cjs
│
├── pipeline/            ← НОВОЕ (ещё не создано)
│   ├── run.js           — оркестратор всех стадий
│   ├── log.js           — запись в pipeline_runs
│   └── stages/          — по одному файлу на стадию
│
├── docs/                ← эта папка
│
└── app/                 ← ТОЛЬКО фронтенд
    └── nextjs/
        └── src/
            ├── app/
            │   ├── page.tsx          ← трекер лидов
            │   └── monitoring/
            │       └── page.tsx      ← здоровье системы
            └── components/
```

---

## Supabase (на сервере 152.53.194.162)

Расположение: /opt/compose/supabase/
Studio: localhost:8001 (через SSH tunnel)
Postgres: localhost:5434 (через SSH tunnel)

Таблицы:
- clients        — клиенты (slug = philippe-bosquillon)
- leads          — 23 лида с сигналами, контактами, LLM контентом
- app_state      — статус каждого лида (new/sent/replied/meeting/pass)
- notes          — append-only лог заметок (leo + philippe)
- pipeline_runs  — логи каждого запуска пайплайна

Ключи (в .env.local, НЕ коммитить):
- SUPABASE_URL = http://152.53.194.162:8001
- ANON_KEY = в nextjs/.env.local
- SERVICE_ROLE_KEY = в nextjs/.env.local

---

## Scoring (SIGNALS_REGISTRY — краткая версия)

| Критерий | Баллы | Тип |
|---------|-------|-----|
| Свежесть ≤7d | +3 | оба |
| Свежесть 8-14d | +2 | оба |
| Свежесть 15-30d | +1 | оба |
| TOP exec (CEO/MD/GF/PDG) | +3 | HIRING |
| MID exec (Werksleiter/Plant/DRH) | +2 | HIRING |
| Multi-signal компания | +2 | оба |
| Base score | +1 | оба |
| M&A / C-Level move | +3 | NEWS |
| Expansion / Investment | +2 | NEWS |

Routing: ≥8 PRIORITY | 6-7 HOT | 4-5 WARM | 2-3 COLD

---

## Apify аккаунты

| Ключ | Статус | Использование |
|------|--------|--------------|
| APIFY_KEY_KAD2 | WORKING | LinkedIn, StepStone, Indeed, Cadremploi |
| APIFY_KEY_STD | WORKING | запасной |
| APIFY_KEY_KAD1_BLOCKED | BLOCKED | Xing (нужно ротировать) |

Ключи: C:/Users/79818/Desktop/Mastr_Leads/.env

---

## Outreach layer (foundation заложен, интеграция — будущее)

### Routing tiers (leads.routing + leads.template_tier)

discard = НЕ ICP match (не та отрасль, слишком большая компания, рекрутёр)
Слабый скор + правильный ICP = всё равно auto, не discard

| routing  | template_tier | Score | Что происходит |
|----------|--------------|-------|---------------|
| priority | hot          | ≥8    | Philippe вручную, личный подход |
| auto     | hot          | 7     | Plusvibe, персонализированный шаблон |
| auto     | warm         | 4-6   | Plusvibe, полу-персонализированный |
| auto     | cold         | 1-3   | Plusvibe, общий ICP pitch без упоминания сигнала |
| discard  | —            | —     | Не ICP — не показывается, не отправляется |

### Outreach канал (определяется автоматически)
- email_status = validated → email (primary)
- email_status = invalid/no_email → LinkedIn DM (InMail)
- оба верифицированы → email first, LinkedIn fallback

### Templates (таблица templates в Supabase)
Поля: signal_type + channel + subject + body_md + placeholders
Placeholders: {{first_name}}, {{company}}, {{signal_title}}, {{angle}}, {{days_ago}}
Примеры: "Hiring DG FR email", "M&A LinkedIn DM DE", "Expansion email EN"

### Sequence tracking (в app_state)
sequence_status: not_queued → queued → active → replied/bounced/meeting
sequencer: 'plusvibe' (какой инструмент)
sequence_id: ID контакта в внешнем секвенсоре

### Что нужно построить (не сейчас)
1. Написать шаблоны для Philippe (email + LinkedIn, по типу сигнала, FR/DE/NL)
2. Интеграция с Plusvibe API: push contact → campaign
3. Reply detection: Plusvibe webhook → update app_state.sequence_status
4. В трекере: показывать sequence_status на карточке
5. Авто-триггер: при score < 8 И push в Supabase → автоматически в Plusvibe

### Сигналы для auto vs priority (примеры)
- Planted ищет Managing Director 60+ дней → priority (Philippe звонит)
- Свежая вакансия Werksleiter 4 дня → auto (сразу в последовательность)
- M&A новость неделю назад → priority
- Expansion новость 45 дней → auto

---

## Dedup логика (финальная)

Компания = сущность. Ключ: company_linkedin_url (primary) или domain (fallback).
При новом прогоне: если компания уже есть → upsert (обновить score, добавить сигнал в all_signals[]).
Дублей компаний нет — один lead_id на компанию навсегда.

Stale сигналы: будущая фича. Скрипт который проходит по all_signals[] и убирает сигналы >90d.
Пока: оставить как есть, просто score падает со временем через freshness формулу.

### Будущая схема (не сейчас)
Сейчас всё в leads.all_signals (jsonb). Когда сигналов станет много:
  companies (id, name, linkedin_url, domain, ...)
  signals    (id, company_id, type, title, days_ago, source, url, score, ...)
  contacts   (id, company_id, name, email, email_status, linkedin_url, ...)
Переход: миграция существующих leads → companies + signals + contacts. Не раньше v2.

---

## Провайдеры и модели

| Назначение | Сервис | Модель/план |
|-----------|--------|-------------|
| Job board скрапинг | Apify (KAD2) | разные акторы |
| Новостные сигналы | Exa API | 33 monitors |
| Company + contacts | BlitzAPI | exhaustive mode |
| Email validation | BounceBan | manual upload |
| LLM scoring/content | OpenRouter | openai/gpt-oss-120b |
| DB | Supabase self-hosted | postgres 15 |
| Hosting | Netcup VPS + Coolify | 152.53.194.162 |

---

## ICP фильтр (нужно унифицировать)

ПРОБЛЕМА: 3 разные версии по скриптам — нужно вынести в один конфиг.
TODO: создать pipeline/config/icp_filter.json с едиными правилами перед следующим прогоном.

Текущий рабочий фильтр (из generate-html.cjs):
- company_industry: food/beverage/agri/fmcg
- employees: ≤10,000
- signal_title: exec/management уровень (не джуниор, не рекрутер)
- signal_days_ago: ≤60 (HIRING), ≤90 (NEWS MA), ≤30 (NEWS CLEVEL)
