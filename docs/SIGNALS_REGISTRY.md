# SIGNALS_REGISTRY — Philippe Bosquillon

Единый источник правды по всем типам сигналов.
Когда непонятно, какой сигнал важнее — читай этот файл.
Последнее обновление: 2026-06-09

---

## Outreach capacity Philippe

- LinkedIn InMail: **50/месяц** (Sales Navigator лимит)
- Email со своего ящика: без лимита
- Звонок: **не используется сейчас**, но телефоны можно достать через Datagma/Lusha — это разблокирует сильный канал

При ~75 новых сигналах в месяц — нужна жёсткая приоритизация. Philippe не может обработать всё сам.

---

## Тип 1: JOB BOARD сигналы

**Источники:** LinkedIn / Indeed / StepStone / Xing / Cadremploi

**Что это:** компания публично разместила вакансию на управленческую должность в food production.

**Почему важно для Philippe:** когда компания нанимает Werksleiter или Directeur Usine — она либо расширяет производство, либо меняет руководство. Новый операционный руководитель ищет партнёров, хочет показать результат в первые 90 дней. Момент входа — до того, как он обосновался и выстроил пул поставщиков. После 60 дней окно закрывается.

### По уровню руководителя

| Уровень | Примеры | Ценность | Кол-во/месяц |
|---------|---------|---------|-------------|
| TOP | Geschäftsführer, Managing Director, Directeur Général, PDG | Принимает решение сам. Первый контакт = сразу ЛПР. Редко | ~5 |
| MID | Werksleiter, Betriebsleiter, Plant Director, Directeur Usine | Влияет на закупки, рекомендует CEO. Основной объём | ~15 |
| SUPPORT | Personalleiter, DRH, Directeur Commercial | Компания в росте, но не прямой buyer. Низкий приоритет | ~10 |

### Источники — что когда запускать

| Источник | Страны | Частота | Стоимость | ICP/run |
|---------|--------|---------|-----------|---------|
| LinkedIn | DE/FR/NL/BE | Еженедельно | ~$0.20 | 6–10 |
| StepStone | DE | Еженедельно | ~$0.15 | 3–5 |
| Xing | DE | Еженедельно | ~$0.05 | 2–3 |
| Cadremploi | FR | Еженедельно | ~$0.10 | 2–4 |
| Indeed | FR only | Раз в месяц | ~$0.50 | 5–8 |

Indeed DE не работает — staffing agencies доминируют результаты. DE покрывается через LinkedIn + StepStone + Xing.
NL/BE через dedicated акторы не работает (проверено 2026-06-09) — LinkedIn достаточно.

---

## Тип 2: EXA NEWS сигналы

**Источник:** 33 Exa Monitors → n8n webhook → Google Sheets + Telegram (автоматически, 24/7)

**Что это:** мониторинг новостей food industry Europe по 33 темам.

**Почему важно для Philippe:** outreach с контекстом в 3× эффективнее чем холодный. Вместо "хочу познакомиться" → "видел новость X, у меня есть опыт именно с этим". Каждый тип новости = конкретный угол захода.

### По типу новости

| Тип | Пример | Почему ценен | Угол outreach |
|-----|--------|-------------|--------------|
| **New C-Level** | Ritter Sport назначает двух CEO | Новый лидер не успел выстроить пул партнёров. Окно 30–60 дней | "Поздравляю с назначением — хотел бы познакомиться" |
| **M&A** | Müller покупает Berief Food | После сделки: интеграция заводов, реструктуризация, новые потребности в операциях | "Слышал о поглощении — как планируете интегрировать производство?" |
| **Expansion** | Lotus Bakeries расширяет завод | Рост производства = новые потребности в персонале, процессах, поставщиках | "Видел про расширение — когда запускаетесь? Работал с похожим кейсом у X" |
| **Investment** | Cargill $150M во Франции | Новые деньги = новые проекты = открытость к новым решениям и партнёрам | "Большая инвестиция — что изменится в производственном процессе?" |
| **Contract/Partnership** | ID Logistics × General Mills | Смена партнёра = переходный период, открытость к переменам | Контекстный, низкий приоритет |
| **Sector/Industry News** | Тренд plant-based dairy | Общий рыночный контекст. Не прямой buyer signal | Фоновый, использовать только в связке с другим сигналом |

**Плотность:** ~25 сигналов/неделю, из них ~7 actionable (C-Level + M&A + Expansion)
**Стоимость:** ~$2.40/месяц

---

## Стоимость системы

| Источник | Апифай-аккаунт | $/месяц |
|---------|----------------|---------|
| LinkedIn | KAD2 | ~$0.80 |
| StepStone | KAD2 | ~$0.60 |
| Xing | KAD1_BLOCKED | ~$0.20 |
| Cadremploi | KAD2 | ~$0.40 |
| Indeed FR | KAD1_BLOCKED | ~$0.50 |
| Exa Monitors | — | ~$2.40 |
| **ИТОГО** | | **~$4.90/месяц** |

Apify free tier $5/аккаунт × 2 аккаунта = $10/месяц покрывает job boards с запасом.

---

## Скоринг (0–10)

Каждый сигнал получает итоговый score. Используется для сортировки в Google Sheet.

| Критерий | Баллы |
|---------|-------|
| TAM match (компания в companies_pass.csv) | +3 |
| Уровень TOP exec (CEO/GF/MD/PDG) | +3 |
| Уровень MID exec (Werksleiter/Plant/Usine) | +2 |
| Тип новости: New C-Level или M&A | +2 |
| Тип новости: Expansion или Investment | +1 |
| Свежесть ≤7 дней | +3 |
| Свежесть 8–14 дней | +2 |
| Свежесть 15–30 дней | +1 |
| Multi-signal (2+ сигналов от компании) | +2 |
| Прямой найм (не рекрутер, не агентство) | +1 |

### Routing по score

| Score | Уровень | Действие |
|-------|---------|---------|
| 8–10 | PRIORITY | Philippe: персональный InMail + готовим brief (1 абзац: компания, сигнал, угол) |
| 6–7 | HOT | Philippe: LinkedIn InMail с контекстом сигнала |
| 4–5 | WARM | Мы: email от имени Philippe (approve template) |
| 2–3 | COLD | Мы: batch email sequence |
| 0–1 | ARCHIVE | Не трогаем, сохраняем как контекст |

---

## Blacklist — staffing agencies

Компании ниже нанимают работников НА заводы — они не food manufacturers и не покупатели Philippe.
Их вакансии = шум, не сигнал. Фильтруем до enrichment.
Полный список: `signals/blacklist.json`

- Bluetec Production GmbH & Co. KG
- be4solutions GmbH
- Delphi HRC GmbH
- Heberlein Consultants
- CABINET ACP ATLANTIQUE (рекрутер, FR)
- Martens & Brijs (рекрутер, BE)

---

## Multi-signal компании — приоритет вне очереди

Компания с 2+ сигналами = hiring surge = обращаемся первыми.

Текущие (June 2026):
- **Planted** [TAM] — Managing Director + Head of Quality (3–20d) → score MAX
- **Aviko** [TAM] — Produktionsleiter + Bereichsleiter Produktion (11–15d) → score MAX
- **Agrial** — Directeur Usine ×2 (6d) → HOT
- **Nestlé** — DE + FR сигналы (19d) → HOT

---

## Статус архитектуры (June 2026)

- [x] Exa Monitors — запущены, 24/7, → Google Sheets + Telegram
- [x] LinkedIn, StepStone, Xing, Cadremploi, Indeed — протестированы, конфиги готовы
- [ ] scanner.mjs — weekly cron для job boards (следующий приоритет)
- [ ] Enrichment pipeline — email + phone через Datagma (следующий после scanner)
- [ ] Google Sheet для Philippe — отформатировать + первый дамп сигналов
