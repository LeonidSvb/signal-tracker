# Database Schema
Schema: `signal_monitoring` | Supabase self-hosted на 152.53.194.162
Last updated: 2026-06-26

---

## Таблицы и связи

```
clients
  └── companies         (client_id FK)
  │     └── signals     (company_id FK)
  │     └── contacts    (company_id FK)
  │     └── app_state   (company_id FK, UNIQUE per client+company)
  │     └── notes       (company_id FK, append-only)
  └── raw_signals       (client_id FK, run_id FK)
  └── pipeline_runs     (client_id FK)
```

---

## clients

Один клиент = одна строка. Всё остальное фильтруется по client_id.

| Колонка | Тип | Описание |
|---------|-----|---------|
| id | uuid PK | |
| slug | text UNIQUE | philippe-bosquillon, client2, ... |
| name | text | Отображаемое имя |
| created_at | timestamptz | |

---

## pipeline_runs

Лог каждого запуска скрипта. Источник данных для /monitoring страницы.

| Колонка | Тип | Описание |
|---------|-----|---------|
| id | uuid PK | |
| client_id | uuid FK | |
| script | text | 01_scrape_jobs, 02_filter, ... |
| source | text | linkedin, exa, stepstone, ... |
| status | text | running / done / error |
| started_at | timestamptz | |
| finished_at | timestamptz | |
| rows_scraped | int | Всего получено от источника |
| rows_passed_icp | int | Прошли ICP фильтр |
| rows_pushed | int | Записано в signals |
| errors | jsonb | Список ошибок если были |
| stats | jsonb | Произвольные метрики прогона |

---

## raw_signals

Всё что пришло от скраперов — ДО фильтрации. Не удалять.
Сюда пишется абсолютно всё, отфильтрованное остаётся со статусом filtered_out.

| Колонка | Тип | Описание |
|---------|-----|---------|
| id | uuid PK | |
| client_id | uuid FK | |
| run_id | uuid FK | → pipeline_runs |
| source | text | linkedin / stepstone / xing / cadremploi / indeed / exa |
| source_type | text | hiring / news |
| external_id | text | job_id или URL статьи (ключ дедупа) |
| raw_data | jsonb | Полный оригинальный объект от Apify/Exa |
| company_name | text | Нормализованное название компании |
| source_url | text | Ссылка на вакансию или статью |
| pub_date | date | Дата публикации |
| country | text | DE / FR / NL / BE / LU / CH / AT |
| status | text | pending / passed_icp / filtered_out |
| filter_reason | text | Причина отфильтрования |
| scraped_at | timestamptz | |

UNIQUE: (client_id, source, external_id) — дедуп по источнику и ID

---

## companies

Дедуплицированные компании. Одна строка на компанию навсегда.
Ключ дедупа: linkedin_url (primary) или domain (fallback).

| Колонка | Тип | Описание |
|---------|-----|---------|
| id | uuid PK | |
| client_id | uuid FK | |
| name | text | |
| linkedin_url | text | Ключ дедупа (primary) |
| domain | text | Ключ дедупа (fallback) |
| industry | text | |
| employees | int | |
| hq_country | text | |
| about | text | Краткое описание компании |
| blitz_data | jsonb | Кэш ответа Blitz API |
| meta | jsonb | Экспериментальные поля |
| created_at / updated_at | timestamptz | |

UNIQUE: (client_id, linkedin_url)

---

## signals

Прошли ICP, обогащены, оценены. Только то что показывается клиенту.
Одна компания может иметь несколько сигналов (multi-signal = +2 к score).

| Колонка | Тип | Описание |
|---------|-----|---------|
| id | uuid PK | |
| client_id | uuid FK | |
| company_id | uuid FK | → companies |
| raw_signal_id | uuid FK | → raw_signals (откуда пришёл) |
| signal_type | text | HIRING / MA / CLEVEL / EXPAND / INVEST / CONTRACT / NICHE / SECTOR |
| title | text | Название вакансии или заголовок новости |
| source | text | linkedin / exa / ... |
| source_url | text | Ссылка на оригинал |
| pub_date | date | Дата публикации |
| days_ago | int | Fallback если pub_date отсутствует |
| country | text | |
| score | int | Итоговый score 0–10 |
| freshness_score | int | Только за свежесть (0–3) |
| status | text | active / stale / filled / expired |
| expires_at | timestamptz | Когда сигнал становится stale |
| narrative | text | LLM: что этот сигнал означает для executive search |
| angle | text | LLM: угол захода для outreach |
| meta | jsonb | Экспериментальные поля |
| created_at / updated_at | timestamptz | |

---

## contacts

Контакты per компания. Обогащаются через Blitz API.

| Колонка | Тип | Описание |
|---------|-----|---------|
| id | uuid PK | |
| client_id | uuid FK | |
| company_id | uuid FK | → companies |
| first_name / last_name / full_name | text | |
| title | text | Должность |
| linkedin_url | text | |
| email | text | |
| email_status | text | verified / inferred / invalid / pending |
| phone | text | |
| is_primary | bool | Главный контакт для этой компании |
| source | text | blitz / pattern_inferred / manual |
| created_at / updated_at | timestamptz | |

---

## app_state

CRM статус — одна строка на пару (client, company).
Обновляется когда клиент меняет статус в трекере.

| Колонка | Тип | Описание |
|---------|-----|---------|
| id | uuid PK | |
| client_id | uuid FK | |
| company_id | uuid FK | → companies |
| status | text | new / sent / replied / meeting / pass |
| updated_at | timestamptz | |
| updated_by | text | leo / philippe / client_name |

UNIQUE: (client_id, company_id)

---

## notes

Append-only лог комментариев. Никогда не удалять строки.

| Колонка | Тип | Описание |
|---------|-----|---------|
| id | uuid PK | |
| client_id | uuid FK | |
| company_id | uuid FK | → companies |
| author | text | leo / philippe / client_name (из client config) |
| body | text | |
| created_at | timestamptz | |

---

## Scoring формула

```
base:          +1  всегда
freshness:     +3 если ≤7d, +2 если ≤14d, +1 если ≤30d
exec level:    +3 TOP (CEO/GF/MD/PDG), +2 MID (Werksleiter/Plant/Usine)
signal type:   +3 MA/CLEVEL, +2 EXPAND/INVEST
multi-signal:  +2 если у компании 2+ сигналов
direct hire:   +1 если не агентство/рекрутёр

routing:       ≥8 PRIORITY | 6-7 HOT | 4-5 WARM | 2-3 COLD
```

---

## Как применять миграции

```powershell
# SSH tunnel (держать открытым в отдельном терминале)
ssh -i ~/.ssh/id_ed25519_hostinger -L 5434:localhost:5434 leonid@152.53.194.162 -N

# Применить миграцию
psql -h localhost -p 5434 -U postgres -d postgres -f db/migrations/003_monitoring_schema.sql
```
