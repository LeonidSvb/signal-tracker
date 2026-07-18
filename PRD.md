# Signal System — PRD
# Last updated: 2026-07-15

---

## STATUS UPDATE (2026-07-15): the addendum below is now mostly BUILT, not just proposed

Almost everything in "SESSION ADDENDUM — Resolution Layer" below was implemented 2026-07-14/15
(classify_company.mjs, Blitz-first classification, multi-entity extraction, all of it — see
TODO.txt "RESOLUTION PIPELINE — BUILT 2026-07-14/15" section, items 25-35). Real numbers: 337 of
346 Exa signals (97%) now have a resolved domain, up from 151/346 having none at all.

**For the current open design questions and full session narrative, read TODO.txt — the
"OPEN QUESTIONS FOR NEXT SESSION" block at the top (Q1-Q10) and "SESSION 13" in the history
block have the complete, up-to-date picture.** Not duplicating that detail here — this file's
addendum below is left as-is for historical context on the original design reasoning, but treat
TODO.txt as the live source of truth for what's built vs. still open.

## SESSION ADDENDUM — Resolution Layer (2026-07-14) — historical design doc, see status update above

Everything below this addendum (from "## Контекст и цель" onward) is the original 2026-06-22
planning doc. Most of it is now built and superseded by reality (see docs/SCHEMA.md,
docs/EXA_INTEGRATION.md, CHANGELOG.md) — kept for historical reference, not current spec.
This addendum is the live plan: what's actually true right now, what was decided in the
2026-07-14 session, and what's proposed but **not yet built or approved**. Leo reads this,
edits/confirms, then it gets implemented.

### Problem this addendum solves

Exa signals get ICP-filtered and LLM-scored fine, but turning a headline into an addressable
company (domain, right entity, contact) stalls hard — see real numbers below. The question this
session worked through: how do we close that gap without an automatic recurring Blitz spend
($50/mo subscription Leo wants to stop paying unless a new client closes).

### Real current state (measured live against production Supabase, 2026-07-14)

- `raw_signals` source=exa: **365 total, ever**. 346 passed_icp · 17 filtered_out · 2 pending.
- `signals` table: 346 rows exist (scoring ran 2026-07-13 12:12–12:22 UTC — already done, despite
  docs/EXA_INTEGRATION.md still saying "filter hasn't run yet" as of its 07-13 timestamp — that
  doc is now stale on this one point, real numbers here supersede it).
- Of those 346 signals: only **195 (56%) have a company_id**. **151 (44%) have company_id=NULL** —
  the LLM either couldn't extract a usable company name from the headline, or extraction ran but
  resolution silently failed. These 151 are dead ends today — not visible to Philippe, not
  actionable.
- `companies` table (all sources, hiring + exa combined): 350 rows. Only **78 have a
  linkedin_url**, only **63 have a domain**. The rest are name-only stubs — i.e. domain/LinkedIn
  resolution is **not** something that already happens automatically; it was an open gap, not a
  built feature, before this session.
- `contacts`: **106 total**, all from the 2026-06-26 hiring-signal Blitz run. **Zero contacts
  exist for any Exa-sourced company** — confirms TODO item 22, unchanged since last check.
- `app_state`: 311 of 312 companies are still `status='new'`. **Nothing has ever been sent to
  Philippe from this system.**

### Correction: what Exa actually returns (earlier in this conversation this was overstated)

A monitor result is `{url, title, author, publishedDate}` per hit, plus one AI-synthesized
`content` paragraph and `grounding` citations per run (see docs/EXA_INTEGRATION.md). **`url` is
the news article's URL (e.g. foodnavigator.com/...), not the company's own website.** Exa monitors
never return a domain, a LinkedIn URL, or a structured company entity — they return media
coverage. `company_name` is obtained separately, via one LLM call reading the headline
(`extractCompanyAndAngle` in `score_signals.mjs`) — that call returns a name string only, nothing
resolvable to a domain.

Separately, there **is** an already-validated but **unwired** capability for exactly this —
"Exa Finder" (tested 2026-06-29, see `exa/EXA_NOTES.md` + docs/EXA_INTEGRATION.md "Exa Finder"
section): given a **known domain**, `POST /search {includeDomains:[domain]}` reliably returns a
company description (10/10 in test) and a people-search finds LinkedIn execs (14/14 matched).
This assumes the domain is already known — it does not discover a domain from a bare company
name. Getting the domain in the first place still needs one more (unrestricted) Exa search per
unknown company.

### Decision: 3-layer cost cascade for signal → company resolution

Agreed this session (Leo). Replaces "call Blitz automatically whenever a new company appears."

1. **Layer 0 — free.** Match the signal's company (by domain if known, else normalized/fuzzy
   name) against `sourcing.companies` — the 11,793-company TAM base in the outer Mastr_Leads
   repo's Supabase schema, already paid for. Hit + `icp_status='pass'` → use it. Hit +
   `icp_status='reject'` → drop it, done, no further spend. Miss → Layer 1.
2. **Layer 1 — cheap (~$0.03–0.04/company per the 2026-06-29 Exa Finder test).** One Exa search to
   resolve the entity's actual domain + about text, then the same LLM ICP-classification prompt
   style already used to build the TAM (industry/size/country fit) → pass/reject + reason.
3. **Layer 2 — free, permanent.** Upsert the Layer-1 result into `sourcing.companies` (same
   `client_id` already shared between `sourcing` and `signal_monitoring` on purpose, from the
   2026-07-13 schema design) — pass or reject, both worth storing. Every future duplicate signal
   on this company hits Layer 0 for free, forever, for any client.

Blitz (`find_contacts.mjs`) is explicitly **out of this cascade** — it stays a manual, batched,
Leo-triggered step only, never automatic, so the $50/mo subscription only gets used when Leo
actively decides to spend it.

### Open problem: subsidiary / parent-company ambiguity

News headlines often name a subsidiary ("Kloster Kitchen, part of the Rauch Group") or a parent
making a move abroad. Naive name-extraction just grabs whichever noun phrase the LLM latches onto
— no signal of which entity is the real outreach target, and picking wrong sends Philippe a bad
intro (worse than no intro).

**Proposed approach (not yet built):**
- Extend `extractCompanyAndAngle`'s prompt to also return `is_subsidiary`, `parent_name`,
  `operating_country` — the LLM already reads the headline, this is one more field, not a new
  call.
- Default targeting rule: prefer the **local operating entity** (the one with the DE/FR/NL/BE
  plant/office/hiring need) over a distant parent/HQ — that's who Philippe would actually place
  someone at.
- If the extraction is ambiguous or low-confidence, don't auto-resolve — mark
  `status='needs_review'` and surface it in a short manual-review list instead of guessing.
- At Layer 1, search Exa using the resolved specific entity name, not the raw headline noun —
  cuts false-domain matches between similarly-named parent/subsidiary pairs.

### Renames already done this session (no behavior change)

Pipeline stage files dropped their numeric prefixes for readability:
`01_scrape_jobs`→`scrape_jobs.mjs`, `02_filter`→`filter_icp.mjs`,
`03_resolve_companies`→`resolve_companies.mjs`, `04_find_contacts`→`find_contacts.mjs`,
`05_score_llm`→`score_signals.mjs`. All references in `run.mjs`, `CLAUDE.md`, `docs/`, mockups
updated; `TODO.txt`/`CHANGELOG.md` history entries left as-is (they describe what was true when
written).

### Proposed phased plan

**Phase A — build, no spend.** `pipeline/lib/sourcing.mjs` (REST client for the outer repo's
`sourcing` schema, same pattern as `supabase.mjs` with `Content-Profile: sourcing`). New
`classify_company.mjs` stage: Layer 0 lookup → Layer 1 Exa Finder + LLM classify (incl.
subsidiary fields) → Layer 2 write-back. Wired into `resolve_companies.mjs` ahead of stub
creation, so the 151 currently-orphaned signals get a real shot at resolving.

**Phase B — checkpoint, needs "запускай".** Small controlled test batch (e.g. 20 of the 151
unresolved) through Layer 1 before running the rest, to sanity-check output quality before
spending on all 151. Est. cost for the full 151: ~$5–6 at $0.03–0.04/company.

**Phase C — checkpoint.** For companies that resolve `icp_status='pass'` with a domain/about: a
call on whether to run `find_contacts.mjs` (Blitz) now for some/all of them, or send Philippe
company-level signal info first and follow with named contacts later.

**Phase D — delivery.** Actually assemble what goes to Philippe — needs your input, not decided:

1. Delivery format — a document, a link into the Next.js tracker, an email digest?
2. Is company-level info (about + signal + angle, no named contact yet) good enough to send, or
   does Philippe need a named person before anything is worth sending?
3. Budget/batch size you're comfortable with for the Phase B test run.

---

## Контекст и цель

Сигнальная система для Philippe Bosquillon (food industry executive search, DE/FR/NL/BE/LU).
Источники сигналов: job boards (LinkedIn, StepStone, Xing, Cadremploi, Indeed) + новости (Exa).
Цель: автоматически собирать → фильтровать → обогащать → показывать Philippe готовые лиды.

Система строится под несколько клиентов сразу. Один фронтенд, одна схема БД, одни скрипты.
Разные клиенты = разные конфиги, разные ICP фильтры, разные типы сигналов.

---

## Архитектурные решения (финальные)

- **Стек:** Next.js (фронт + API routes) + Supabase self-hosted (152.53.194.162) + Node.js скрипты
- **n8n — убрать полностью.** Exa мониторы → /api/exa-webhook в Next.js вместо n8n workflow.
- **Google Sheets — убрать полностью.**
- **Exa мониторы (33 штуки) — ОСТАВИТЬ.** Они работают: 182 реальных сигнала за 3 недели. Менять только webhook URL: n8n → /api/exa-webhook. Скрипт-заменитель не нужен.
- **Хостинг скриптов:** VPS 152.53.194.162, crontab, раз в неделю.
- **Аутентификация:** пока без логина (один клиент). Позже — client_slug в URL или dropdown.
- **Multi-client:** все таблицы имеют `client_id`. Один Supabase, одни скрипты, разные конфиги.

## Статус системы (2026-06-22)

- Exa мониторы: 33 активных, последний прогон 2026-06-16, **182 сигнала** в all_runs_raw.json
- Job board данные: raw JSONs в job_boards/*/results/ (LinkedIn/StepStone/Xing/Cadremploi/Indeed)
- Исторические обогащённые данные: enrichment/*.csv (71 компания, 44 контакта, 23 финальных)
- Supabase схема v2: написана (002_new_schema.sql), ещё не применена
- Normalize функции: написаны для всех 6 источников (pipeline/lib/normalize/)
- Import скрипт: написан (pipeline/import_historical.mjs), ещё не запущен
- app/ папка: архивирована в _archive/app_prototype/

---

## Что есть прямо сейчас

### Исторические данные (enrichment/)
- `all_signals_2026-06-09.csv` — 287 сырых сигналов (LinkedIn 49 + Indeed 25 + StepStone 26 + Xing 23 + Exa 164)
- `signal_companies_resolved.csv` — 71 компания, обогащённая через Blitz
- `signal_contacts_raw.csv` — 90 контактов (Blitz waterfall)
- `signal_contacts_final.csv` — 89 контактов с инференсом email по паттерну
- `signal_contacts_enriched.csv` — 44 контакта после ICP + LLM scoring
- `delivery_philippe_2026-06-10.csv` — 23 компании, финальная доставка
- `llm_cache.json` — LLM кэш (не удалять)

### Скрипты (разрозненные, не продакшн)
- `_archive/scripts/` — 5 Python скриптов сессии 4 (одноразовые, захардкожены)
- `job_boards/*/run_test.mjs` — запуск акторов Apify (ручной)
- `job_boards/linkedin/aggregate_signals.mjs` — агрегация результатов LinkedIn
- `job_boards/run_pipeline.py` — Indeed pipeline (одноразовый)

### Supabase (текущая схема)
- `clients` — клиенты
- `leads` — ПЛОСКАЯ таблица, 23 лида вручную, all_signals jsonb
- `app_state` — CRM статус лида
- `notes` — заметки Leo/Philippe
- `pipeline_runs` — задумана но ничего не пишет

### Фронт (Next.js, philippe.pamelacoreypc.com)
- `/` — трекер лидов, работает
- `/monitoring` — не существует
- Хуки завязаны на старую плоскую таблицу `leads` — нужно переписать

---

## Новая схема Supabase

### Вопрос: одна таблица сигналов или две (Exa + job boards)?
**Ответ: одна таблица `raw_signals`, поле `source` различает тип.**
Структура сигнала одинаковая: source_url, company, scraped_at, raw_data jsonb.
Разница только в полях внутри raw_data — обрабатывается при нормализации.

### Вопрос: что происходит с 970 из 1000 записей (отфильтрованными)?
**Все сырые данные пишутся в `raw_signals` с `status=filtered_out`.**
Причина фильтрации пишется в поле `filter_reason`.
В `signals` попадают только прошедшие ICP (20-30 из 1000).
Это даёт полную observability: видно что пришло, что отфильтровано и почему.

---

### Таблицы

```sql
-- Клиенты
clients
  id uuid PK
  name text
  slug text UNIQUE          -- 'philippe-bosquillon', 'client-2'
  icp_config jsonb          -- ICP фильтр: отрасли, страны, размер, типы сигналов
  created_at

-- Сырые сигналы (всё что пришло от скраперов, до фильтрации)
raw_signals
  id uuid PK
  client_id uuid FK
  source text               -- 'linkedin' | 'stepstone' | 'xing' | 'cadremploi' | 'indeed' | 'exa'
  source_type text          -- 'hiring' | 'news'
  external_id text          -- job_id или exa article URL (для dedup)
  raw_data jsonb            -- весь оригинальный объект от актора/Exa
  company_name text         -- нормализованное название (для matching)
  source_url text           -- ссылка на первоисточник (вакансия / статья)
  status text               -- 'pending' | 'passed_icp' | 'filtered_out'
  filter_reason text        -- причина фильтрации если filtered_out
  scraped_at timestamptz
  run_id uuid FK → pipeline_runs
  UNIQUE(client_id, source, external_id)  -- dedup

-- Компании (дедупнутые, одна запись навсегда)
companies
  id uuid PK
  client_id uuid FK
  linkedin_url text UNIQUE
  domain text
  name text
  industry text
  employees int
  hq_country text
  about text
  blitz_data jsonb          -- полный ответ Blitz (кэш)
  created_at
  updated_at

-- Обработанные сигналы (прошли ICP, скоренные, обогащённые)
signals
  id uuid PK
  client_id uuid FK
  company_id uuid FK → companies
  raw_signal_id uuid FK → raw_signals
  signal_type text          -- 'HIRING' | 'MA' | 'CLEVEL' | 'EXPAND' | 'INVEST' | 'CONTRACT'
  title text                -- название вакансии или заголовок статьи
  source text               -- 'linkedin' | 'exa' | ...
  source_url text           -- ссылка на первоисточник
  pub_date date
  days_ago int
  country text
  score int                 -- итоговый score (1-10)
  freshness_score int       -- отдельно freshness (пересчитывается)
  status text               -- 'active' | 'stale' | 'filled' | 'expired'
  expires_at timestamptz    -- когда считать неактуальным (по типу сигнала)
  narrative text            -- LLM: что означает этот сигнал
  angle text                -- LLM: угол для Philippe
  created_at
  updated_at

-- Контакты (per company, обогащённые)
contacts
  id uuid PK
  client_id uuid FK
  company_id uuid FK → companies
  first_name text
  last_name text
  full_name text
  title text
  linkedin_url text
  email text
  email_status text         -- 'verified' | 'inferred' | 'invalid' | 'pending'
  phone text
  is_primary bool
  source text               -- 'blitz' | 'pattern_inferred' | 'manual'
  created_at
  updated_at

-- CRM статус (один row per company per client)
app_state
  id uuid PK
  client_id uuid FK
  company_id uuid FK → companies
  status text               -- 'new' | 'sent' | 'replied' | 'meeting' | 'pass'
  updated_at
  updated_by text           -- 'leo' | 'philippe'
  UNIQUE(client_id, company_id)

-- Заметки (append-only)
notes
  id uuid PK
  client_id uuid FK
  company_id uuid FK → companies
  author text               -- 'leo' | 'philippe'
  body text
  created_at

-- Логи запусков пайплайна (observability)
pipeline_runs
  id uuid PK
  client_id uuid FK
  script text               -- 'exa_scrape' | 'linkedin_scrape' | 'enrich' | 'score'
  source text               -- 'exa' | 'linkedin' | 'stepstone' | 'xing' | 'all'
  status text               -- 'running' | 'success' | 'error'
  rows_scraped int          -- сколько сырых записей пришло
  rows_passed_icp int       -- сколько прошли ICP
  rows_enriched int         -- сколько обогатились контактами
  rows_pushed int           -- сколько уникальных компаний попало в signals
  errors jsonb default '[]'
  started_at timestamptz
  finished_at timestamptz
  meta jsonb                -- доп. инфо (queries run, cost estimate, etc.)
```

**Что делать со старой `leads` таблицей:** мигрировать 23 записи в новую схему,
затем дропнуть. При 23 записях — сейчас лучший момент.

---

## Enrichment Pipeline (как устроен)

Два разных типа сигналов требуют разного enrichment:

### HIRING (job boards)
```
raw_signals (source=linkedin/stepstone/xing/cadremploi/indeed)
  ↓ ICP фильтр (icp_filter.json) → filtered_out или passed_icp
  ↓ Company resolution: Blitz /search/companies → компания в companies[]
  ↓ Contact finding: Blitz waterfall (/search/waterfall-icp-keyword)
      <500 emp: CEO/MD/GF сначала
      500+ emp: HR Director/DRH сначала
  ↓ Email enrichment: Blitz /enrichment/email (прямой)
      если нет → pattern inference (8 employees → паттерн → infer → mails.so validate)
  ↓ LLM: narrative + angle (OpenRouter gpt-oss-120b, кэш по company+signal)
  ↓ signals[] + contacts[]
```

### NEWS (Exa)
```
raw_signals (source=exa)
  ↓ ICP фильтр (company name match → проверить в companies[] или Blitz)
  ↓ Company resolution: если компания уже в companies[] → skip Blitz
  ↓ Contact finding: только если компании нет в contacts[]
  ↓ LLM: narrative + angle (другой промпт чем для HIRING)
  ↓ signals[] + contacts[] (если новая компания)
```

### Staleness (актуальность сигналов)

**HIRING:**
- `expires_at` = `pub_date + 90 days` (выставляется при вставке)
- Подтверждение актуальности: re-scrape. Если job_id пропал с борда → `status=filled`
- Xing даёт `active_until` напрямую → использовать как expires_at

**NEWS (Exa):**
- Тип MA: `expires_at = pub_date + 90d`
- Тип CLEVEL: `expires_at = pub_date + 30d`
- Тип EXPAND/INVEST: `expires_at = pub_date + 60d`
- Подтверждение не нужно — новость это факт. Просто score падает через freshness.

**Scoring recalc job (еженедельный):**
- Пересчитывает `days_ago` и `freshness_score` для всех `status=active` сигналов
- Если `now > expires_at` → `status=stale`
- Обновляет итоговый `score` на компании

---

## ICP Фильтр (унифицированный)

Сейчас 3 разные версии в разных скриптах. До первого продакшн-прогона —
создать `pipeline/config/icp_filter.json` с едиными правилами.

```json
{
  "client": "philippe-bosquillon",
  "industries": ["food", "beverage", "dairy", "bakery", "meat", "ingredients",
                  "fmcg", "agroalimentaire", "lebensmittel", "nahrungsmittel"],
  "countries": ["DE", "FR", "NL", "BE", "LU", "CH", "AT"],
  "max_employees": 10000,
  "min_employees": 50,
  "hiring_signal": {
    "exec_keywords": ["CEO", "Geschäftsführer", "Directeur", "Managing Director",
                       "Werksleiter", "Plant Manager", "DRH", "PDG", "Directeur Général",
                       "Directeur Commercial", "COO", "Chief"],
    "blacklist_companies": ["Sodexo", "Newrest", "Compass Group", "Elior",
                             "Sysco", "Aramark"],
    "blacklist_keywords": ["Praktikum", "Internship", "Stage", "Junior", "Trainee"]
  },
  "news_signal": {
    "types": ["MA", "CLEVEL", "EXPAND", "INVEST", "CONTRACT"]
  }
}
```

---

## Продакшн скрипты (что нужно написать/переписать)

Все скрипты живут в `signals/pipeline/`. Каждый: принимает `--client` и `--config`,
пишет в `pipeline_runs` при старте и при завершении.

```
signals/pipeline/
  config/
    icp_filter.json          -- единый ICP фильтр
  stages/
    scrape_jobs.mjs       -- LinkedIn + StepStone + Xing + Cadremploi + Indeed
    01_scrape_exa.mjs        -- Exa Search (33 запроса, замена мониторам)
    filter_icp.mjs            -- ICP фильтр → raw_signals.status
    resolve_companies.mjs -- Blitz company lookup → companies[]
    find_contacts.mjs     -- Blitz waterfall + email enrichment → contacts[]
    score_signals.mjs         -- OpenRouter narrative + angle + score → signals[]
    06_push_supabase.mjs     -- upsert всё в Supabase
    07_recalc_scores.mjs     -- еженедельный пересчёт freshness + status
  run.mjs                    -- оркестратор (запускает стадии последовательно)
  log.mjs                    -- хелпер: пишет в pipeline_runs
```

**Что переиспользовать из существующего:**
- `job_boards/*/run_test.mjs` → основа для scrape_jobs.mjs (actor вызовы)
- `job_boards/linkedin/aggregate_signals.mjs` → логика фильтрации
- `_archive/scripts/blitz_enrich.py` → портировать на JS или запускать как subprocess
- `_archive/scripts/pattern_inference.py` → переписать в mjs
- `enrichment/llm_cache.json` → переиспользовать как кэш для score_signals.mjs

---

## Порядок исполнения (шаг за шагом)

### Фаза 1 — Фундамент (схема + исторические данные)
```
[ ] 1. Написать migration 002_new_schema.sql (новые таблицы выше)
[ ] 2. Применить миграцию на Supabase (152.53.194.162)
[ ] 3. Написать import_historical.mjs:
        all_signals_2026-06-09.csv → raw_signals
        signal_companies_resolved.csv → companies
        signal_contacts_enriched.csv → contacts
        delivery_philippe_2026-06-10.csv → signals + app_state (status=new)
[ ] 4. Дропнуть старую таблицу leads (после проверки что фронт не сломан)
[ ] 5. Удалить 33 Exa монитора (DELETE https://api.exa.ai/monitors/{id} × 33)
```

### Фаза 2 — Продакшн скрипты
```
[ ] 6. Создать pipeline/config/icp_filter.json
[ ] 7. Написать log.mjs (хелпер pipeline_runs)
[ ] 8. Написать scrape_jobs.mjs (LinkedIn + StepStone + Cadremploi; Xing после фикса ключа)
[ ] 9. Написать 01_scrape_exa.mjs (33 запроса через Search API)
[ ] 10. Написать filter_icp.mjs (ICP фильтр, пишет filter_reason)
[ ] 11. Написать resolve_companies.mjs (Blitz, кэш через companies[])
[ ] 12. Написать find_contacts.mjs (Blitz waterfall + pattern inference)
[ ] 13. Написать score_signals.mjs (OpenRouter, кэш через llm_cache.json)
[ ] 14. Написать 06_push_supabase.mjs (upsert companies + signals + contacts)
[ ] 15. Написать run.mjs (оркестратор)
[ ] 16. Тестовый прогон локально — 1 источник, 1 страна
```

### Фаза 3 — Сервер + крон
```
[ ] 17. Зафиксировать Xing/Indeed ключи (KAD1 → KAD2/STD в конфигах)
[ ] 18. Сделать скрипты Linux-совместимыми (пути, env vars)
[ ] 19. Задеплоить pipeline/ на сервер (scp или git pull)
[ ] 20. Настроить crontab:
        0 8 * * 1  node /opt/signals/pipeline/run.mjs --client philippe-bosquillon
[ ] 21. Написать 07_recalc_scores.mjs
        0 9 * * 1  node /opt/signals/pipeline/07_recalc_scores.mjs
```

### Фаза 4 — Фронт
```
[ ] 22. Переписать useLeads.ts под новую схему
        (companies + signals + contacts вместо flat leads)
[ ] 23. Обновить LeadCard.tsx — drill-down до конкретного signal с source_url
[ ] 24. Добавить /monitoring страницу:
        - таблица pipeline_runs: script / status / rows_scraped / rows_passed / errors
        - drill-down: клик на run → список raw_signals этого run
        - статус по источнику: последний run, сколько сигналов
[ ] 25. Написать /api/exa-webhook (на случай если вернём мониторы — пока не нужен)
[ ] 26. Задеплоить фронт (deploy.ps1)
```

### Фаза 5 — Актуализация (после запуска)
```
[ ] 27. Re-scrape job boards: сравнивать job_id с raw_signals → filled если пропал
[ ] 28. Scoring recalc UI: показывать на /monitoring когда последний recalc
[ ] 29. Добавить второго клиента (копия конфига, другой icp_filter.json)
```

---

## Ключи и переменные окружения

```
root .env (C:\Users\79818\Desktop\Mastr_Leads\.env):
  EXA_API_KEY
  OPENROUTER_KEY
  APIFY_KEY_STD          -- рабочий
  APIFY_KEY_KAD2         -- рабочий (LinkedIn/StepStone/Cadremploi)
  APIFY_KEY_KAD1_BLOCKED -- заблокирован (Xing + Indeed конфиги надо поправить)
  MAILSO_API_KEY         -- mails.so email validation
  BOUNCEBAN_API_KEY      -- альтернативный валидатор

blitz/.env:
  BLITZ_API_KEY
  MAILSSO_API_KEY

nextjs/.env.local:
  NEXT_PUBLIC_SUPABASE_URL=http://152.53.194.162:8001
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY  -- нужен для API routes (сейчас не используется)
  NEXT_PUBLIC_CLIENT_SLUG=philippe-bosquillon
```

---

## Открытые вопросы (решить перед стартом)

1. **Exa мониторы:** подтвердить удаление — да, меняем на скрипт
2. **Indeed/Xing ключи:** обновить конфиги на KAD2 вместо KAD1_BLOCKED
3. **Email validation:** mails.so или BounceBan? Сейчас в скриптах mails.so хардкожен
4. **Xing:** акторы требуют approval на KAD1 — на KAD2 работает без approval?
5. **Multi-client фронт:** dropdown в хедере или разные URL (/philippe vs /client2)?

---

## Файлы которые нельзя удалять

- `enrichment/llm_cache.json` — LLM кэш (дорого пересобирать)
- `exa/results/monitor_ids.json` — нужен для удаления мониторов через API
- `enrichment/delivery_philippe_2026-06-10.csv` — исторические данные для импорта
- `enrichment/signal_contacts_enriched.csv` — исторические контакты
- `enrichment/all_signals_2026-06-09.csv` — исторические сигналы
