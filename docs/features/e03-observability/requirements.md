# E03: Наблюдаемость `app`: Sentry, `/metrics` с `app_info{version}`, маскирование `/challenge/<id>`, модуль `analytics`

Версия 0.1 (2026-11-07). Источник состава: ROADMAP, строка E03 и «Пояснения к нарезке», E03; KAN-6.

## Цель

Ivan должен видеть ошибки сервера и клиента в Sentry с первой выкатки prod (ТЗ §5 «Мониторинг»; OPERATIONS O19, §12.4). `deploy.sh` должен проверять, что на prod работает нужная версия образа: для этого `app` отдаёт метрику `app_info{version="<SHA>"} 1` (OPERATIONS §9.4 п.8а). Секрет ссылки вызова (`id` после `/challenge/`, `/api/challenges/`) не должен попадать ни в журнал, ни в Sentry (SECURITY §15, S37; OPERATIONS O18). Фичевые эпики (первый — E04) должны получить модуль `analytics` с записью технических событий для метрик ТЗ §7 (ТЗ §5 «Аналитика»; ARCHITECTURE §7.5, A26). Пользователи результата — Ivan (эксплуатация, метрики беты) и разработчики следующих эпиков. Для Игрока и Гостя видимых изменений нет: экранов в эпике нет.

## Ограничения (от человека)

- Размер M, UI нет (только инициализация Sentry в `apps/web`, без экранов) — designer не участвует (`log.md`).
- Лимит — 35 вызовов агентов (профиль, «Размеры фич»).
- Срок не задан.
- Метрики модулей и REST-маршрут `analysis_opened` в эпик не входят (ROADMAP, «Пояснения к нарезке», E03).

## Зависимости (эпики, статус)

| Эпик | Что нужно | Статус |
|---|---|---|
| E01 Скелет | `platform` (config, log, errors, http, time), `buildApp`, `packages/protocol` с `maskChallengeIds` и тестом (E01 AC-21), `apps/web` | смержен в `main` (PR #3). В ROADMAP у E01 пока стоит «в работе» — статус устарел, это не блокер |
| E02 Выкатка | `Dockerfile` (`ARG APP_VERSION`, сборка `apps/web` с `.map`), compose (порт `127.0.0.1:9464`), Caddy (CSP `connect-src https://{$SENTRY_INGEST}`), `env.allowlist` (`SENTRY_DSN`) | не начат. От E03 не зависит, E03 от него тоже (ROADMAP, «Порядок», п.1). E03 проверяется без образа. Проверка на VPS — первая выкатка prod после мержа обоих эпиков |

Блокеров нет.

Что уже есть в коде (E01) и не делается заново:
- `maskChallengeIds(text)` — `packages/protocol/src/mask.ts`, unit-тест `mask.test.ts` (E01 AC-21, EC-13). В E03 функция только применяется, вторая реализация запрещена (SECURITY §15).
- pino: путь без строки запроса, `redact` cookie, authorization и set-cookie, строка лога на запрос (`platform/log.ts`). Маскировки `id` вызова пока нет — комментарий «E03» в `log.ts:2`.
- `errorHandler` пишет 500 в лог с `request_id` (`platform/errors.ts`). Отправки в Sentry нет.
- `GET /api/health` → `{"status"}` без версии (API P16).
- Миграций нет (`apps/server/migrations/.gitkeep`): `analytics_events` станет первой таблицей.
- `trackEvent` (REST, `POST /api/analytics/events`) — в `PENDING_CATALOG` (ADR-0009) и остаётся там до E13.

## Scope

### Входит

1. **Sentry сервера** (`@sentry/node`, ARCHITECTURE A22): `environment` = `APP_ENV`, `release` = `APP_VERSION` (OPERATIONS §12.4, O22). Отправляются ошибки 5xx `errorHandler` с тем же `request_id`, что в логе и в ответе (API §5.1), и необработанные исключения процесса. Фильтр — `beforeSend`/`beforeBreadcrumb` по SECURITY §15.
2. **Sentry клиента** в `apps/web`: тот же проект, тот же `environment` и `release`, те же правила SECURITY §15. Session Replay нет. Сюда же — отправка «нет ключа перевода» в сборке (E01 EC-19). Source maps лежат рядом со статикой, токена Sentry в CI нет (O22).
3. **`/metrics`** (`prom-client`) на отдельном порту 9464, не через основной порт `app` (SECURITY S32; API §3). Метрики: `app_info{version}` и стандартные `nodejs_eventloop_lag_p99_seconds`, `process_resident_memory_bytes`, `process_cpu_seconds_total` (OPERATIONS §12.2).
4. **`maskChallengeIds` в pino и Sentry** — на поля SECURITY §15 (перечень — AC-14…AC-17).
5. **Модуль `analytics`** (`apps/server/src/analytics`, слой L0): миграция `analytics_events` (ARCHITECTURE §7.5), сервис с записью события (в ROADMAP — `trackEvent`), набор имён §7.5, белый список `props` (SECURITY §15), дедупликация `user_active`, запись не ломает сценарий. Подключение в `buildApp` по ADR-0005 — сервис создаётся, вызовов из модулей пока нет.
6. **Хвосты E01**, отнесённые к E03 (`docs/features/e01-skeleton/design.md`, «Хвосты»):
   - п.1 — свой сериализатор `err` в pino (`type`, `message`, `stack`, `code`) вместо `pino.stdSerializers.err`. Крайний срок — до таблицы `users` в E04;
   - п.10 — `request_id: z.uuid()` в `ErrorResponse`; снимок схем сервера с `io: "output"` (`[contracts]`).

### Не входит / позже

| Что | Где |
|---|---|
| `chezz_games_active`, `chezz_move_delivery_seconds` | E06 |
| `chezz_players_online` | E22 |
| REST `POST /api/analytics/events` (`analysis_opened`, P13) и его дедупликация по IP | E13 |
| Вызовы записи событий: `user_registered`, `user_active` | E04 |
| Вызовы `seek_*` | E08 |
| Вызовы `game_started`, `game_finished` | E06/E07 |
| Пользователь в Sentry (`user.id`) — Session до E04 нет | E04 (требование задано здесь, AC-12) |
| SQL-запросы метрик ТЗ §7 (DAU, D7, ожидание подбора) | вне кода: Ivan выполняет запросы ARCHITECTURE §7.5 вручную; отчёт — не в этапе |
| `watch.sh`, алерты Telegram | E20 (этап 4) |
| UptimeRobot, настройка проекта Sentry (алерт AL11 на e-mail, «Prevent Storing IP») | Ivan вручную, до первой выкатки (OPERATIONS §20) |
| Dockerfile, compose, Caddyfile, `env.allowlist` | E02 |
| Экран ошибки (React error boundary с интерфейсом) | вне E03, экранов нет; нужен ли — DESIGN §10.4, designer в эпике с UI |
| Трассировка производительности Sentry | по умолчанию выключена (Открытые вопросы, Ivan п.1) |

## Сценарии

**С1. Ошибка сервера попадает в Sentry** (ТЗ §5 «Мониторинг»; API §5.1).
1. Маршрут `/api/challenges/3f2c…/accept` бросает неизвестное исключение.
2. `errorHandler` возвращает `500 internal` с `request_id`, пишет строку лога с путём `/api/challenges/:id/accept` и отправляет событие в Sentry.
3. В событии: тег (или поле) `request_id`, равный ответу; `event.request.url` и `event.transaction` — с `:id`, без строки запроса; нет cookie, заголовков и тела; `environment` = `APP_ENV`, `release` = `APP_VERSION`.
4. В Sentry приходит одно событие на одну ошибку (без дубля от автоинструментации Fastify).

**С2. Ошибка клиента попадает в Sentry** (ТЗ §5).
1. В SPA на странице `/challenge/<id>` возникает необработанное исключение или отклонённый промис.
2. SDK отправляет событие. URL, `transaction`, `message`, `exception.values[].value`, навигационные и fetch-хлебные крошки — с `:id`. Заголовков и cookie нет.
3. `release` — тот же SHA, что у сервера. `environment` — `prod` или `staging`.

**С3. Выкатка проверяет версию** (OPERATIONS §9.4 п.8а, §9.5 п.5).
1. Контейнер `app` из образа с `APP_VERSION=<sha>` стартует.
2. `curl -fsS http://127.0.0.1:9464/metrics` на хосте отдаёт текст Prometheus, в нём есть строка `app_info{version="<sha>"} 1`.
3. Через Caddy `/metrics` метрик не отдаёт. Основной порт `app` метрик тоже не отдаёт.
4. Этот же порт читают `load` (`app-staging:9464`, OPERATIONS §11) и с этапа 4 `watch.sh`.

**С4. Модуль пишет аналитическое событие** (ARCHITECTURE §7.5; используют E04 и далее).
1. Модуль вызывает запись `game_finished` с `user_id`, `game_id`, `props: {termination, after_restart}`.
2. В `analytics_events` появляется строка: `id`, `name`, `user_id`, `game_id`, `props`, `created_at` (время — от `TimeSource.wallNow`).
3. БД недоступна или запись упала: сценарий вызывающего идёт дальше, ошибка попадает в лог (и в Sentry). Исключение наружу не выходит.

**С5. `user_active` не чаще раза в сутки** (ARCHITECTURE §7.5).
1. Игрок делает 100 REST-запросов за день (вызовы — E04). Пишется одна строка `user_active`.
2. После 00:00 UTC следующий запрос пишет новую строку.
3. После перезапуска `app` в те же сутки возможна вторая строка: это допустимо.

**С6. Окружение без Sentry** (dev, тесты, CI; TESTING §1 «сеть наружу»).
1. `SENTRY_DSN` не задан: Sentry не инициализируется ни на сервере, ни в клиенте, запросов к Sentry нет, `app` и SPA работают.

## Edge cases

| # | Ситуация | Ожидаемое поведение | ТЗ / документ |
|---|---|---|---|
| EC-1 | Путь `/challenge/<id>` и `/api/challenges/<id>/accept` в строке лога запроса | `path` = `/challenge/:id`, `/api/challenges/:id/accept`; `/game/<id>` и `/api/challenges` без `id` не меняются | SECURITY §15, S37; O18 |
| EC-2 | 404 по `/api/challenges/<id>` (маршрута ещё нет) | в логе `path` с `:id`; в ответе `not_found` | SECURITY §15 |
| EC-3 | URL в событии Sentry со строкой запроса (`/auth/google/callback?code=…&state=…`, `/challenge/<id>?x=1#y`) | `event.request.url` без строки запроса и фрагмента, `id` → `:id`; `query_string` удалён | SECURITY §15 («строку запроса» удалять; `code`/`state` OAuth) |
| EC-4 | `id` вызова в `message`, `exception.values[].value`, `breadcrumbs[].message`, `breadcrumbs[].data.url` / `to` / `from`, `event.transaction` | везде `:id`; остальной текст сохраняется | SECURITY §15 |
| EC-5 | Событие Sentry с `request.cookies`, `request.headers` (включая `User-Agent`, `Cookie`, `Authorization`), `request.data` | поля удалены до отправки | SECURITY §15 |
| EC-6 | Событие Sentry с `user` (email, ip_address, username) | остаётся только `user.id`; без Session `user` нет | SECURITY §15 |
| EC-7 | Ошибка `pg` с полем `detail` (`Key (email)=(…)`) — 500 | в строке лога и в событии Sentry нет `detail` (и других полей, кроме `type`, `message`, `stack`, `code`) | SECURITY §15 MUST NOT e-mail; хвост E01 п.1 |
| EC-8 | 4xx (`validation_failed`, `not_found`, `rate_limited`) | в Sentry не отправляется; строка лога как в E01 | API §5.1 («причина — в лог и Sentry» только у `internal`) |
| EC-9 | Необработанный `unhandledRejection` / `uncaughtException` процесса | событие в Sentry отправлено (с ожиданием отправки ≤ N с) до выхода процесса; поведение выхода не меняется | ТЗ §5; N — architect |
| EC-10 | `SENTRY_DSN` пуст или не задан | Sentry не инициализирован; ни одного сетевого запроса; `app` стартует | TESTING §1; OPERATIONS §7 |
| EC-11 | `SENTRY_DSN` задан, но Sentry недоступен (нет сети, 429 квоты) | `app` и SPA работают, запросы не замедляются; ошибка отправки не роняет процесс | ТЗ §5 «Доступность» |
| EC-12 | `APP_VERSION` не задан (dev, тесты) | `app_info{version="<значение по умолчанию>"} 1`; значение — Открытые вопросы, architect п.4 | OPERATIONS §6.2 |
| EC-13 | `GET /metrics` на основном порту `app` (3000) и через `edge` | метрик нет: ответ не содержит `app_info` (404 или SPA-фолбэк `index.html` — решает architect, вопрос п.6) | SECURITY S32; API §3 |
| EC-14 | `GET /metrics` на порту метрик много раз подряд | всегда 200, без счётчика rate limit, без строки лога запроса на каждый опрос | SECURITY §9 (лимит — для `/api`, `/auth`, upgrade); OPERATIONS §12.3 (опрос раз в минуту) |
| EC-15 | `GET /api/health` после E03 | по-прежнему только `{"status": …}`, без версии | API P16 |
| EC-16 | Два `buildApp` в одном процессе тестов | у каждого свой реестр метрик и свой сервис `analytics`; нет ошибки «метрика уже зарегистрирована»; состояние дедупликации `user_active` не общее | ADR-0005 п.2; TESTING §7.3 |
| EC-17 | Порт метрик занят при старте | поведение задаёт architect (вопрос п.5). По умолчанию analyst — `app` не стартует, код выхода ≠ 0: иначе `deploy.sh` п.8а всё равно провалится, но позже и с неясной причиной | OPERATIONS §9.4 |
| EC-18 | `app.close()` (SIGTERM, тест) | порт метрик освобождён; буфер Sentry отправлен (flush с таймаутом) | ARCHITECTURE §7.2 (`onClose`) |
| EC-19 | Перезапуск сервера (ARCHITECTURE §9.3) | `app_info` — версия нового образа; отметки `user_active` сброшены, второй `user_active` за сутки допустим; уже записанные `analytics_events` не теряются | ARCHITECTURE §7.5, §9.3 |
| EC-20 | Запись события во время транзакции вызывающего, и запись падает | транзакция и сценарий вызывающего не ломаются, ошибка уходит в лог. Как именно — пишется ли событие в `trx` вызывающего — architect, вопрос п.1 | ARCHITECTURE §7.5 MUST |
| EC-21 | `props` с ключом вне белого списка (`email`, `nickname`, `ip`, `user_agent`, любой другой) | строка не пишется; предупреждение в лог без значений `props`; исключение наружу не выходит (по умолчанию analyst) | SECURITY §15 MUST NOT |
| EC-22 | Имя события вне набора §7.5 | TS не компилирует; в рантайме (`as any`) — как EC-21 | ARCHITECTURE §7.5, A26 |
| EC-23 | Гость | события Гостя на сервере в E03 нет (`analysis_opened` с IP — E13). `user_id` может быть пуст по схеме; Sentry без `user` | ARCHITECTURE §7.5; GLOSSARY «Гость» |
| EC-24 | Удалённый игрок (SECURITY §13) | `analytics_events` не меняются (за `user_id` ПДн больше нет); в Sentry никогда не было ничего, кроме `user.id`. Проверка удаления — E04+ | SECURITY §13 «Не меняется» |
| EC-25 | `user_active` около полуночи UTC: 23:59:59.999 и 00:00:00.000 | две строки (разные сутки UTC); граница — по `TimeSource.wallNow`, не по локальному поясу | ARCHITECTURE §7.5 |
| EC-26 | `t()` без ключа в сборке (E01 EC-19) | возвращает ключ (как в E01) и отправляет одно сообщение в Sentry на ключ за сессию страницы (без дублей в цикле рендера) | E01 EC-19; DESIGN §15 |
| EC-27 | Сборка `apps/web` с Sentry | бандл главной ≤ 300 КБ gzip (`scripts/check-bundle.sh`); `.map` в бюджет не входят (файлы не подключены из `index.html`) | ТЗ §5 «Загрузка страницы»; ARCHITECTURE §12 |
| EC-28 | Гонки вызова (принятие, отмена, 30 мин), флаг против хода, 60 с переподключения, 1 open Challenge / 1 active Game | в E03 неприменимо: маршрутов и событий партии нет. Этим эпикам E03 отдаёт только маскировку путей вызовов и запись событий. Сценарии проверяются в E05–E09 | ROADMAP |

## Данные и владельцы

| Сущность / артефакт | Поля | Владелец | Кто пишет / читает |
|---|---|---|---|
| `analytics_events` (техническая запись, не сущность домена; ARCHITECTURE A26, F2-Q7) | `id`, `name`, `user_id` (nullable), `game_id` (nullable), `props` (jsonb), `created_at` | модуль `analytics` (ARCHITECTURE §8) | пишут все модули через `analytics.service`; читает Ivan SQL-запросами (§7.5) |
| Имена событий | `user_registered`, `user_active`, `seek_started`, `seek_matched`, `seek_cancelled`, `game_started`, `game_finished`, `analysis_opened` | `analytics` (технические идентификаторы, A26) | — |
| Ключи `props` | `wait_ms` (`seek_matched`, `seek_cancelled`); `termination`, `after_restart` (`game_finished`) | `analytics` | значения `termination` — `Game.termination` (GLOSSARY G6); тип в протоколе появится в E06 |
| Отметки «`user_active` уже записан сегодня» | `user_id` → сутки UTC, в памяти | `analytics`, в замыкании фабрики (ADR-0005) | — |
| Метрики | `app_info{version}`, стандартные `prom-client` | `platform` (ARCHITECTURE §7.1) | `deploy.sh`, `load`, `watch.sh` |
| Конфиг | `SENTRY_DSN` (не секрет, SECURITY §17), `APP_ENV`, `APP_VERSION`, адрес и порт метрик (имена — architect) | `platform/config.ts` | `app`, клиент (DSN, `environment`, `release`) |

Обязательные поля событий (по умолчанию analyst, по §7.5):

| Событие | `user_id` | `game_id` | `props` |
|---|---|---|---|
| `user_registered`, `user_active`, `seek_started` | обязателен | — | `{}` |
| `seek_matched`, `seek_cancelled` | обязателен | — | `wait_ms` — целое ≥ 0 |
| `game_started` | обязателен (строка на каждого игрока) | обязателен | `{}` |
| `game_finished` | обязателен (строка на каждого игрока) | обязателен | `termination`, `after_restart` (boolean) |
| `analysis_opened` | может быть пуст (Гость) | обязателен | `{}` — в E03 только тип; путь записи — E13 |

## Комплаенс и риски

Риски подсвечены. Решения по ним принимает Ivan.

| # | Риск | Что в требованиях | Решение нужно |
|---|---|---|---|
| R1 | Sentry — внешний обработчик (SaaS вне VPS): получает `user.id`, стеки, URL, браузер | только поля SECURITY §15; `sendDefaultPii: false`; без Replay | политика конфиденциальности (F3-Q1, E04) должна назвать Sentry и срок хранения 30 дней (SECURITY §14) — Ivan, вопрос п.3 |
| R2 | IP клиента: Sentry по умолчанию может вывести IP из запроса браузера к ingest, даже если SDK его не шлёт | SDK не передаёт `user.ip_address` (AC-12) | Ivan включает в проекте Sentry «Prevent Storing of IP Addresses» (ручной шаг до первой выкатки) — вопрос п.2 |
| R3 | Source maps лежат публично рядом со статикой (O22) | так принято в O22; репозиторий и так публичный (O28) | нет, принятый риск |
| R4 | `id` вызова в тексте ошибок от разработчика (`new Error("challenge 3f2c… expired")`) | маскировка `exception.values[].value` и `message` в Sentry (AC-15). В pino маскируется только путь — вопрос architect п.3 | — |
| R5 | ПДн в `err.detail` у ошибок `pg` | свой сериализатор `err` (AC-9) — до E04 | — |
| R6 | `analytics_events` хранятся до конца беты, при удалении аккаунта не меняются | по SECURITY §13, §14; в `props` нет ПДн (AC-21) | срок после беты — F3-Q2 (уже открыт) |
| R7 | Журнал: строка лога на каждый опрос `/metrics` раз в минуту — шум в journald с лимитом 1 ГБ (SECURITY §14, вытеснение `account_deleted`) | `/metrics` не пишет строку запроса (EC-14) | — |
| R8 | Квота бесплатного Sentry: при шторме ошибок события теряются | без трассировки, без Replay | лимит/семплирование — Ivan, вопрос п.1 |
| R9 | `release` клиента ≠ `release` сервера — стеки не сопоставятся с source maps | AC-13 | способ передачи — architect п.2 |

## Критерии приёмки

Тип теста — в скобках: unit, int (реальная PostgreSQL, `startApp`), contract (tester, `apps/server/test/contract`), check (`npm run check` / скрипты).

**Метрики**
- [ ] AC-1: `startApp` с `APP_VERSION=abc123` → `GET` на порт метрик `/metrics` отдаёт 200, `Content-Type` формата Prometheus text, в теле строка ровно `app_info{version="abc123"} 1`. (int)
- [ ] AC-2: в теле `/metrics` есть `nodejs_eventloop_lag_p99_seconds`, `process_resident_memory_bytes`, `process_cpu_seconds_total`. (int)
- [ ] AC-3: `GET /metrics` на основном порту `app` → в ответе нет `app_info`. `/metrics` нет в маршрутах основного Fastify, `routes.int.test.ts` («маршруты = `REST_ROUTES`») зелёный. (int)
- [ ] AC-4: 400 запросов `/metrics` подряд с одного IP → все 200 (лимита нет); строк лога `"msg":"request"` с `path` `/metrics` нет. (int)
- [ ] AC-5: два `startApp` в одном процессе → оба отдают свои `/metrics` без ошибки регистрации; `APP_VERSION` у каждого свой. (int)
- [ ] AC-6: после `app.close()` порт метрик свободен (повторный `listen` на нём успешен). (int)
- [ ] AC-7: `GET /api/health` → тело `{"status":"ok"}` без поля версии (регрессия P16). (int)

**Логи**
- [ ] AC-8: запросы `GET /challenge/<uuid>`, `POST /api/challenges/<uuid>/accept`, `GET /api/challenges/<uuid>?x=1`, `GET /game/<uuid>` → в строках лога `req.path` = `/challenge/:id`, `/api/challenges/:id/accept`, `/api/challenges/:id`, `/game/<uuid>`; исходного `uuid` вызова в выводе лога нет. (int)
- [ ] AC-9: маршрут бросает ошибку с полями `detail: "Key (email)=(a@b.c)"`, `code: "23505"` → в строке лога у `err` только `type`, `message`, `stack`, `code`, подстроки `a@b.c` нет. (unit или int)

**Sentry сервера**
- [ ] AC-10: неизвестное исключение в маршруте (`SENTRY_DSN` задан, транспорт подменён тестовым) → ровно одно событие. В нём `request_id` равен `error.request_id` ответа, `environment` = `APP_ENV`, `release` = `APP_VERSION`. (int)
- [ ] AC-11: ответы `validation_failed`, `not_found`, `rate_limited` → событий Sentry 0. (int)
- [ ] AC-12: `beforeSend` (сервер и клиент), на входе событие с `request.cookies`, `request.headers`, `request.data`, `request.query_string`, `user: {id, email, ip_address, username}` → на выходе `request` без `cookies`, `headers`, `data`, `query_string`; `user` = `{id}`. (unit, по полю на проверку — SECURITY §15 MUST)
- [ ] AC-13: `beforeSend` с `event.request.url = "https://h/auth/google/callback?code=c&state=s"` → `https://h/auth/google/callback`; `"https://h/challenge/3f2c?x=1#y"` → `https://h/challenge/:id`. (unit)
- [ ] AC-14: `beforeSend` маскирует `id` вызова в `event.transaction`, `message`, каждом `exception.values[].value` (пример: `event.transaction = "/challenge/3f2c…"` → `/challenge/:id`); `/game/<id>` не меняется. (unit, по тесту на поле)
- [ ] AC-15: `beforeBreadcrumb` маскирует `message`, `data.url`, `data.to`, `data.from`. Хлебная крошка без этих полей проходит без изменений. (unit, по тесту на поле)
- [ ] AC-16: если включена трассировка — `beforeSendTransaction` маскирует `transaction` и `request.url` так же. Если выключена — в конфигурации SDK `tracesSampleRate` не задан или равен 0. (unit)
- [ ] AC-17: в `apps/server` и `apps/web` нет своей реализации маскировки: оба импортируют `maskChallengeIds` из `packages/protocol`. Проверка: grep регулярного выражения `challenges` вне `packages/protocol/src/mask.ts` пуст, либо правило в `check-architecture.sh`. (check)
- [ ] AC-18: `SENTRY_DSN` не задан → `startApp` стартует, Sentry не инициализирован (`Sentry.getClient()` пуст), исходящих запросов нет. (int)
- [ ] AC-19: Sentry сервера инициализирован с `sendDefaultPii: false`; на клиенте нет интеграции Replay и нет `replaysSessionSampleRate` / `replaysOnErrorSampleRate` > 0. (unit)

**Sentry клиента**
- [ ] AC-20: в `apps/web` при заданном DSN SDK инициализируется с `environment` и `release` от сервера, хуки — те же функции AC-12…AC-15 (общий модуль или одинаковый набор тестов). Без DSN — не инициализируется, сетевых запросов к Sentry нет (e2e: в `page.on("request")` нет хоста Sentry). (unit + e2e)
- [ ] AC-21: `t()` без ключа в production-сборке → возвращает ключ, Sentry получает одно сообщение на ключ (при двух вызовах с тем же ключом — одно). (unit, jsdom)
- [ ] AC-22: после `npm run build -w apps/web` скрипт `scripts/check-bundle.sh` проходит (≤ 300 КБ gzip с Sentry); `.map` созданы рядом с файлами `assets/` и не подключены из `index.html`. (check, CI)

**Analytics**
- [ ] AC-23: миграция создаёт `analytics_events` с колонками `id`, `name`, `user_id` (NULL), `game_id` (NULL), `props` (jsonb, NOT NULL, по умолчанию `{}`), `created_at`. Миграция только добавляющая (`check-architecture.sh` зелёный). (int, check)
- [ ] AC-24: запись `game_finished` с `user_id`, `game_id`, `props {termination: "checkmate", after_restart: false}` → одна строка с этими значениями, `created_at` = `ManualTimeSource.wallNow()`. (int)
- [ ] AC-25: `props` с ключом `email` (а также `nickname`, `ip`, `user_agent`) → строка не записана, исключения нет, в логе предупреждение без значения ключа. (int)
- [ ] AC-26: запись при сломанной БД (таблица переименована или пул закрыт) → вызов не бросает и не реджектится в вызывающем, ошибка в логе. (int)
- [ ] AC-27: запись внутри транзакции вызывающего, при которой вставка события падает → транзакция вызывающего коммитится, её данные сохранены. Механизм — по решению architect, вопрос п.1. (int)
- [ ] AC-28: `user_active` для одного `user_id` три раза в одни сутки UTC → одна строка; `time.advance` через 00:00 UTC → вторая; для другого `user_id` — своя строка. (int, `ManualTimeSource`)
- [ ] AC-29: два `startApp` → дедупликация `user_active` у каждого своя (EC-16). (int)
- [ ] AC-30: `SQL` к `analytics_events` есть только в `apps/server/src/analytics/repo.ts`; `analytics` ни от кого не зависит (`depcruise` и `check-architecture.sh` зелёные). (check)
- [ ] AC-31: `trackEvent` (REST) остаётся в `PENDING_CATALOG`, маршрута `POST /api/analytics/events` нет: `routes.int.test.ts` и `check-api-doc.sh` зелёные. (check, int)

**Хвост E01 п.10**
- [ ] AC-32: `ErrorResponse.error.request_id` в схеме — `z.uuid()`: ответ с `request_id: "x"` не проходит схему. Снимок `snapshot/protocol.json` построен с `io: "output"` и обновлён. (unit, `[contracts]`)

## Открытые вопросы

**К Ivan**
1. Трассировка производительности Sentry (`tracesSampleRate`) и семплирование ошибок. ТЗ §5 требует только «логи ошибок». По умолчанию analyst — трассировка выключена, ошибки 100%: квота бесплатного тарифа и меньше данных у третьей стороны (R8).
2. Включите в проекте Sentry «Prevent Storing of IP Addresses» и алерт AL11 «новая проблема в `prod`» → e-mail — до первой выкатки (R2; OPERATIONS §13). Подтвердите, что это ваш ручной шаг. В E03 он не проверяется.
3. Политика конфиденциальности (F3-Q1, тексты — E04) должна назвать Sentry как обработчика ошибок со сроком 30 дней (R1). Подтвердите, что текст добавят в E04.
4. ROADMAP, «Открытые вопросы», п.1 («E03 до первой выкатки») ещё не закрыт. Требования написаны в предположении «да».

**К architect**
1. Запись события в транзакции вызывающего (EC-20, AC-27). Если вставка в `trx` падает, PostgreSQL прерывает всю транзакцию, а это нарушает §7.5 MUST «не ломает сценарий». Варианты: писать вне `trx` после коммита, SAVEPOINT, очередь в памяти. Нужен ли `trx` в сигнатуре вообще, и что видно, если вызывающий откатился?
2. Как клиент получает `SENTRY_DSN`, `environment` и `release`. DSN — переменная среды `app` (OPERATIONS §7), `release` = `APP_VERSION`, образ собирается отдельно для prod и staging, CSP `script-src 'self'` запрещает inline-скрипт. Варианты: `<meta>` в `index.html` при отдаче, REST-операция, переменные сборки Vite. Нужна ли новая операция в API §12 и `REST_ROUTES` — тоже решение.
3. Маскировать ли `id` вызова в pino не только в `path`, но и в `err.message` / `stack` / `msg`. SECURITY §15 требует только путь, остальное — запрет для разработчика (R4).
4. Значение `app_info{version}` без `APP_VERSION` (dev, тесты): `dev`, `unknown` или ошибка конфига при `APP_ENV=prod`/`staging`?
5. Адрес и порт метрик: имена переменных конфига. Внутри контейнера нужен `0.0.0.0:9464` (`load` читает `app-staging:9464` по сети, OPERATIONS §11), снаружи — `127.0.0.1` (compose). Связь с хвостом E01 «`HOST=0.0.0.0` в контейнере» (E02). Новая переменная → `env.allowlist` и OPERATIONS §7 (E02). Поведение при занятом порте (EC-17).
6. `/metrics` на основном порту (EC-13): 404 или SPA-фолбэк. Сейчас SPA-фолбэк отдаст `index.html` с 200.
7. Порядок инициализации `@sentry/node` в ESM (`--import` до Fastify или ручной `captureException` без автоинструментации) и как избежать двойного события (С1 п.4). `CMD` образа — зона E02.
8. Пробел между эпиками: `deploy.sh` п.0 (`games_active > 10`), `load` (`> 2`) и `status` (`players_online`, `games_active`) читают метрики, которых до E06/E22 нет. Варианты: E03 публикует `chezz_games_active` и `chezz_players_online` = 0 как заглушки (противоречит нарезке ROADMAP), или скрипты E02 считают отсутствующую метрику нулём. Решить вместе с E02.
9. Внешние ключи `analytics_events.user_id` → `users`, `game_id` → `games`. Таблиц пока нет (E04, E06). По умолчанию analyst — без FK: запись техническая, как строка лога (A26).
10. Имя метода сервиса. В ROADMAP он назван `trackEvent`, так же называется REST-операция API §12 (P13). Совпадение имён допустимо или метод сервиса называется иначе (например, `record`)?
11. Удалять ли строку запроса и в `breadcrumbs[].data.url` (fetch к `/auth/*`). SECURITY §15 требует удалять её только у `request`.
