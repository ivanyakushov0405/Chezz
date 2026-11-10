# F6. Стратегия тестирования и Definition of Done

Статус: утверждён Ivan 2026-11-05, версия 0.7 от 2026-11-10 (ждёт утверждения Ivan): процесс `/epic` по умолчанию — V24 (3.4), разделы 1, 4. Версия 0.6 от 2026-11-07: apply E03 (design E03 утверждён Ivan 2026-11-07) — 7.3, сигнатура `startApp` (`time?`, `sentry?`, `metricsUrl`, `analytics`, `sentryEvents()`); новых решений нет. Версия 0.5 от 2026-11-07: apply E01 (проект `web`), сверка E01 с реализацией — V1, разделы 6, 7.3, 9, 11, 12 (E01 v0.3, утверждено Ivan 2026-11-07); новых решений нет. Версия 0.4 от 2026-11-05 — reopen этапа 1R (решение Ivan: F1–F6 одним заходом), точечные правки из OPERATIONS §23 п.10–11 и сверка 18.2 п.8 с OPERATIONS (решения V20–V22 в 3.3, ответ — `docs/setup/reviews/F6-reopen-response-r1.md`). Версия 0.3 утверждена Ivan 2026-11-04 (ответы на ревью и решения человека — `docs/setup/reviews/F6-response-r1.md`, `docs/setup/reviews/F6-response-r2.md`). Основа: `docs/TZ.md` v0.1, `docs/setup/BUSINESS.md`, `docs/GLOSSARY.md` v0.4, `docs/ARCHITECTURE.md` v0.5, `docs/SECURITY.md` v0.4, `docs/API_CONVENTIONS.md` v0.4, `docs/DESIGN_SYSTEM.md` v0.4 (reopen 1R, утверждены Ivan вместе с этой версией 2026-11-05), `docs/OPERATIONS.md` v0.5 (утверждён 2026-11-05).
Утверждает: Ivan (BUSINESS D9).

Как читать: агент открывает только нужный раздел. 1 — правила, 2 — исходные цифры, 3 — решения (3.1 раннеры, владельцы, инфраструктура; 3.2 e2e, нагрузка, CI, приёмка; 3.3 решения reopen 1R; 3.4 процесс `/epic`), 4 — кто какие тесты пишет, 5 — уровни и места, 6 — команды, 7 — тестовая инфраструктура (7.1 PostgreSQL, 7.2 управляемое время, 7.3 запуск `app` и вход, 7.4 фикстуры шахмат, 7.5 векторы Glicko-2, 7.6 сид), 8 — критерии приёмки ТЗ §7 → тесты, 9 — e2e, 10 — нагрузочный тест, 11 — сводка проверок F2–F5, 12 — что в задаче и что в CI, 13 — DoD задачи, 14 — DoD фичи, 15 — падения и нестабильные тесты, 16 — чего не делаем, 17 — план роста, 18 — открытые вопросы и правки для reopen. Номера: решения `V#`, вопросы `F6-Qn`; ссылки — `ARCHITECTURE A#` / `§N`, `SECURITY S#` / `§N`, `API P#` / `§N`, `DESIGN U#` / `§N`, `GLOSSARY G#`.

Что читать по роли:
- tester: 1, 4, 5, 7, 8; для e2e — 9; для нагрузки — 10.
- developer: 1, 4, 5, 6, 7.1–7.3, 13.
- reviewer: 11, 13, 14.
- devops (F7) и profile-builder (F8): 5, 6, 12.

## 1. Правила для агентов

- MUST: каждый AC задачи покрыт хотя бы одним тестом, номер AC — в начале имени теста: `it("AC-3: повтор game.move с тем же ply → ply_mismatch, второго хода нет")`. Каждая строка edge cases задачи — отдельный тест с её номером `EC-n` (номер строки в таблице edge cases `requirements.md` или `design.md`): `it("EC-2: принятие вызова в момент истечения 30 мин → challenge_expired")`. Тест на AC и строку сразу — оба номера: `"AC-3 EC-2: …"`. reviewer сверяет списки AC и EC с именами тестов (`grep -rn "AC-\|EC-"`).
- MUST: тесты пишет автор кода в том же шаге (раздел 4, режим `/epic`, V24). В областях слепых тестов — фикстуры `packages/chess`, векторы Glicko-2, схемы и снимок `packages/protocol` — tester пишет тесты до кода и не читает реализацию; автор кода их не правит, спор решает Ivan (в `/feature` — arbiter). В `/epic` номер в имени теста — критерий брифа: `"К-3: …"`, `"К-3 E-2: …"`.
- MUST: тест лежит в папке своего уровня (раздел 5); новый уровень или папка — только правкой этого документа.
- MUST: работа с БД в тестах — реальная PostgreSQL в Docker (7.1). MUST NOT: моки `repo`, Kysely или `pg` в интеграционных и contract-тестах.
- MUST: время в тестах сервера — через `ManualTimeSource` (7.2). MUST NOT: ждать реальное время ради таймеров партии (флаг, 30 с первого хода, 60 с переподключения, окно выбора 30 с).
- MUST NOT: флаги и режимы в коде `app` только для тестов — тестовый вход, ускорение часов, отключение проверок (SECURITY §4, S26). Тест управляет `app` только через параметры `buildApp` (7.3) и сид (7.6).
- MUST NOT: `.only`, `.skip`, `.todo` и `test.fixme` в ветке на PR — ловит ESLint (раздел 11). Единственное исключение — `it.skipIf` для векторов вида C в `glicko2-vectors.test.ts` (7.5).
- MUST NOT: тесты, зависящие от порядка запуска или от данных другого теста; каждый файл готовит свои данные фабриками (7.6).
- MUST NOT: сеть наружу в тестах (Google, Sentry, npm). Google в тестах не вызывается (7.3).
- MUST: падение теста, которое не повторилось, — не «перезапустить и забыть»: раздел 15.

## 2. Исходные цифры

| Что | Значение | Источник |
|---|---|---|
| Кто пишет и сопровождает | 1 человек (Ivan) с агентами | BUSINESS D4 |
| Хостинг | 1 небольшой VPS (ориентир 2 vCPU / 4 ГБ), staging по требованию | BUSINESS D6; ARCHITECTURE §5, A17 |
| CI | GitHub Actions | ТЗ §6; BUSINESS §1.6 |
| Минуты CI | Репозиторий публичный: минуты GitHub Actions на стандартных runner без лимита. Ограничение — только время ожидания: таймауты job (раздел 12) | человек, утверждение F6, 2026-11-04 (F6-Q1) |
| Node.js | 24 LTS: `.ts` запускается напрямую (`node file.ts`, удаление типов) | ARCHITECTURE A2 |
| Нагрузка для теста | 150 онлайн, 75 партий, p95 доставки хода ≤ 150 мс | ТЗ §1, §5, §7 |
| Трафик пика | ≤ 100 сообщений WebSocket/с, ≤ 20 REST/с | BUSINESS D2 (допущение) |

Вывод: никакой отдельной тестовой инфраструктуры (стенда, фермы браузеров, SaaS нагрузки). Всё запускается одной командой на ноутбуке Ivan или в одном runner CI. Нагрузка (нужен staging) и e2e в WebKit и Firefox (локально у Ivan) — по требованию, перед этапами 5 и 6 (ТЗ §7), не на каждый PR: на каждом PR они удлиняли бы ожидание.

## 3. Таблица решений

Источники: ТЗ, бизнес, по умолчанию, ревью. У «по умолчанию» — более простая альтернатива и почему не она.

### 3.1. Раннеры, владельцы, инфраструктура

| № | Решение | Источник | Альтернатива и почему не она |
|---|---|---|---|
| V1 | Один раннер — Vitest — для unit, интеграционных и contract-тестов во всех `apps/*` и `packages/*`; четыре проекта Vitest — `unit`, `web` (jsdom), `int`, `contract` (раздел 6) | по умолчанию | `node:test` — без зависимостей, но нет jsdom для React, проектов и `--changed`. Jest — медленнее и сложнее с ESM + TS |
| V2 | Владельцы: tester — contract, acceptance, фикстуры, e2e, нагрузка; developer — unit и интеграционные своего модуля (раздел 4) | по умолчанию (роли конвейера `/feature`) | Все тесты пишет developer — проще, но тесты проверяют то, что написано, а не то, что требовалось |
| V3 | Интеграционные и contract — реальная PostgreSQL в Docker: один контейнер, отдельная база на воркер Vitest из шаблона с миграциями (7.1) | по умолчанию; ARCHITECTURE A7, A18 | pg-mem / SQLite — нет `FOR UPDATE`, частичных индексов, jsonb, на которых держатся A25 и §9.2. Testcontainers — ещё зависимость и минуты на старт контейнера в каждом прогоне |
| V4 | Contract-тесты поднимают `app` в процессе теста (`buildApp`, случайный порт) и ходят настоящими HTTP и WebSocket (7.3) | по умолчанию | Тест против собранного образа — медленнее и не даёт подменить время |
| V5 | Время сервера — через внедряемый `TimeSource`; в тестах — `ManualTimeSource` с `advance(ms)` (7.2) | ТЗ §4.6, §7; ARCHITECTURE §7.2, A9; способ — по умолчанию | Глобальные `vi.useFakeTimers()` — ломают таймеры драйвера `pg` и `ws`; реальное ожидание — минуты на один тест флага |
| V6 | Вход в тестах — Session из сида или фабрики, cookie `__Host-sid` ставит тест; Google не вызывается | SECURITY §4, S26 | Тестовый вход в `app` — запрещён F3 |
| V7 | Формат фикстур шахмат `fixtures/chess/*.json` (7.4) | ТЗ §7; ARCHITECTURE A15, §10; формат — по умолчанию | — |
| V8 | Формат и допуски векторов `fixtures/glicko2/*.json` (7.5) | ТЗ §4.7, §7; ARCHITECTURE A12, §11; формат — по умолчанию | — |
| V9 | Детерминированный сид `apps/server/scripts/seed.ts` — для локальной разработки, e2e, staging и нагрузки; на `APP_ENV=prod` отказывается работать (7.6) | SECURITY S26; по умолчанию | SQL-дамп с данными — расходится со схемой после каждой миграции |

### 3.2. E2E, нагрузка, CI, приёмка

| № | Решение | Источник | Альтернатива и почему не она |
|---|---|---|---|
| V10 | E2E — Playwright. В CI — только Chromium: десктоп 1280 и телефон 360; WebKit и Firefox — вручную перед этапами 5 и 6 (раздел 9) | ТЗ §5 «Браузеры», «Адаптивность», §7; инструмент — по умолчанию (закрывает «инструмент — F6» в DESIGN §17) | Без e2e — нечем проверить критерии ТЗ §7 про 360 px, RU/EN и «2 клика». Cypress — нет WebKit, неудобны две вкладки двух игроков. Все браузеры в CI — job e2e втрое дольше на каждом PR, а различия движков важны к этапам 5 и 6 |
| V11 | Нагрузочный тест — свой скрипт Node.js на `ws` (`tests/load/`), запускается контейнером на том же VPS против staging через `edge`; пороги — раздел 10 | ТЗ §5, §7; ARCHITECTURE §5 (место генератора — F6); способ — по умолчанию | k6 — ещё инструмент, и задержку «ход игрока A → событие у игрока B» трудно связать между виртуальными пользователями. Генератор в runner GitHub — в p95 попадёт сеть до VPS из неизвестного региона (ТЗ §5: «внутри одного региона») |
| V12 | CI на каждый push в PR и в `main`: два параллельных job — `check` и `e2e`, таймауты 15 и 20 мин (раздел 12). Минуты не ограничены (V18) | бизнес (D4, D6, D7); человек, утверждение F6 (F6-Q1); по умолчанию | Один job — проще, но e2e ждёт статику и тесты, прогон дольше на 5–7 мин |
| V13 | Порога покрытия нет; вместо него — связь AC → тест (раздел 1) и таблица критериев ТЗ (раздел 8) | по умолчанию | Порог 80% — проще измерить, но поощряет тесты без утверждений и не говорит, проверен ли AC |
| V14 | Повтор упавшего теста — только e2e в CI, один раз; повторно прошедший помечается нестабильным (раздел 15) | по умолчанию | Без повторов — сетевые случайности в e2e блокируют PR; повторы везде — прячут гонки в `GameRoom` |
| V15 | Нагрузочный тест — обязателен перед этапом 5 и перед этапом 6 (ТЗ §7), дальше — по признакам ARCHITECTURE §15 | ТЗ §7; по умолчанию | На каждый PR — каждый раз поднимать staging и 12 мин ожидания, к тому же в часы без игроков (ARCHITECTURE §5); прогон в CI-runner меряет не то (V11) |
| V16 | Восстановление после перезапуска — contract-тест: два `buildApp` подряд на одной базе (8) | ТЗ §5, §7; ARCHITECTURE §9.3 | Перезапуск контейнера в e2e — медленно и только в одном сценарии |
| V17 | Настоящий вход через Google проверяет Ivan вручную на staging по smoke-списку (F7); для приёмки этапа 5 этого достаточно, как и ручного Lighthouse для первой отрисовки (раздел 8) | SECURITY S1, S33; человек, утверждение F6, 2026-11-04 (F6-Q4) | Автотест входа в Google — нужен тестовый аккаунт Google и обход капчи; ломается от изменений Google |
| V18 | Репозиторий публичный: лимита минут CI нет; расчётов под лимит нет, остаются таймауты job | человек, утверждение F6, 2026-11-04 (F6-Q1). Публичным становится весь репозиторий (бэкенд, `deploy/`, `docs/`, `.claude/`), а не только фронтенд по DESIGN U33; последствия для секретов и форков F3 и F7 не учитывали — проверить при reopen F3 и при создании F7 (18.2 п.8, п.10) | — |
| V19 | Обязательные статус-проверки для мержа в `main` — `check` и `e2e`; `e2e` при изменениях только `docs/**` пропускается условием `if` шага внутри job, и job завершается успехом (раздел 12) | ревью r1 (consistency-4, consistency-7); по умолчанию | Фильтр `paths` на workflow — проще, но обязательная проверка висит «ожидается» и PR документов не смержить |

### 3.3. Решения reopen 1R (2026-11-05)

| № | Решение | Источник | Альтернатива и почему не она |
|---|---|---|---|
| V20 | На staging токен Session сид-игроков `--demo` — `HMAC-SHA256(SEED_TOKEN_SECRET, ник)`; без переменной (локально, CI) — как прежде, из фиксированного генератора сида. `--load` секрет не использует ни в одной среде: случайные токены `randomBytes(32)`, в файл `--tokens` — строка `ник<TAB>токен` (формат файла — по умолчанию) (7.6) | ревью (reopen: OPERATIONS §23 п.10, O15 — человек, публичный репозиторий; reopen r2, agentability-9 — разведение режимов) | Фиксированные токены и на staging — код сида публичен, любой войдёт сид-игроком |
| V21 | Smoke staging — `--project=desktop`, `E2E_BASE_URL` = `vars.APP_ORIGIN`, в job `staging` `deploy.yml` после SSH-шагов (9); нагрузка — в контейнере `tools-staging` через `load.yml`, `LOAD_BASE_URL` = `APP_ORIGIN`, отчёт — по пути `LOAD_REPORT` (10) | ревью (reopen: OPERATIONS §23 п.11; OPERATIONS §9.6, §11) | — |
| V22 | PostgreSQL для тестов — 18 (`postgres:18`), как prod (7.1) | ревью (reopen: OPERATIONS §23 п.11; OPERATIONS §6.1, §6.4) | — |
| V23 | Токен V20 — одна функция `seedSessionToken` (base64url, 43 символа) в `apps/server/test/support/seed-token.ts` для сида и e2e; smoke на staging — без trace, видео, скриншотов и HTML-отчёта, токены маскируются `::add-mask::` (7.6, 9) | ревью (reopen r1: agentability-3, security-2); по умолчанию | Соль запуска `HMAC(секрет, run_id ‖ ник)` — cookie жила бы один подъём, но нужна правка утверждённого F7 (`up` и шаг smoke); вернуться при reopen F7 |

### 3.4. Процесс `/epic` (2026-11-10)

| № | Решение | Источник | Альтернатива и почему не она |
|---|---|---|---|
| V24 | Режим по умолчанию — `/epic`: все уровни тестов пишет автор кода в том же шаге; tester до кода — только области слепых тестов (фикстуры шахмат, векторы Glicko-2, `packages/protocol`); одно ревью на эпик. Меняет V2 для режима `/epic`; `/feature` — как прежде (раздел 4) | Ivan, 2026-11-10 (разбор E03: 805 строк кода, 2 690 строк тестов, 10,5 млн токенов, одна настоящая ошибка на ревью); `docs/PIPELINE_DECISIONS.md` §13 | V2 везде — независимость тестов, но на эпиках без внешнего эталона она дублирует тесты автора и тратит в 5 раз больше времени. Независимость оставлена там, где правду задаёт ТЗ или эталон |

## 4. Кто какие тесты пишет

**Режим `/epic` (по умолчанию, V24).** Все уровни раздела 5 — unit, int, contract, acceptance, e2e — пишет автор кода в том же шаге. tester до кода — только области слепых тестов: фикстуры `packages/chess`, векторы Glicko-2, схемы и снимок `packages/protocol`; для них действуют таблица ниже и «Шаг tester до кода». Владелец «tester» в разделах 5, 11, 12, 13 вне этих областей читается как «автор кода»; AC-n / EC-n — как критерии брифа К-n / E-n. reviewer — одно ревью на эпик (`.claude/agents/reviewer.md`, режим «эпик»). Таблица ниже целиком — режим `/feature`.

| Роль | Пишет | Когда | Не делает |
|---|---|---|---|
| tester | contract-тесты REST и WebSocket по `design.md` и `docs/API_CONVENTIONS.md` §12–13; acceptance-тесты публичных функций, указанных в `design.md` (векторы Glicko-2); фикстуры `fixtures/**` и их прогон; e2e-сценарии фичи; сценарий нагрузки | шаг 1 задачи T-N (до разработчика); e2e — этап 3 фичи, прогон — задача `[e2e]`; нагрузка — отдельная фича перед этапом 5 | не читает `apps/server/src/**`, `apps/web/src/**`, `packages/chess/src/**`; не пишет unit-тесты; не правит код |
| developer | unit-тесты `domain/`, функций и компонентов рядом с кодом; интеграционные тесты `service` + `repo` своего модуля; тесты-проверки F2 §7.4, F4 §16, F5 §17, если их владелец — его зона (раздел 11); тестовые утилиты `apps/server/test/support/` (задача скелета) | вместе с кодом в той же задаче | не правит тесты tester (спор → arbiter) |
| reviewer | ничего не пишет; сверяет DoD задачи (раздел 13), пункты «ревью» раздела 11, наличие теста на каждый AC и на каждую строку edge cases | шаг 5 задачи | — |
| arbiter | решает спор «тест неверен»: CODE / TEST / PLAN / REQUIREMENTS | по запросу | — |
| Ivan | ручные проверки: вход через Google на staging (V17), WebKit и Firefox (раздел 9), запуск нагрузки (раздел 10) | перед этапами 5 и 6, перед выкаткой по F7 | — |

Шаг tester «до кода» (шаг 1 задачи) готов, когда:
1. На каждый AC и каждую строку edge cases задачи есть тест с `AC-n` / `EC-n` в имени (раздел 1).
2. Компиляция и линт — две команды, обе проверяемые:
   - `npx eslint <новые файлы тестов>` — 0 ошибок;
   - `npx tsc -b --pretty false 2>&1 | grep "error TS" | grep -v -E "error TS(2307|2305):"` — пусто. Разрешены только TS2307 (модуля нет) и TS2305 (экспорта нет), и только для путей и имён из «Публичных интерфейсов для тестов» `design.md` — сверить глазами по выводу `tsc`. Заглушки в `src/` tester не создаёт.
   - contract- и e2e-тесты импортируют только `apps/server/test/support/**`, `tests/e2e/support/**` и `packages/protocol` — они уже есть, поэтому у таких тестов ошибок `tsc` нет совсем. TS2307/TS2305 бывают только у acceptance-тестов и прогона фикстур, если в задаче появляется новая публичная функция.
3. Тесты запущены командой одного файла (раздел 6) и красные по одной из двух допустимых причин: (а) утверждение не выполнено (ожидали `ply_mismatch` — пришло другое, маршрут вернул 404); (б) у acceptance-теста и прогона фикстур — «модуль или экспорт не найден» ровно для имени из п.2. Падение `startApp`, БД, фабрики или синтаксиса — шаг не готов.
4. После developer (DoD задачи, раздел 13) `npm run check` полностью зелёный, без исключений п.2.
5. В ответе оркестратору — список файлов, покрытие AC/EC и команда запуска каждого файла.

- Что tester может читать: `design.md` (разделы «Публичные интерфейсы для тестов», «Выжимка правил», своя задача), `packages/protocol/**` (это контракт), `packages/i18n/**`, `apps/server/test/support/**`, существующие тесты.
- Пример: задача «принятие вызова» (ТЗ §4.3). tester до кода пишет contract-тесты `acceptChallenge`: свой вызов → `own_challenge`; вызов истёк (`ManualTimeSource.advance(30 мин)`) → `challenge_expired`; принявший в партии → `player_busy`. developer пишет unit-тест категории своего контроля и интеграционный тест частичного индекса «1 открытый вызов» (ARCHITECTURE §9.1 п.3).

## 5. Уровни и где лежат

| Уровень | Что проверяет | Где | Файлы | Владелец | Проект Vitest / инструмент |
|---|---|---|---|---|---|
| unit | чистая логика и компоненты без БД и сети: `domain/` (часы, окно подбора, Glicko-2), `packages/chess`, `packages/protocol`, `packages/i18n`, функции и компоненты `apps/web` (jsdom) | рядом с кодом | `*.test.ts`, `*.test.tsx` | developer | `unit`; `apps/web` — `web` (jsdom) |
| интеграционный | `service` + `repo` модуля с реальной PostgreSQL: транзакции, блокировки, индексы, SQL лидеров | рядом с кодом в `apps/server/src/<модуль>/` | `*.int.test.ts` | developer | `int` |
| contract | поведение `app` снаружи: REST (API §12), WebSocket (API §8–10, §13), права (SECURITY §7), ошибки (API §5.2), восстановление (8) | `apps/server/test/contract/<область>/` | `*.test.ts` | tester | `contract` |
| acceptance | публичные функции из `design.md` против эталона ТЗ: векторы Glicko-2 | `apps/server/test/acceptance/` | `*.test.ts` | tester | `unit` |
| фикстуры | правила шахмат ТЗ §7 через публичный API `packages/chess` | данные `fixtures/chess/`, `fixtures/glicko2/`; прогон `packages/chess/test/` | `*.json`, `*.test.ts` | tester | `unit` |
| e2e | сценарии игрока в браузере: два игрока, 360 px, RU/EN | `tests/e2e/` | `*.spec.ts`; утилиты — `tests/e2e/support/` | tester | Playwright |
| нагрузка | 150 онлайн, 75 партий, p95 ≤ 150 мс | `tests/load/` | `run.ts`, `games/*.pgn` | tester | Node.js + `ws` |
| статика | типы, линтеры, границы модулей, сверка документов с кодом | конфиги в корне, `scripts/` | — | developer зоны (раздел 11) | `npm run check` |

- Зона `tests` (для `zones.conf`, F8): `apps/server/test/contract/**`, `apps/server/test/acceptance/**`, `packages/chess/test/**`, `fixtures/**`, `tests/**`. Зоны разработчиков — `deny` на эти пути.
- `apps/server/test/support/**` (запуск `app`, клиенты, фабрики) — зона backend-разработчика: tester пользуется, а недостающий помощник пишет у себя в `apps/server/test/contract/_helpers/` или просит задачу.
- Пример: `apps/server/src/matchmaking/domain/window.test.ts` — unit (окно ±100 → +50 каждые 5 с → ±500, ТЗ §4.4 п.2); `apps/server/src/games/games.int.test.ts` — две параллельные `createGame` для одного игрока → одна партия (A25); `apps/server/test/contract/games/flag.test.ts` — флаг без хода клиента; `tests/e2e/challenge-link.spec.ts` — «2 клика».

## 6. Команды

Скрипты корневого `package.json` (создаёт задача скелета; команды — для профиля F8).

Все команды — из корня репозитория. «Перед этим» — что должно быть выполнено в этой сессии; `db:test:up` идемпотентна, её можно повторять.

| Команда | Что делает | Перед этим |
|---|---|---|
| `npm run db:test:up` | `docker compose -f deploy/compose.test.yml up -d --wait` — PostgreSQL для тестов (7.1) | Docker запущен |
| `npm run check` | `tsc -b` + ESLint + Stylelint + `dependency-cruiser` + `scripts/check-architecture.sh` + `scripts/check-api-doc.sh` | — |
| `npm run test:unit` | `vitest run --project unit --project web` | — |
| `npm run test:int` | `vitest run --project int` | `db:test:up` |
| `npm run test:contract` | `vitest run --project contract` | `db:test:up` |
| `npm run test:affected` | `vitest run --changed origin/main` — затронутое и потребители во всех проектах (`unit`, `web`, `int`, `contract`) | `db:test:up`; `git fetch origin main` |
| `npm test` | все проекты (`unit`, `web`, `int`, `contract`) | `db:test:up` |
| `npm run test:e2e` | `playwright test -c tests/e2e/playwright.config.ts`; `webServer` сам собирает `app`, применяет миграции и сид `--demo` к базе `chezz_e2e` | `db:test:up` |
| `npm run seed -- --demo` | `node apps/server/scripts/seed.ts --demo` (7.6) в базу из `DATABASE_URL` | `db:test:up` или staging |
| `npm run seed -- --load 150 --tokens <файл>` | Игроки и Session для нагрузки, токены — в `<файл>` (7.6) | staging |
| `npm run load` | `node tests/load/run.ts` (раздел 10); переменные: `LOAD_BASE_URL` (`APP_ORIGIN` staging), `LOAD_TOKENS` (файл из `seed --load`), `LOAD_REPORT` (путь отчёта; на staging — `/tmp/report.json`), `LOAD_PAIRS` (по умолчанию 75), `LOAD_DURATION_S` (по умолчанию 600) | `seed --load` на staging |

Один файл или один тест (tester и developer работают по одному AC):
- `npx vitest run --project contract apps/server/test/contract/challenges/accept.test.ts`
- `npx vitest run --project contract -t "AC-3"` — все тесты с `AC-3` в имени проекта.
- `npx playwright test -c tests/e2e/playwright.config.ts tests/e2e/challenge-link.spec.ts --project=desktop`

- Проекты Vitest — в корневом `vitest.config.ts` (`test.projects`): `unit` — `**/src/**/*.test.{ts,tsx}` без `*.int.test.ts`, `packages/*/test/**`, `apps/server/test/acceptance/**`; `web` — `apps/web/src/**/*.test.{ts,tsx}`, окружение jsdom (в `unit` их нет). Тест `apps/web`, которому нужен `node:fs` (чтение `tokens.css`, `favicon.svg`), — в проекте `web` с `// @vitest-environment node` в первой строке; `int` — `apps/server/src/**/*.int.test.ts`; `contract` — `apps/server/test/contract/**`. Для `int` и `contract` — `globalSetup` из 7.1, `pool: "forks"`, не больше 2 воркеров.
- Node.js 24 LTS (раздел 2): `node file.ts` работает без сборки; версия закреплена в `.nvmrc` и `engines` корневого `package.json`.
- Ivan работает в Windows: команды выполняются из Git Bash (там же `scripts/*.sh`), Docker — Docker Desktop. CI — `ubuntu-latest`.
- Соответствие для профиля F8 (шаблон tester): команда прогона затронутого — `npm run test:affected`; инфраструктура — `npm run db:test:up`; пример имени теста — из раздела 1.

## 7. Тестовая инфраструктура

### 7.1. PostgreSQL в Docker

- `deploy/compose.test.yml` (файл пишет devops, F7): один сервис `db-test`, образ `postgres:18` — та же мажорная версия, что в prod (OPERATIONS §6.1, §6.4; V22), порт `54329` на `127.0.0.1`, данные в `tmpfs`, `fsync=off`. Пароль — не секрет, только для этого контейнера.
- Подключение: переменная `TEST_DATABASE_URL`, по умолчанию `postgres://chezz:chezz@127.0.0.1:54329/postgres` (пользователь `chezz` — суперпользователь контейнера, ему можно `CREATE DATABASE`). Тестовые утилиты читают только её; `DATABASE_URL` для `app` в тестах собирает `startApp` (7.3).
- В CI — тот же образ как `services:` в обоих job (`check` и `e2e`), порт `54329`, тот же пользователь и пароль; `TEST_DATABASE_URL` — та же строка.
- `globalSetup` (в `apps/server/test/support/db.ts`): создаёт базу `chezz_template`, применяет миграции Kysely Migrator один раз за прогон; каждый воркер получает `CREATE DATABASE chezz_test_<n> TEMPLATE chezz_template`.
- Между тестовыми файлами — `TRUNCATE … RESTART IDENTITY CASCADE` всех таблиц, кроме таблиц миграций. Внутри файла тесты готовят свои данные и не полагаются на порядок.
- Пример: интеграционный тест A25 открывает две транзакции к `chezz_test_1` и одновременно вызывает `createGame` для одного игрока → одна вставка, вторая — отказ «игрок занят».

### 7.2. Управляемое время

- Сервер получает время только через `TimeSource` (`apps/server/src/platform/time.ts`): `now()` — монотонные мс (`performance.now()`), `wallNow()` — `Date` (для `created_at`, 14 дней лидеров, 30 мин вызова), `setTimer(ms, fn)` / `clearTimer(id)` — таймеры `GameRoom` и истечения вызовов. `domain/` по-прежнему получает время параметром (ARCHITECTURE §7.2).
- `ManualTimeSource` (`apps/server/test/support/time.ts`): `advance(ms)` сдвигает оба вида времени и синхронно срабатывает просроченные таймеры по порядку, затем ждёт, пока очереди `GameRoom` опустеют.
- Клиент (`apps/web`): отображение часов (API §9.4) и порог мало времени (U11) — чистые функции с параметром «сейчас» в `apps/web/src/features/games/clock.ts`; unit-тест `clock.test.ts` рядом с `vi.useFakeTimers()` в jsdom пишет developer.
- Пример (ТЗ §4.6, флаг): пуля 1+0, у белых 0,2 с → `advance(250)` → оба игрока получают `game.ended` с `timeout`; если у чёрных только король и конь — `draw`, `timeout_insufficient_material`. Тест длится миллисекунды.
- Пример (A11, компенсация): тест отвечает на `ping` с задержкой 160 мс по `ManualTimeSource` → с часов за ход списано на 80 мс меньше; задержка 3 с → компенсация ровно 1 с.

### 7.3. Запуск `app` в тестах и вход без Google

- `apps/server/src/app.ts` экспортирует `buildApp(config, deps)`; `main.ts` только собирает зависимости и вызывает `listen`. В `deps` тест передаёт `ManualTimeSource` и базу воркера (ARCHITECTURE A30, ADR-0005).
- `apps/server/test/support/app.ts`: `startApp({ config?, logDestination?, time?, sentry? })` → `{ url, wsUrl, metricsUrl, time, analytics, sentryEvents(), database: { block(), unblock() }, close() }` на случайных портах (основной и метрик); `sentry: true` — транспорт Sentry в память. `database.block()` делает базу воркера недоступной без перезапуска `app` (health 503). Сигнатура — `design.md` E01, «Тестовая инфраструктура сервера», и E03, «Публичные интерфейсы». `close()` — без штатного завершения партий (имитация падения процесса для V16).
- Вход: фабрика `createPlayer({ nickname, ratings })` вставляет User и Session и возвращает cookie `__Host-sid=<токен>` (в БД — SHA-256, SECURITY S3). Клиенты `rest(cookie)` и `ws(cookie)` ставят cookie и `Origin` своего `app`.
- Google OIDC в тестах не вызывается. Проверки ID-токена (SECURITY §4 п.4: `iss`, `aud`, `exp`, `iat`, `nonce`) — unit-тест функции проверки утверждений токена с подготовленными утверждениями; подпись проверяет `openid-client`. `safeLocalPath` — unit-тест со всеми строками SECURITY §4. Настоящий вход — V17.
- MUST NOT: адрес издателя OIDC, «пропустить проверку» и подобное в конфиге `app` ради тестов.

### 7.4. Фикстуры шахмат

Файл `fixtures/chess/<тема>.json` — массив случаев. Темы (обязательные по ТЗ §7 и ARCHITECTURE §10): `castling`, `en-passant`, `promotion`, `checkmate`, `stalemate`, `threefold`, `fifty-moves`, `insufficient-material`, `flag`.

```json
{
  "id": "en-passant-white-exd6",
  "tz": "ТЗ §4.6",
  "fen": "rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3",
  "moves": [{ "uci": "e5d6", "san": "exd6" }],
  "legal": null,
  "illegal": ["e5f6"],
  "flag": null,
  "expect": null
}
```

- `fen` — начальная позиция (`null` — стандартная); `moves` — ходы по порядку, у каждого ожидаемый SAN; `legal` — полный отсортированный список UCI в конечной позиции или `null`; `illegal` — UCI, которые в конечной позиции отклоняются; `flag` — `"white"` / `"black"`: у стороны кончилось время в конечной позиции; `expect` — `null` (партия идёт) или `{ "result", "termination" }` из GLOSSARY §8.
- Пример флага: белые просрочили, у чёрных король и конь → `"flag": "white"`, `"expect": { "result": "draw", "termination": "timeout_insufficient_material" }`; у чёрных ферзь → `black_wins`, `timeout`.
- Прогон — `packages/chess/test/fixtures.test.ts`: каждый случай — отдельный `it` с `id`. Один и тот же пакет у сервера и клиента (A3) — фикстуры проверяют обоих.
- MUST: новый найденный баг правил — сначала случай в фикстуры, потом исправление.

### 7.5. Эталонные векторы Glicko-2

Файл `fixtures/glicko2/<источник>.json` — массив векторов; `fixtures/glicko2/README.md` — откуда каждый файл (статья, репозиторий и коммит, реализация и версия).

```json
{
  "id": "glickman-example",
  "kind": "multi",
  "source": "Glickman, Example of the Glicko-2 system",
  "tau": 0.5,
  "player": { "rating": 1500, "rd": 200, "volatility": 0.06 },
  "elapsed_days": 0,
  "games": [
    { "opponent": { "rating": 1400, "rd": 30 }, "score": 1 },
    { "opponent": { "rating": 1550, "rd": 100 }, "score": 0 },
    { "opponent": { "rating": 1700, "rd": 300 }, "score": 0 }
  ],
  "expect": { "rating": 1464.06, "rd": 151.52, "volatility": 0.05999 },
  "tolerance": { "rating": 0.01, "rd": 0.01, "volatility": 0.00001 }
}
```

- `score` — 1 / 0,5 / 0; `elapsed_days` — время с последней партии игрока (рост RD без игр, метод Lichess, ARCHITECTURE §11).
- Вид вектора задаёт только поле `kind` (обязательное); поля `games` и `elapsed_days` должны ему соответствовать — прогон проверяет это и падает при несоответствии.

| `kind` | Вид | Поля | Что проверяет | Когда пропускается |
|---|---|---|---|---|
| `single` | A. одна партия | `games` из 1 элемента, `elapsed_days = 0` | пересчёт после партии по ARCHITECTURE §11 (метод Lichess, без периодов); сверяется с любой эталонной реализацией «одна партия = один период» | никогда |
| `multi` | B. несколько партий в периоде | `games` > 1 (пример Glickman выше) | ядро формул совпадает со статьёй | никогда |
| `decay` | C. рост RD | `elapsed_days > 0`, `games` из 1 элемента; `"expect": null`, пока F6-Q3 открыт | рост RD без игр до партии | пока `expect = null`. Закрыли F6-Q3 — tester вписывает константу в `fixtures/glicko2/README.md`, считает `expect` и снимает `null` |

- Что вызывать: все виды вызывают одну функцию `rateMany(player, games, elapsedDays)` (ARCHITECTURE A29, §11) — обычный именованный импорт `import { rateMany } from …`; вектор `single` — тот же вызов с массивом `games` из одного элемента. Другой функции пересчёта нет; нет `rateMany` — прогон красный, а не пропущен (ревью reopen r2, agentability-7).
- Как пропускается: только вид C — `it.skipIf(kind === "decay" && expect === null)` с причиной в имени: `"[skip: F6-Q3] <id вектора>"`. Другой `skip` в файле — ошибка.
- `it.skipIf` для вида C — единственное разрешённое исключение из запрета `.skip` (раздел 1, §13 п.3); ESLint разрешает его только в `apps/server/test/acceptance/glicko2-vectors.test.ts`. Критерий ТЗ §7 «рейтинг сверяется с эталоном» закрывают векторы видов A и B, они не пропускаются.
- Наборы: (1) пример из статьи Glickman (выше), вид B; (2) случаи из `lichess-org/lila` (модуль `rating`), если есть, — вид по полям случая; (3) последовательность ≥ 30 партий 4 игроков разных рейтингов и RD (новичок 1500/350, предварительный, устоявшийся), посчитанная независимой реализацией — не той, что тестируется (F6-Q2): только вид A (`single`), партии подряд без перерыва.
- Прогон — `apps/server/test/acceptance/glicko2-vectors.test.ts` против публичной функции из `design.md` фичи `rating`. Отображение (округление до целого, `?` при RD > 110, ТЗ §4.7) — отдельные unit-тесты.

### 7.6. Сид и фабрики

- Фабрики — `apps/server/test/support/factories.ts`: `createPlayer`, `createRating`, `createFinishedGame`, `createChallenge`. Пишут прямо в таблицы (SQL Kysely), минуя `service`: так быстрее и можно задать прошлое (партия 15 дней назад). Правило «SQL только в `repo.ts`» (ARCHITECTURE §7.4) относится к `apps/server/src/` (правка — 18.2).
- Сид — `apps/server/scripts/seed.ts` на тех же фабриках, детерминированный (фиксированный генератор случайных чисел, фиксированная «сейчас»). Режимы:
  - `--demo` (локально, e2e, staging): 12 Игроков `seed_player_01…12` и удалённый игрок (User с `deleted_at`, без ника и без Rating, с одной завершённой партией — для «удалённый игрок» в истории). У `seed_player_01…12` есть Rating всех трёх категорий; в блице: `seed_player_07` — RD 111 (предварительный), `seed_player_09` — последняя партия 15 дней назад, `seed_player_12` — RD 111 и партия 2 дня назад; остальные 9 — RD ≤ 110 и партия ≤ 13 дней назад. Завершённые партии для истории и лидеров; один открытый вызов и один вызов по ссылке.
  - `--load N --tokens <файл>` (staging): N Игроков `load_0001…` с Session; токены — в `<файл>` (только для генератора нагрузки, SECURITY S26). MUST NOT: файл токенов в артефактах и логах workflow (SECURITY §17); после прогона он удаляется вместе с одноразовой БД staging.
- Токены Session сида (V20) — по режиму (ревью reopen r2, agentability-9):

  | Режим | `SEED_TOKEN_SECRET` задан (staging) | не задан (локально, CI) | Что пишется в файл |
  |---|---|---|---|
  | `--demo` | `HMAC-SHA256(SEED_TOKEN_SECRET, ник)` — `seedSessionToken` ниже | из фиксированного генератора сида, как прежде | файла нет: хелпер входа e2e вычисляет cookie той же функцией из `SEED_TOKEN_SECRET` окружения шага smoke |
  | `--load N --tokens <файл>` | секрет **не используется**: у каждого `load_0001…` — случайный токен `crypto.randomBytes(32)` в base64url (SECURITY §5) | то же | `<файл>` — по строке `ник<TAB>токен` на игрока, токен — значение cookie `__Host-sid` в открытом виде; генератор нагрузки читает только его |

  - Во всех режимах в БД — SHA-256 токена (SECURITY S3). Почему `--load` без HMAC: токены передаются файлом в `tmpfs` того же контейнера и умирают с одноразовой БД staging (OPERATIONS §11), воспроизводить их снаружи не нужно; HMAC там дал бы долгоживущие cookie для 150 игроков из одного секрета. Детерминированность сида (выше) на токены `--load` не распространяется.
  - Единственная функция — `seedSessionToken(secret: string, nickname: string): string` в `apps/server/test/support/seed-token.ts`: `createHmac("sha256", secret).update(nickname, "utf8").digest("base64url")` — ключ — секрет, сообщение — ник; результат — 43 символа base64url без `=`, тот же формат, что `crypto.randomBytes(32)` в base64url (SECURITY §5). Импортируют и `seed.ts`, и хелпер входа `tests/e2e/support/` (ревью reopen r1, agentability-3). MUST NOT: вторая реализация HMAC в другом месте.
  - На staging (задан `E2E_BASE_URL`) хелпер входа сразу печатает `::add-mask::<токен>` для каждого вычисленного значения (ревью reopen r1, security-2). Пример: на staging cookie `seed_player_01` = `__Host-sid=<HMAC(секрет, "seed_player_01")>`; без секрета её не получить из публичного кода.
- MUST: при `APP_ENV=prod` сид завершается с ошибкой, ничего не записав. MUST NOT: копировать данные prod в тесты и staging (SECURITY S26).
- Пример: таблица лидеров блица после `--demo` — 9 строк: `seed_player_07`, `seed_player_12` (RD 111) и `seed_player_09` (последняя партия 15 дней назад) в неё не попадают (ТЗ §4.8). У удалённого игрока Rating в сиде нет: попадает ли он в таблицу — вопрос не F6.

## 8. Критерии приёмки ТЗ §7 → тесты

| Критерий ТЗ §7 | Чем проверяется | Уровень, где |
|---|---|---|
| Новый игрок входит через Google и начинает партию через автоподбор < 1 мин | вход через Google — вручную (V17); от первого входа: `welcome` → ник → «Найти игру» двумя игроками 3+2 → `game-live` у обоих < 60 с | e2e `tests/e2e/first-game.spec.ts`; ручной smoke F7 |
| Вызов по ссылке открывается у друга и стартует партию в 2 клика | друг открывает `/challenge/<id>` → «Принять» → `game-live`; считается ≤ 2 действий (API §12.3) | e2e `challenge-link.spec.ts` |
| Все правила шахмат и окончания проходят набор тестов | фикстуры 7.4; сервер применяет их в партии: мат и пат через WebSocket завершают Game | фикстуры; contract `games/endings.test.ts` |
| Часы не расходятся с серверными > 0,5 с; флаг фиксирует сервер | сервер: списание и добавка (ARCHITECTURE §9.2) и флаг — `ManualTimeSource`; клиент: отображение по API §9.4 — unit; в браузере: показ часов ≤ 0,5 с от `clock` следующего `game.moved` | contract `games/clock.test.ts`, `games/flag.test.ts` (tester); unit `apps/web/src/features/games/clock.test.ts` (developer, 7.2); e2e `clock.spec.ts` (tester) |
| Рейтинг по Glicko-2 сверяется с эталоном | векторы 7.5; после рейтинговой партии `rating_before`/`rating_after` в `game.ended` = функция от Rating до партии; товарищеская и `aborted` рейтинг не меняют | acceptance; contract `rating/apply.test.ts` |
| Таблица лидеров — правила ТЗ §4.8 | RD 110 — есть, 111 — нет; партия 13 дней назад — есть, 15 — нет; топ-100; «Ваше место» вне кэша; кэш 5 мин (`advance`) | int `rating/leaderboard.int.test.ts`; contract `rating/leaderboard.test.ts` |
| Партия восстанавливается после перезагрузки страницы и перезапуска сервера | перезагрузка — e2e; перезапуск — V16: ходы, остатки, время стороне на ходу (A10), таймеры переподключения обоих, `aborted` + `abandonment`, если не вернулись оба (ARCHITECTURE §9.3) | e2e `reload.spec.ts`; contract `games/restart.test.ts` |
| Сайт работает на телефоне 360 px и на десктопе, на RU и EN | ключевые экраны × {360, 1280} × {ru, en} (раздел 9); ключи RU = EN (DESIGN §17) | e2e `screens.spec.ts`; unit `packages/i18n` |
| Нагрузочный тест 150 / 75, p95 ≤ 150 мс | раздел 10 | нагрузка |
| Администратор банит и аннулирует партию | вне этапа (BUSINESS D5) — тестов нет | — |

Нефункциональные требования ТЗ §5, которые проверяются автоматически: бандл главной ≤ 300 КБ gzip — шаг `check` в CI после сборки (`scripts/check-bundle.sh`, считает gzip чанков главной без движка); все ходы валидируются на сервере — contract `games/move-validation.test.ts` (недопустимый ход, чужой ход, `ply_mismatch`); rate limit — contract `realtime/limits.test.ts` (21-е сообщение подряд отклонено, SECURITY §9). Первая отрисовка ≤ 2,5 с на 4G — вручную: Ivan перед этапом 5 запускает Lighthouse в Chrome DevTools (профиль «Mobile», замедление сети 4G) на главной staging и записывает результат в описание выкатки. Этого достаточно для приёмки (V17, человек). Тестового файла нет.

Владелец строк таблицы: e2e, contract, acceptance, фикстуры — tester; unit и int — developer (раздел 4).

## 9. E2E

- Playwright, конфиг `tests/e2e/playwright.config.ts` (команда — раздел 6, `-c`). PostgreSQL поднимает не Playwright: локально — `npm run db:test:up`, в CI — `services:` job `e2e` (7.1). `webServer` создаёт базу `chezz_e2e` на этом сервере, применяет миграции, выполняет сид `--demo`, собирает и запускает `app`; вход — cookie `__Host-sid` сид-игрока (на `localhost` Chromium принимает `Secure`-cookie).
- Проекты: `desktop` (Chromium, 1280×800), `mobile-360` (Chromium, 360×740, касание). В CI — оба. `webkit` (`devices["iPhone 13"]`, 390×844; Tab в WebKit не фокусирует ссылки — `tabsToLinks`, — поэтому достижимость по Tab проверяется в Chromium, а в webkit — только вид фокуса) и `firefox` — вручную перед этапами 5 и 6: `npm run test:e2e -- --project=webkit` (ТЗ §5 «Браузеры»). Для приёмки достаточно ручного прогона (человек, утверждение F6).
- Два игрока — два `browser.newContext()` в одном тесте.
- Помощник `openScreen(page, path, id)` в `tests/e2e/support/open-screen.ts` (DESIGN §17): ждёт `[data-screen="<id>"]`, проверяет непустой `data-state` и `document.documentElement.scrollWidth ≤ ширина окна`.
- `screens.spec.ts`: экраны `lobby`, `game-live`, `game-review`, `profile`, `history`, `leaderboard`, `settings` × оба проекта × `ru` и `en`. На каждом: нет горизонтальной прокрутки; нет видимого текста вида ключа перевода (`^[a-z_]+(\.[a-z_]+)+$`); `<html lang>` = язык.
- Сценарии — только пути игрока, которые не проверить contract-тестом: два игрока, интерфейс, переходы страниц. Ошибки API, права и таймеры — в contract.
- Пометка `@smoke` — короткий набор (открыть лобби, принять вызов по ссылке, сделать ход), который F7 гоняет на staging в job `staging` `deploy.yml` после SSH-шагов (OPERATIONS §9.6, V21): `E2E_BASE_URL=${{ vars.APP_ORIGIN }} npm run test:e2e -- --grep @smoke --project=desktop`; в env шага — `SEED_TOKEN_SECRET` (7.6). При заданном `E2E_BASE_URL` `webServer` не запускается: staging уже поднят и засеян `--demo` шагом `up` (OPERATIONS §9.6 п.1).
- MUST (ревью reopen r1, security-2): при заданном `E2E_BASE_URL` `playwright.config.ts` ставит `trace: "off"`, `video: "off"`, `screenshot: "off"`, `reporter: "list"` (без HTML-отчёта); cookie и заголовки в вывод теста не пишутся. Причина: репозиторий публичный (V18), логи и артефакты job `staging` видны всем, а cookie сид-игрока из `seedSessionToken` действует при каждом подъёме staging, пока не сменён `SEED_TOKEN_SECRET`. Артефакты job `staging` F7 не выгружает (OPERATIONS §9.6, общий запрет на секреты в артефактах — OPERATIONS §1).
- MUST: селекторы — `data-screen`, `data-state`, роли и подписи доступности; не классы CSS Modules.
- Пример (`clock.spec.ts`, блиц 3+0): белые ходят, ждут 2 с, читают свои часы на экране; чёрные отвечают; значение часов белых в `game.moved` (перехват WebSocket в Playwright) отличается от показанного перед ходом чёрных не больше чем на 0,5 с.

## 10. Нагрузочный тест

- Где: контейнер `tools-staging` с `tests/load/run.ts` на том же VPS, в сети staging, ходит в `edge` по `wss://` staging (V11, V21). Когда: перед этапом 5, перед этапом 6, по признакам ARCHITECTURE §15; в часы без игроков (ARCHITECTURE §5). Запускает Ivan через workflow `.github/workflows/load.yml` (OPERATIONS §11).
- Подготовка: staging с одноразовой БД (A17), `node apps/server/scripts/seed.ts --load 150 --tokens /tmp/tokens` в том же контейнере; лимит по IP на staging поднят переменной `RATE_LIMIT_IP_PER_MIN` (SECURITY §9, OPERATIONS §7). Запуск: `LOAD_BASE_URL="$APP_ORIGIN" LOAD_TOKENS=/tmp/tokens LOAD_REPORT=/tmp/report.json node tests/load/run.ts` (`APP_ORIGIN` — из `staging.env`; точная команда — OPERATIONS §11 п.2).
- Сценарий: 150 соединений, все подписаны на лобби; 75 пар играют одновременно; разгон 60 с, затем 10 мин ровной нагрузки. Партии — ходы из `tests/load/games/*.pgn` (реальные партии), темп как в пуле: ход раз в 1–2 с на партию (75 партий × 0,5–1 ход/с ≈ 37–75 ходов/с, в пределах BUSINESS D2). Закончилась партия — пара создаёт новую через вызов по ссылке.
- Задержка доставки хода — в одном процессе генератора по монотонным часам: от отправки `game.move` игроком A до получения `game.moved` с этим `ply` игроком B.
- Пороги (все — условие «прошёл»):

| Метрика | Порог | Источник |
|---|---|---|
| p95 доставки хода | ≤ 150 мс | ТЗ §5, §7 |
| Ошибки | 0 ошибок, кроме ожидаемых сценарием; 0 неожиданных закрытий WebSocket | ТЗ §5 «без деградации» |
| Задержка event loop `app` (`/metrics`) | p99 ≤ 50 мс | ARCHITECTURE §9.4 |
| Память `app` | ≤ 200 МБ | ARCHITECTURE §5 |

- Итог — JSON по пути из `LOAD_REPORT` (в контейнере — `/tmp/report.json`, `tmpfs`; не `tests/load/report.json`: файловая система контейнера только для чтения, OPERATIONS §6.1): p50/p95/p99, число ходов, ошибки; `load.yml` выводит его в итог job; строка в описании выкатки; код выхода ≠ 0 при нарушении порога.
- MUST NOT: запуск против prod.

## 11. Сводка проверок F2–F5

Здесь — где, когда и кто пишет. Правило и детали — в источнике. Каждая строка API §16 и DESIGN §17 есть здесь своей строкой. «PR» — блокирует мерж; «ревью» — пункт чек-листа reviewer.

«Пишет»: **скелет** — задача скелета репозитория (backend-разработчик зоны `platform`; сборка — ARCHITECTURE A30, ADR-0005; сигнатуры `platform` — `design.md` E01); **backend** — backend-разработчик модуля; **frontend** — frontend-разработчик; **tester**. Дальше проверку правит тот, кто меняет её правило, в той же задаче.

| Проверка | Источник | Как запускается | Пишет | Блокирует |
|---|---|---|---|---|
| Типы | ARCHITECTURE A14 | `npm run check` (`tsc -b`) | скелет | PR |
| ESLint: `vitest/no-focused-tests`, `vitest/no-disabled-tests` (кроме 7.5, вид C), `playwright/no-focused-test`, `playwright/no-skipped-test`, `react/no-danger`, запрет `innerHTML` | раздел 1; SECURITY §1, §10 | `npm run check` | скелет | PR |
| Границы модулей и слоёв | ARCHITECTURE §7.4 | `npm run check` (`dependency-cruiser`, `scripts/check-architecture.sh`) | скелет | PR |
| Только добавляющие миграции | ARCHITECTURE §5 | `scripts/check-architecture.sh` | скелет | PR |
| Каталог REST/WS и коды = код | API §16 | `scripts/check-api-doc.sh` | скелет | PR |
| Маршруты = `REST_ROUTES`; нет `DELETE`, нет `/api/v1` | API §16 | `int`, `apps/server/src/platform/routes.int.test.ts` | скелет | PR |
| Нет CORS: ответ на `Origin: https://evil.example` без `Access-Control-Allow-Origin`; `@fastify/cors` нет в зависимостях | API §16, §3 | `int`, `apps/server/src/platform/cors.int.test.ts` | скелет | PR |
| Входящие схемы строгие, ключи `snake_case`, нет `*_id` «кто я» | API §16 | `unit`, `packages/protocol/src/schemas.test.ts` | скелет; новые схемы — backend | PR |
| Нет `fen`, `pgn` в `Game` | API §16 | тот же тест | скелет | PR |
| Снимок протокола `snapshot/protocol.json` | API §16, §7 | `unit`, `packages/protocol/src/snapshot.test.ts` | скелет | PR |
| Адреса из `PAGES` | API §16 | `unit` `pages.test.ts` + `scripts/check-architecture.sh` | скелет | PR |
| ПДн не в событиях | API §16, SECURITY §15 | — | — | ревью |
| Литералы цвета и размеров в `*.module.css` | DESIGN §17 | `npm run check` (Stylelint) | скелет | PR |
| `style={}` только с CSS-переменными; `--base-*` только в `tokens.css` | DESIGN §17 | `scripts/check-architecture.sh` | скелет | PR |
| Ключи RU = EN, `error.<code>` на каждый `ErrorCode` | DESIGN §17, §11 | `unit`, `packages/i18n` | frontend | PR |
| Контраст пар раздела 5 | DESIGN §17 | `unit`, `apps/web/src/shared/ui/contrast.test.ts` | frontend | PR |
| Все ветки `AsyncState` (без `empty`/`onRetry` не компилируется) | DESIGN §17, §7 | `npm run check` (`tsc -b`) | frontend | PR |
| `Board`: a1 тёмная при обеих ориентациях | DESIGN §17, §6 | `unit`, тест компонента `Board` рядом с ним | frontend | PR |
| Пороги отметок | DESIGN §17, §12 | `unit`, `apps/web/src/features/games/analysis/judgement.test.ts` | frontend | PR |
| `data-screen`/`data-state`, 360 px | DESIGN §17 | e2e, `tests/e2e/support/` + `screens.spec.ts` (раздел 9) | tester | PR |
| Состояния по матрице 10.4 (чек-лист PR) | DESIGN §17 | — | — | ревью |
| Сверка с Figma | DESIGN §17, §16.3 | — | — | ревью |
| Лицензии статики (`LICENSE.md` в `public/pieces/<set>/`, `public/sounds/`) | DESIGN §17 | — | — | ревью |
| Нет UI-кита, Tailwind, библиотек графиков | DESIGN §17 | — | — | ревью |
| Фикстуры шахмат | ARCHITECTURE §10 | `unit`, 7.4 | tester | PR |
| Векторы Glicko-2 | ARCHITECTURE §11 | `unit`, 7.5 | tester | PR |
| `safeLocalPath`, экранирование `seo/html.ts`, проверка утверждений ID-токена | SECURITY §4, §10 | `unit` рядом с функциями | backend (`platform`, `seo`, `auth`) | PR |
| Секреты в коде | SECURITY §18, S27 | `gitleaks` по изменениям | devops (текст workflow), Ivan (коммит) | PR |
| Уязвимости зависимостей | SECURITY §18, S27 | `npm audit --omit=dev --audit-level=high` | devops, Ivan | нет, предупреждение |
| Нет тестового входа, секретов в логах и шагах CI, новая зависимость с причиной | SECURITY §1, §17, §18 | — | — | ревью |
| Бандл главной ≤ 300 КБ gzip | ТЗ §5; ARCHITECTURE §12 | `scripts/check-bundle.sh` после сборки | скелет | PR |

- MUST: правка правила в F2–F5 → правка его проверки в той же задаче (как требуют ARCHITECTURE §7.4, API §16).
- Подключение проверок к CI — devops готовит, Ivan коммитит (раздел 12).

## 12. Что в задаче и что в CI

| Когда | Что | Время (цель) |
|---|---|---|
| После разработчика, в задаче | `npm run check` | ≤ 2 мин |
| Прогон tester, в задаче | `npm run db:test:up` → `npm run test:affected` | ≤ 3 мин |
| Задача `[e2e]` фичи | `npm run db:test:up` → `npm run test:e2e -- tests/e2e/<сценарии фичи>` | ≤ 5 мин |
| CI job `check` (каждый push в PR и `main`) | `npm ci` → `npm run check` → `gitleaks` → `npm audit` (предупреждение) → `test:unit` → `test:int` → `test:contract` (PostgreSQL — `services:`, 7.1) | цель ≤ 8 мин, `timeout-minutes: 15` |
| CI job `e2e` (параллельно, тот же триггер) | PostgreSQL — `services:`, как в `check` (7.1) → сборка → `scripts/check-bundle.sh` → `npm run test:e2e` (`desktop`, `mobile-360`) | цель ≤ 7 мин, `timeout-minutes: 20` |
| По требованию (workflow, запускает Ivan) | нагрузка (раздел 10); e2e `webkit`, `firefox`; smoke staging `@smoke` (F7) | — |

- Обязательные статус-проверки для мержа в `main` — `check` и `e2e` (V19; решение F6, включение — F7, 18.2 п.8). SECURITY S24 требует только защиту `main` через PR и CODEOWNERS.
- Пропуск e2e для PR, где изменены только `docs/**` (V19): workflow запускается всегда, первый шаг job `e2e` определяет изменённые пути (`git diff --no-renames --name-only origin/main...HEAD`: при переносе файла из кода в `docs/**` выводятся оба пути, и e2e идёт); если все в `docs/**`, остальные шаги идут с `if: false`, и job завершается **успехом**. Фильтр `paths` / `paths-ignore` на уровне workflow MUST NOT: обязательная проверка зависнет «ожидается».
- Кэш CI: npm (`actions/setup-node` `cache: npm`) и браузеры Playwright.
- Минуты не ограничены (V18): job не урезаются ради экономии; таймауты нужны, чтобы зависший прогон не держал PR.
- Файлы `.github/workflows/**` пишет и меняет только Ivan (SECURITY S24, §17): агент devops готовит текст, Ivan коммитит.
- Пример: задача «окно подбора». В задаче — `check` и `test:affected` (тесты `matchmaking` и contract-тесты, которые импортируют `app`). В CI — весь набор, e2e обоих проектов.

## 13. Definition of Done задачи

Задача T-N готова, когда (reviewer сверяет, оркестратор не коммитит без APPROVE):

1. Тесты tester этой задачи зелёные; на каждый AC и каждую строку edge cases задачи есть тест с `AC-n` / `EC-n` в имени (раздел 1).
2. developer добавил unit-тесты на новую логику `domain/` и функции `apps/web`, интеграционный тест на новый SQL, транзакцию или блокировку.
3. `npm run check` и `npm run test:affected` зелёные; нет `.only`/`.skip`, кроме `it.skipIf` для векторов вида C (7.5).
4. Изменённые правила F2–F5 — вместе с их проверками (раздел 11); новый маршрут или сообщение — по API §15 (каталог, `REST_ROUTES`, снимок протокола, `PROTOCOL_VERSION` при несовместимости).
5. Миграции — только добавляющие (ARCHITECTURE §5).
6. Новые строки интерфейса — ключи RU и EN; экран — все состояния своей строки DESIGN §10.4, перечислены в описании (DESIGN §17).
7. Пункты «ревью» раздела 11 проверены по затронутым путям:
   - `apps/server/**`, `packages/protocol/**`: ПДн не в событиях (API §16, SECURITY §15); нет тестового входа и обхода проверок (SECURITY §1, §4); секреты не в логах (SECURITY §17);
   - `apps/web/**`: состояния экрана по DESIGN §10.4 перечислены в описании PR; сверка с Figma (DESIGN §16.3); нет UI-кита, Tailwind, библиотек графиков (`package.json`);
   - `apps/web/public/**`: `LICENSE.md` у каждой папки фигур и звуков (DESIGN U33);
   - любой `package.json`: у новой зависимости указано, зачем (SECURITY §18);
   - `deploy/**`, `.github/**`: секреты не печатаются в шагах (SECURITY §17).
8. Изменения документов основ — только из утверждённого плана.
9. reviewer — APPROVE.

## 14. Definition of Done фичи

Фича готова к PR, когда:

1. Все задачи T-N — по разделу 13.
2. E2E-сценарии фичи зелёные в `desktop` и `mobile-360`; экран фичи добавлен в `screens.spec.ts`, если это новый экран.
3. Сводка этапа 5 `/feature`: каждый AC с отметкой и ссылкой на тест; новые переменные окружения (имена); изменения документов основ; что «позже».
4. Чек-лист демонстрации по AC; для фич с интерфейсом — сверка с Figma (DESIGN §16.3).
5. CI на PR зелёный: `check` и `e2e`.
6. Фича трогает вход, удаление аккаунта или выкатку — smoke на staging по F7 перед мержем.
7. Фича трогает горячий путь хода (`games`, `realtime`, `platform`) перед этапом 5 или 6 — нагрузочный тест (раздел 10) до выкатки в prod.

## 15. Падения и нестабильные тесты

- Красный тест в задаче — разработчику с отчётом tester; разработчик не согласен — arbiter (`/feature` шаг 4).
- E2E в CI повторяется 1 раз (`retries: 1` только при `CI=true`). Прошёл со второго раза — Playwright помечает `flaky`; оркестратор заводит Issue «flaky: <имя теста>» (трекер — BUSINESS D10), тест чинит tester в ближайшей фиче.
- unit, `int`, `contract` — без повторов: случайное падение в них — признак гонки (часто — в `GameRoom` или блокировках A25), разбирать как баг.
- MUST NOT: `retries` в конфиге Vitest; удлинять таймауты вместо поиска причины.

## 16. Чего не делаем и почему

| Что | Почему нет | Когда вернуться |
|---|---|---|
| Порог покрытия | V13 | AC стали проверяться формально |
| Визуальная регрессия по скриншотам | макеты сверяются в ревью (DESIGN §16.3), один человек на поддержку эталонов | интерфейс устоялся после беты |
| Мутационное тестирование, fuzz правил | правила дают chess.js и фикстуры | баги правил, которые фикстуры пропустили |
| Постоянный тестовый стенд, ферма браузеров, SaaS нагрузки | BUSINESS D4, D6; staging по требованию (A17) | ARCHITECTURE §15 «постоянный staging» |
| Автотест входа в Google | V17 | — |
| Нагрузка на каждый PR | V15 | p95 близко к порогу на плановых прогонах |

## 17. План роста

| Признак | Шаг |
|---|---|
| Job `check` или `e2e` > 10 мин по медиане за неделю | шардинг Vitest (`--shard`) и Playwright на 2 runner (минуты не ограничены, V18) |
| Репозиторий стал приватным | вернуть расчёт минут: e2e на PR — только при изменениях `apps/web`, `packages/**`, `apps/server/src/realtime`, `games`; полный — в `main` |
| > 2 нестабильных теста в месяц | разбор причин, правила в разделе 1 |
| p95 на плановом нагрузочном тесте > 100 мс | нагрузка — при каждой выкатке, меняющей `games`/`realtime` |

## 18. Открытые вопросы

### 18.1. Вопросы

| № | Вопрос | Владелец |
|---|---|---|
| F6-Q2 | Независимая реализация Glicko-2 для набора (3) в 7.5: какая (язык, версия, лицензия) — записать в `fixtures/glicko2/README.md`. По умолчанию — открытая реализация на другом языке, скрипт генерации не входит в CI | tester фичи `rating` с architect |
| F6-Q3 | Константа роста RD по времени без игр (метод Lichess) не задана в ARCHITECTURE §11; сигнатура `rateMany` уже задана (ARCHITECTURE A29, §11). Вектор вида C (7.5) её требует и до ответа пропускается по правилу 7.5; виды A и B не пропускаются | architect фичи `rating`, до приёмки фичи `rating`; ответ — в ARCHITECTURE §11 (единственное место), tester затем считает `expect` вида C |

Закрыты решением человека (Ivan, утверждение F6, 2026-11-04): F6-Q1 → V18 (репозиторий публичный, минуты без лимита); F6-Q4 → V17 (ручной проверки входа через Google и Lighthouse для приёмки достаточно).

### 18.2. Правки утверждённых документов (для reopen)

Внесены в источники в reopen 1R (утверждён Ivan 2026-11-05, `docs/setup/log.md`); отметка — ниже.

Reopen 1R (2026-11-05, решение Ivan — F1–F6 одним заходом): пункты 1–5 (F2) и 10 (F3) — **выполнены** в ARCHITECTURE v0.5 и SECURITY v0.4 (утверждены 2026-11-05; итог — в ответах reopen в `docs/setup/reviews/`); п.6 (F4) — в API v0.4 (P32); п.7 (F5) — в DESIGN v0.4 (U39). П.8 (F7) — выполнен в OPERATIONS v0.4 (сверка ниже). П.9 (F8) — остаётся до F8.

F2 `docs/ARCHITECTURE.md`:
1. §7.2, §9.2: время и таймеры — через `TimeSource` из `platform/time.ts` (`now`, `wallNow`, `setTimer`, `clearTimer`), а не прямые `performance.now()` и `setTimeout` в `service` и `GameRoom` (V5, 7.2); `domain/` — по-прежнему параметром.
2. §7.4: правило «Kysely-запросы только в `repo.ts`» — для `apps/server/src/`; `apps/server/test/support/` и `apps/server/scripts/seed.ts` пишут в таблицы напрямую (7.6).
3. [выполнен частично в ARCHITECTURE v0.5: сигнатура `rateMany` — A29, §11; «Форма файлов — F6 §7.5» — §11. Не выполнено: константа роста RD — F6-Q3, ответ вносится в ARCHITECTURE §11] §11: сигнатура `glicko2.ts` с массивом партий и параметром времени без игр; константа роста RD (F6-Q3); «Форма файлов — F6» → F6 §7.5.
4. §13: `apps/server/src/app.ts` (`buildApp`), `apps/server/test/{support,contract,acceptance}/`, `apps/server/scripts/seed.ts`, `tests/e2e/`, `tests/load/`, `vitest.config.ts`, `tests/e2e/playwright.config.ts`, `deploy/compose.test.yml`, `scripts/check-api-doc.sh` (из API §16), `scripts/check-bundle.sh`, `.nvmrc` (связано с F2-Q12).
5. §4.1: «Тесты — F6» → Vitest, Playwright (V1, V10); §5: место генератора нагрузки — F6 §10 (V11).

F4 `docs/API_CONVENTIONS.md`:
6. §16 строка «Маршруты Fastify = `REST_ROUTES`»: «contract-тест `apps/server`» → интеграционный тест `apps/server/src/platform/routes.int.test.ts` (developer): в F6 «contract» — уровень tester. Строка «Нет CORS» — отдельный тест `apps/server/src/platform/cors.int.test.ts` (F6 §11).

F5 `docs/DESIGN_SYSTEM.md`:
7. §17: «инструмент — F6», «форму тестов задаёт F6» → Playwright, F6 §9; Vitest + jsdom, F6 §5.

F7 `docs/OPERATIONS.md`:
8. [выполнен целиком в OPERATIONS v0.4: `compose.test.yml` — §6.4; `ci.yml`, `check`/`e2e`, пропуск через `if` без `paths` — §8; обязательные проверки — §16.1 п.1; `load.yml` на VPS и файл токенов только в `tmpfs` — §11; smoke `@smoke` и ручной вход — §9.6; PostgreSQL 18 везде — §6.1; форки без секретов, `deploy.yml`/`load.yml` только `workflow_dispatch` — §8, §16.1 п.4–5; OPERATIONS §22] `deploy/compose.test.yml` (7.1); workflow CI с job `check` и `e2e`, пропуск e2e для `docs/**` через `if` внутри job, не `paths` (раздел 12, V19); в branch protection `main` — обязательные статус-проверки `check` и `e2e` (V19); workflow нагрузки на VPS, файл токенов `seed --load` не попадает в артефакты и логи (раздел 10, 7.6); smoke `@smoke` на staging и ручной вход через Google (V17); мажорная версия PostgreSQL для тестов = prod. Публичный репозиторий (V18): workflow с секретами (staging, prod, нагрузка) не запускаются из `pull_request` форков; CI для форков — без секретов и без `environment`.

F8 (профиль конвейера):
9. Зона `tests` и `deny` для разработчиков — раздел 5; значения для шаблона tester — разделы 4–6 (соответствие — конец раздела 6); проверки профиля — раздел 12.

F3 `docs/SECURITY.md` (reopen):
10. Решение человека V18 — репозиторий публичный целиком. Учесть в S24, §17, §18: workflow с секретами — только из веток с правом записи, у форков секретов нет; S24 «staging выкатывается из веток агентов» — только из веток этого репозитория; что из `deploy/`, `docs/` (включая `docs/SECURITY.md`) и `.claude/` публикуется и не содержит ли адресов, имён пользователей VPS и путей к секретам; `gitleaks` по всей истории перед открытием репозитория.
