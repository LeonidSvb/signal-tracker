# EXA API — Notes & Research Results
# Philippe Bosquillon signal monitoring

Всё что протестировано, задокументировано, работает и не работает.
Источник: сессия 2026-06-02 (8 часов тестирования).

---

## Архитектура (PRODUCTION)

```
Exa Monitors (33 шт.) → webhook → n8n workflow → Google Sheets + Telegram
```

- **n8n workflow ID:** `0WmBVaYBGDUMfPSl`
- **n8n URL:** n8n.pamelacoreypc.com/webhook/exa-signals
- **Telegram bot:** Philippe Signals bot (credential в n8n)
- **Google Sheet:** вкладка "Signals" (нужно переименовать из дефолтного)

Monitors работают 24/7, результаты приходят автоматически. Никакой ручной работы не нужно.

---

## 33 Production Monitors — IDs

Все ID из `results/monitor_ids.json`. Webhook token: `106ac9af-ab32-4589-9743-8015d559a52c`

| Label | Monitor ID | Query |
|-------|-----------|-------|
| MA\|DE | 01kt44wts4mqbtp807aqpr7dkk | food manufacturing Germany acquisition merger takeover |
| MA\|FR | 01kt44wxaxhk0pp33eqw5d2sxc | food industry France acquisition merger takeover |
| MA\|NL | 01kt44wzjcyrbhg5ekpj415tbg | food production Netherlands acquisition merger |
| MA\|BE | 01kt44x1q4htwf5eax0pvpkmf4 | food company Belgium acquisition merger |
| MA\|CH | 01kt44x4fkhm8xyph1gm76jgaq | food company Switzerland acquisition merger |
| MA\|EU | 01kt44x6z4fj795fkpjtek6hmb | FMCG food Europe acquisition merger deal 2026 |
| CLEVEL\|DE | 01kt44x9cry4m19vs5ccgjeqe2 | food company Germany new CEO appointed HR Director COO |
| CLEVEL\|FR | 01kt44xbjd0hb5j2vadyw3v952 | food company France new CEO appointed HR Director |
| CLEVEL\|NL | 01kt44xe70scmpnqpzy2s90f8g | food company Netherlands new managing director appointed |
| CLEVEL\|BE | 01kt44xgtnphmteazhf5x2bvhc | food company Belgium new CEO director appointed |
| CLEVEL\|DE7 | 01kt44xk9zw5j7pqb8mpw8yp6z | FMCG food Germany leadership change new director |
| CLEVEL\|FR7 | 01kt44xnbs9najw8wky7dj01ff | FMCG food France leadership change new director |
| EXPAND\|DE | 01kt44xqg615qhyz89q9ghr5x4 | food manufacturer Germany new factory plant facility expansion |
| EXPAND\|FR | 01kt44xtggqy0tx4ckwj79n21b | food manufacturer France new facility plant expansion |
| EXPAND\|NL | 01kt44xwp0x44wtrgbwpn5d7m9 | food production Netherlands new facility expansion site |
| EXPAND\|BE | 01kt44xysmknjnxc4dc69bb3y9 | food company Belgium new production facility expansion |
| EXPAND\|EU | 01kt44y13d6gd5nrfdk0vvckvj | food industry Europe new plant production capacity expansion 2026 |
| INVEST\|DE | 01kt44y3fk46wx3wbxzkhctyg3 | food company Germany investment funding raised capital |
| INVEST\|FR | 01kt44y5s1t6wmdd356rsc9578 | food startup France investment funding raised |
| INVEST\|EU | 01kt44y84cgwhgh693ww1t6grw | food ingredients FMCG Europe investment funding 2026 |
| CONTRACT\|DE | 01kt44yajtnvrba9gjn2ne17h8 | food manufacturer Germany major contract partnership signed |
| CONTRACT\|FR | 01kt44ycntwfykantwjaphc30t | food company France contract partnership agreement signed |
| NICHE\|FN-DEFRBE | 01kt44yf0wx0vpv1vqnjreynd4 | site:foodnavigator.com Germany France Belgium acquisition expansion CEO |
| NICHE\|FN-NL | 01kt44yh5k54m2wh8jf9b9d0r2 | site:foodnavigator.com Netherlands Switzerland Austria food 2026 |
| NICHE\|FOODBEV | 01kt44yk7t4j5zf57qp3jm3x17 | site:foodbev.com Europe food acquisition expansion leadership 2026 |
| NICHE\|JUST-FOOD | 01kt44ynk97x81213vn7hxft4q | site:just-food.com Germany France acquisition merger 2026 |
| NICHE\|BAKINGBISCUIT | 01kt44yqja4wb4fmfvzc7y6s2p | site:bakingbiscuit.com Germany France Netherlands acquisition director |
| NICHE\|DAIRYREPORTER | 01kt44ysstwjppmdwrdpn7r6pd | site:dairyreporter.com Germany France Netherlands 2026 |
| SECTOR\|DAIRY-DE | 01kt44yvzhvhdr2w3d0e1g5dpt | dairy company Germany acquisition expansion new facility |
| SECTOR\|BAKERY-EU | 01kt44yyev2cqckxn9191xg6y7 | bakery company Germany France Belgium acquisition expansion 2026 |
| SECTOR\|INGREDIENTS | 01kt44z0j1w8ee4mdnkcmd13q6 | food ingredients Europe acquisition expansion Germany France |
| SECTOR\|MEAT-DE | 01kt44z2jd2z0saxr4fnw8b5sg | meat processing Germany new facility acquisition expansion |
| SECTOR\|BEVERAGE-DE | 01kt44z5537237qkg5meme5c1b | beverage company Germany France acquisition new facility CEO |

---

## Что тестировалось и что работает

### Monitors vs Manual Search (Search API)

Тест 2026-06-02: сравнение Exa Monitors (webhook автоматика) vs ручной Exa Search (тот же запрос).

**Вывод: Monitors = Manual качество + автоматизация**
- 62% новый контент (не было в Session 1, 4-дневная дельта)
- AI synthesis на каждый run — actionable summary, не просто список URL
- Шум: ~13% — приемлемо
- Webhook обязателен (нет polling fallback)
- Доп. стоимость за автоматизацию: +$0.32/неделю (+$1.40/месяц)

### Exa Search vs Apify Indeed для job boards

Критический тест: может ли Exa заменить Apify для поиска вакансий?

**Вывод: НЕТ. Оставляем Apify.**
- Recall: Exa 1/4 (25%) vs Apify Indeed 4/4 (100%) для одних и тех же компаний
- Причина: Exa = семантический веб-поиск → находит специализированные job boards (foodjobs.de, AgriFoodMatch, Top of Minds), но не company-specific страницы Indeed
- Эти job boards = ДОПОЛНИТЕЛЬНЫЙ канал, а не замена

**Опциональное дополнение:** запустить Exa job queries параллельно с Indeed (+$0.05/неделю) — покрывает:
- foodjobs.de (DE food industry specialist board)
- AgriFoodMatch BE/NL (agricultural + food specialist)
- Top of Minds (executive search NL/BE)

### Лучшие monitors по результатам (Session 1 benchmark)

Из `results/search_vs_s1_20260602_2038.txt`:

| Monitor | Score | Качество |
|---------|-------|---------|
| MA\|EU | +8 | KEEP — лучший по M&A EU |
| INVEST\|EU | +6 | KEEP — TAM hits |
| EXPAND\|DE | +5 | KEEP — TAM hits (DMK) |
| SECTOR\|INGREDIENTS | +5 | KEEP |
| MA\|NL | +4 | KEEP — TAM hits |
| CLEVEL\|FR7 | +4 | KEEP |
| NICHE\|FN-DEFRBE | +4 | KEEP |
| NICHE\|FOODBEV | +4 | KEEP |
| NICHE\|JUST-FOOD | +4 | KEEP |

Все 33 monitors оставлены как TRIM (можно обрезать до 3-5 результатов/run) — ни один не удалён.

---

## Стоимость

| Режим | $/неделю | $/месяц |
|-------|---------|---------|
| Manual Search (33 queries) | $0.23 | $0.92 |
| Monitors (automated, 33 queries) | $0.60 | $2.40 |
| Разница за автоматизацию | +$0.37 | +$1.48 |

Стоимость на запрос:
- Exa Search API: $7/1k requests = $0.007/query
- Exa Monitors API: $15/1k requests = $0.015/query (2.14× дороже Search)

---

## API структура — как работает

### Создать monitor

```
POST https://api.exa.ai/monitors
{
  "query": "food company Germany new CEO appointed",
  "numResults": 5,
  "webhookUrl": "https://n8n.pamelacoreypc.com/webhook/exa-signals",
  "startPublishedDate": "2026-01-01"
}
```
Возвращает `id` монитора.

### Получить результаты monitor (polling)

```
GET https://api.exa.ai/monitors/{id}/runs
GET https://api.exa.ai/monitors/{id}/runs/{runId}
```

### Удалить monitor

```
DELETE https://api.exa.ai/monitors/{id}
```

### Search API (ручной запрос)

```
POST https://api.exa.ai/search
{
  "query": "food company Germany acquisition 2026",
  "numResults": 5,
  "startPublishedDate": "2026-01-01",
  "useAutoprompt": true
}
```

Headers: `x-api-key: <EXA_API_KEY>` (из `.env` в корне проекта)

---

## Скрипты (в exa/scripts/)

| Файл | Что делает |
|------|-----------|
| `2026-06-02-test-exa-monitors.py` | Тест A vs B: monitors vs search vs indeed. Основной исследовательский скрипт |
| `2026-06-02-monitors-full-run.py` | Создаёт все 33 monitors, запускает, собирает результаты, сравнивает с S1 |
| `2026-06-02-search-all33-vs-s1.py` | Ручной Search по 33 queries, сравнение с S1 ground truth |
| `2026-06-02-collect-monitor-results.py` | Собирает результаты уже созданных monitors через /runs API |
| `2026-06-02-poll-monitor-runs.py` | Polling runs до получения результатов (с retry/timeout) |
| `2026-06-02-finalize-monitor-test.py` | Финализация и форматирование результатов теста |

---

## Результаты (в exa/results/)

| Файл | Содержимое |
|------|-----------|
| `monitor_ids.json` | Все 33 monitor IDs + webhook_token (КРИТИЧНО — не удалять) |
| `exa_cache.json` | Session 1 (2026-05-29): 108 URLs из 33 queries = ground truth |
| `monitor_test_final_20260602.txt` | Итоговый тест monitors: 6 queries × 5 results, verdict |
| `full_run_final_20260602_2035.txt` | Все 33 monitors polled — score per monitor |
| `search_vs_s1_20260602_2038.txt` | Search API vs Session 1 — score + KEEP/TRIM/DELETE рекомендации |
| `full_run_20260602_2034.txt` | Промежуточный полный прогон |
| `exa_test_log.csv` | Raw лог всех тестовых API calls |

---

## Что НЕЛЬЗЯ делать

- Удалять monitors без обновления `monitor_ids.json` — потеряем связь с production
- Менять webhook URL в мониторах без обновления в n8n
- Запускать `monitors-full-run.py` заново — создаст новые 33 monitors и потратит ~$0.50

---

## Следующие шаги

- [ ] Переименовать Google Sheet вкладку в "Signals" (не сделано)
- [ ] Добавить TAM-фильтр в n8n: если компания из companies_pass.csv → Telegram alert
- [ ] Опционально: добавить Exa job board queries (+$0.05/неделю) для foodjobs.de/AgriFoodMatch
- [x] Exa Finder тест (company description + people search) — DONE 2026-06-29

---

## Exa Finder API — Test Results (2026-06-29)

**Цель:** проверить может ли Exa заменить Blitz для (a) получения описания компании (ICP scoring) и (b) поиска контактов.

**Контекст:** 74% сигнальных компаний (54/73) НЕ в нашей Blitz DB. Blitz scrape был ограничен фильтрами по keywords/employees. Exa Finder должен заполнить этот gap.

**Скрипт:** `signals/exa/test_finder.cjs`
**Результаты:** `signals/exa/results/exa_finder_test_2026-06-29.json` + `exa_finder_summary_2026-06-29.json`

---

### Test A: Company Description (для ICP scoring)

**Метод:** `POST /search` с `includeDomains: [company.domain]` + `contents.text`

**Результат: 10/10 (100%)** для Cat2 food companies

| Компания | Страна | Emp | Описание найдено | Качество |
|---------|-------|-----|-----------------|---------|
| Ardo | BE | 1251 | YES | "fresh-frozen vegetables, herbs, fruits to foodservice, industry, retail" |
| Intersnack Deutschland SE | DE | 429 | YES | корп сайт с рекрутинговой страницей |
| DMK Deutsches Milchkontor | DE | 1005 | YES | молочный кооператив, 4+ мл. тонн молока |
| St Michel Biscuits | FR | 924 | YES | французские бисквиты + рекрутинговая страница |
| Henry Lambertz GmbH & Co KG | DE | 256 | YES | Lambertz Group, нац. + интерн. производство |
| Fromageries de L'Ermitage | FR | 246 | YES | сыр, "la nature qui dicte sa loi" |
| Famille Michaud Apiculteurs | FR | 202 | YES | мёд, "natural sweetener specialist for over 100 years" |
| Saturn Petcare | NL | 224 | YES | корм для животных, Werken Bij страница |
| Servair | FR | 2577 | YES | авиационный кейтеринг + food service |
| Edgard & Cooper | BE | 289 | YES | nat. pet food, "naturally tasty cat & dog food" |

**Вывод:** домен → `/search` с `includeDomains` даёт описание, достаточное для ICP scoring.

---

### Test B: People Search (для поиска контактов)

**Метод:** `POST /search` с `category: "linkedin profile"` + три уровня запросов:
- B1: CEO / MD / Directeur Général / Geschäftsführer
- B2: Plant Director / Werksleiter / Operations Director
- B3: HR Director / DRH / Personalleiter

**Результат: 14/14 (100%)** — все компании (Cat1 + Cat2), все 3 уровня

| Tier | Companies hit | Avg profiles/company |
|------|-------------|---------------------|
| B1 (execs) | 14/14 | 5 |
| B2 (ops/plant) | 14/14 | 5 |
| B3 (HR) | 14/14 | 3 |

**Примеры реального матча:**

| Компания | Профиль | Должность | LinkedIn URL |
|---------|---------|----------|-------------|
| Hügli Nahrungsmittel | Eric Overbeek | CEO Hügli & Board Bell Food Group | linkedin.com/in/eric-overbeek-7668043 |
| Hügli Nahrungsmittel | Dirk Balzer | COO Hügli | linkedin.com/in/dirk-balzer-01b865164 |
| Ardo | Sabine Sagaert | CEO at Ardo | linkedin.com/in/sabinesagaert |
| St Michel Biscuits | Bruno Rousseau | (President) | linkedin.com/in/bruno-rousseau-a801baa4 |

Профили точно соответствуют компании — в тексте профиля явно указана должность и название компании (не просто упоминание).

---

### Ограничения

1. **Нет email** — Exa возвращает LinkedIn URL, не email. Нужен отдельный шаг: LinkedIn URL → email через Blitz/Hunter/pattern.
2. **Точность имён** — для компаний с неуникальным именем ("Saturn") могут быть false positives. Рекомендация: всегда добавлять страну и сферу в запрос.
3. **Стоимость** — 3 запроса на people + 2-3 на company = ~5-6 запросов/компанию = ~$0.035-0.042 на компанию. Для 54 пропущенных компаний = ~$2 total.

---

### Вывод: Exa Finder = game changer

До теста: 74% сигнальных компаний без контактов и без описания для ICP.

После теста: **Exa покрывает 100%** — описание и LinkedIn профили директоров для КАЖДОЙ компании.

**Рекомендуемый pipeline (новый):**

```
Новый сигнал → lookup в blitz_all_scored (by LinkedIn URL / domain)
  ├── FOUND + contacts → L1: send immediately
  ├── FOUND, no contacts → L2: Exa People search → get LinkedIn URLs → Blitz email
  └── NOT FOUND → L3: Exa Company search → description → LLM ICP score
                      → if PASS: Exa People search → contacts
                      → if REJECT: skip
```

**Следующий шаг:** запустить этот pipeline на всех 54 Cat2 компаниях + 481 needs_website компаниях.
