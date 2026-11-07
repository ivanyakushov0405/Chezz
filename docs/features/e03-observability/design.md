# Design: E03 Наблюдаемость `app` — Sentry, `/metrics`, маскирование `/challenge/<id>`, модуль `analytics`

Версия 0.1 · 2026-11-07 · architect (режим design). Основа: `requirements.md` v0.1 (AC-1…AC-32, EC-1…EC-28); ARCHITECTURE §3.4, §7.1, §7.2, §7.5, §13, §16; SECURITY §6, §15; API P16, §5.1, §7, §15; OPERATIONS §6.1, §6.2, §7, §9.4, §11, §12; TESTING §7.3; E01 `design.md` «Хвосты» п.1, п.10; код E01 в `main` (`platform/*`, `packages/protocol/src/mask.ts`, `apps/web`).

Вопросы к Ivan п.1–4 без ответа: принято значение по умолчанию из `requirements.md` — трассировки нет, ошибки 100 %; «Prevent Storing IP» и алерт AL11 — ручной шаг Ivan; Sentry в политике — E04; E03 мержится до первой выкатки.

## Обзор решения

1. **Метрики** — `platform/metrics.ts`: свой `prom-client` `Registry` на каждый `buildApp` (EC-16), `collectDefaultMetrics({ register })` и gauge `app_info{version}` = 1. Отдаёт отдельный `node:http`-сервер (не Fastify): `GET /metrics` → 200 `text/plain; version=0.0.4`, остальное → 404. Нет логгера, лимита и хуков Fastify (EC-14). Слушает `METRICS_HOST:METRICS_PORT` (по умолчанию `127.0.0.1:9464`; в образе E02 — `0.0.0.0`). Слушать начинает в `onReady` Fastify. Порт занят → `onReady` бросает → `app.listen` реджектится → `main` пишет «app failed to start» и выходит с кодом 1 (EC-17). Закрывается в `onClose`. На основном порту `/metrics` нет: `GET /metrics` получает обычный SPA-фолбэк (`index.html`, 200) или `404 not_found`, если SPA не собран. `app_info` там нет (EC-13).
2. **Логи** — в `platform/log.ts` сериализатор `req` пишет `path = maskChallengeIds(pathOnly(url))`. Свой сериализатор `err` (хвост E01 п.1): `{type, message, stack, code}`, к `message` и `stack` применяется `maskChallengeIds` (R4, вопрос architect п.3: защита на случай ошибки разработчика). Сериализатор `cause` не раскрывает.
3. **Sentry сервера** — `platform/sentry.ts`, `createErrorReporter(opts)`: без глобального `Sentry.init` и без автоинструментации. Свой `NodeClient` + `Scope` на экземпляр, `defaultIntegrations: false`, интеграции только `linkedErrors` и `dedupe`, без OpenTelemetry. Так два `buildApp` в одном процессе не мешают друг другу, нет дубля от инструментации Fastify (С1 п.4) и не нужен `--import` в `CMD` образа (вопрос п.7). `errorHandler` при статусе ≥ 500 вызывает `reporter.captureException(err, ctx)`, где `ctx` = `request_id`, метод, шаблон маршрута, маскированный путь. 4xx не отправляются (EC-8). `main.ts` вешает `uncaughtException` / `unhandledRejection`: лог `fatal` → `captureException` → `flush(2000)` → `process.exit(1)`. N = 2 с (EC-9). `onClose` → `flush(2000)` (EC-18). Без DSN `createErrorReporter` возвращает пустой репортёр (`enabled: false`): клиента нет, сети нет (EC-10). Ошибки транспорта SDK глотает, отправка асинхронная (EC-11).
4. **Фильтр событий — один на клиент и сервер**: `packages/protocol/src/scrub.ts`, функции `scrubSentryEvent` и `scrubSentryBreadcrumb` поверх `maskChallengeIds`. Типы в нём структурные, без зависимости от `@sentry/*`. Обе стороны ставят их в `beforeSend`, `beforeSendTransaction` и `beforeBreadcrumb` (AC-12…AC-17, AC-20).
5. **Конфиг клиента** (вопрос п.2) — `<meta>` в `index.html` при отдаче. `app` один раз читает `index.html` из `webDistDir` и вставляет перед `</head>` теги `chezz-sentry-dsn` (только при заданном DSN), `chezz-environment` и `chezz-release`; значения экранируются. Вставленный HTML отдаётся на `/`, `/index.html` и SPA-фолбэк. Скрипта в HTML нет — CSP `script-src 'self'` соблюдена. Новой REST-операции нет. `release` клиента = `APP_VERSION` сервера по построению (R9). Образ один на среду, сборка не зависит от DSN.
6. **Sentry клиента** — `@sentry/browser` (не `@sentry/react`), `apps/web/src/shared/observability/sentry.ts`. `initSentry()` вызывается до `createRoot`: читает `<meta>`; если DSN нет — выходит, SDK не инициализируется. Параметры: `defaultIntegrations: false`; интеграции `globalHandlers`, `linkedErrors`, `dedupe`, `breadcrumbs`; `sendDefaultPii: false`; без `tracesSampleRate`, без Replay. «Нет ключа перевода»: в `packages/i18n` `createT` получает колбэк `onMissingKey(key)`, а `apps/web` отправляет `captureMessage("i18n missing key: <key>", "warning")` один раз на ключ за жизнь страницы (EC-26).
7. **`analytics`** (L0) — таблица `analytics_events` (первая миграция) и `createAnalyticsService(deps)`. `record(event): void` — fire-and-forget: в вызывающий код ничего не возвращает и не бросает, запись идёт своим соединением пула, **не в `trx` вызывающего**. Вызывать её — после коммита сценария (вопрос п.1, ADR-0010). `created_at` берётся из `time.wallNow()` в момент вызова `record`. Перед вставкой — проверка схемой (имя, `user_id`/`game_id` uuid, точный набор ключей `props`). Нарушение → `warn` в лог с `name` и именами лишних ключей, без значений; строка не пишется (EC-21, EC-22). Ошибка вставки → `error` в лог и `reporter.captureException` (С4 п.3). `drain(): Promise<void>` ждёт незавершённые записи и никогда не реджектится: в `onClose` и в тестах. Дедупликация `user_active` — `Map<user_id, "YYYY-MM-DD">` по UTC в замыкании фабрики; при смене суток map очищается (EC-25, EC-19). Внешних ключей нет (вопрос п.9). Метод называется `record`, а не `trackEvent`: имя `trackEvent` занято REST-операцией P13 (вопрос п.10).
8. **Хвост E01 п.10** — `ErrorResponse.error.request_id: z.uuid()`. В `buildSnapshot` схемы ответа (`response`, `common.ErrorResponse`, `ws_server`) строятся с `io: "output"`, входа (`params`, `query`, `body`, `ws_client`) — с `io: "input"`. Сервер и так шлёт UUID: сужение выхода совместимо, `PROTOCOL_VERSION` не меняется (API §7: в PR — строка «снимок изменён совместимо»).

Связи (ARCHITECTURE §7.1): `analytics` → `platform` (типы `Db`, `TimeSource`, `ErrorReporter`, логгер). Других модулей в E03 нет, вызовов `record` из модулей нет. В `app.ts`: L0 `platform` (метрики, репортёр) → L0 `analytics` → маршруты. Транзакций в эпике нет.

Сквозные e2e-сценарии: **есть, один короткий** — T-6, `tests/e2e/observability.spec.ts`: без DSN SPA не ходит к Sentry, в HTML есть `chezz-release` и `chezz-environment` (AC-20, e2e-часть). Остальное проверяют int- и unit-тесты.

## Выжимка правил для этой фичи

**Все зоны**
- Маскировка — только `maskChallengeIds` из `@chezz/protocol`, второй реализации нет; `/game/<id>` не маскируется (SECURITY §15, S37; OPERATIONS O18).
- В логах и Sentry нет cookie, `Authorization`, `Set-Cookie`, тел запросов, строки запроса, e-mail, `google_name`; пользователь — только `id` (SECURITY §15).
- `id` вызова не пишется в текст ошибок; Session Replay и запись экрана запрещены (SECURITY §15).
- `SENTRY_DSN` — не секрет; `environment` = `APP_ENV`, `release` = `APP_VERSION` (OPERATIONS §7, §12.4, O22). Source maps лежат рядом со статикой, токена Sentry в CI нет (O22).
- `/metrics` — только на отдельном порту; через `edge` его нет; `GET /api/health` — без версии (SECURITY S32; API P16; OPERATIONS §6.3).
- Имена — из GLOSSARY. `analytics_events` и имена событий — технические идентификаторы, не сущности (ARCHITECTURE A26).

**contracts** (T-1)
- Раскладка `packages/protocol/src` — API §15, в том числе новые строки `mask.ts`, `scrub.ts` (правка 3 ниже).
- Изменение снимка без смены `PROTOCOL_VERSION` в PR объясняется как совместимое (API §7, §16).

**backend** (T-2…T-4)
- Состояние — в замыкании фабрики, без синглтонов; фабрики вызывает только `app.ts`; `start`/`stop` — в `onReady`/`onClose` (ARCHITECTURE §7.2, ADR-0005).
- Время — только `TimeSource` (`wallNow` для `created_at` и суток UTC) (ARCHITECTURE §7.2, A27).
- SQL к `analytics_events` — только в `analytics/repo.ts`; тип строки — `analytics/tables.ts`; `Database` в `database.ts` получает `& AnalyticsTables` (ARCHITECTURE §7.4, ADR-0005 п.5).
- Миграции только добавляющие (ARCHITECTURE §5 MUST).
- Запись события не блокирует и не ломает сценарий; в `props` нет ПДн (ARCHITECTURE §7.5; SECURITY §15).
- `internal` → в лог и Sentry с тем же `request_id`, наружу без подробностей (API §5.1).
- Лимит — только для `/api`, `/auth`, upgrade (SECURITY §9): к порту метрик не относится.

**frontend** (T-5)
- Главная ≤ 300 КБ gzip (`scripts/check-bundle.sh`), `.map` в бюджет не входят (ARCHITECTURE §12).
- Inline-скриптов нет, конфиг — только из `<meta>` (SECURITY §6).
- Новых экранов, строк интерфейса и ключей i18n нет.

## Публичные интерфейсы для тестов

### HTTP

| Где | Запрос | Ответ |
|---|---|---|
| порт метрик (`TestApp.metricsUrl`) | `GET /metrics` | 200, `Content-Type` начинается с `text/plain`, тело — формат Prometheus; есть строка ровно `app_info{version="<APP_VERSION>"} 1` и метрики `nodejs_eventloop_lag_p99_seconds`, `process_resident_memory_bytes`, `process_cpu_seconds_total` |
| порт метрик | любой другой путь или метод | 404, тело пустое |
| основной порт | `GET /metrics` | без `app_info` в теле: SPA-фолбэк (200, `index.html`) при собранном SPA, иначе `404` `not_found` |
| основной порт, SPA собран | `GET /`, `GET /index.html`, `GET /challenge/<uuid>` | HTML; перед `</head>`: `<meta name="chezz-environment" content="<APP_ENV>">`, `<meta name="chezz-release" content="<APP_VERSION>">` и, только при заданном DSN, `<meta name="chezz-sentry-dsn" content="<DSN>">` |
| основной порт | `GET /api/health` | как в E01: `{"status":"ok"}` без версии |

Строк лога `"msg":"request"` от порта метрик нет никогда.

### Конфиг (`platform/config.ts`)

| Переменная | Тип / по умолчанию | Поле `AppConfig` |
|---|---|---|
| `APP_VERSION` | `^[A-Za-z0-9._-]{1,64}$`; по умолчанию `dev`; при `APP_ENV` = `prod` / `staging` обязательна, иначе `ConfigError` (вопрос п.4) | `appVersion: string` |
| `SENTRY_DSN` | URL `https`; пусто = не задан | `sentryDsn: string \| null` |
| `METRICS_HOST` | по умолчанию `127.0.0.1` | `metrics: { host: string; port: number } \| null` (`null` — сервер метрик не поднимается, так делают `routes.int.test.ts` и подобные) |
| `METRICS_PORT` | 0…65535, по умолчанию `9464` | — |

### Тестовая инфраструктура (`apps/server/test/support/`, пишет T-2/T-3/T-4)

```ts
interface StartAppOptions {
  config?: Partial<AppConfig>;          // appVersion по умолчанию "test"; metrics — свободный порт 127.0.0.1
  logDestination?: DestinationStream;
  time?: { wall?: Date };               // старт ManualTimeSource (EC-25)
  sentry?: boolean;                     // true: DSN "https://public@o0.ingest.sentry.io/0" и транспорт в память
}
interface TestApp {
  // …поля E01…
  metricsUrl: string;                   // http://127.0.0.1:<порт метрик>
  analytics: AnalyticsService;          // экземпляр, созданный buildApp
  sentryEvents(): Promise<SentryEvent[]>; // flush + отправленные события (после scrub); без sentry: [] 
}
// test/support/analytics.ts
listAnalyticsEvents(): Promise<AnalyticsEventRow[]>; // все строки analytics_events базы воркера, по created_at, id
```
`close()` закрывает и сервер метрик: после неё порт свободен (AC-6). Штатный `app.close()` тоже освобождает порт.

### `@chezz/protocol` (T-1)

```ts
// scrub.ts — структурные типы, без зависимости от @sentry/*
export function scrubSentryEvent<E extends SentryEventLike>(event: E): E;
export function scrubSentryBreadcrumb<B extends SentryBreadcrumbLike>(breadcrumb: B): B;
```
Поведение (по полю — отдельный тест, SECURITY §15 MUST):
- `request.cookies`, `request.headers`, `request.data`, `request.query_string`, `request.env` удаляются;
- `request.url` — без `?…` и `#…`, затем `maskChallengeIds`;
- `user` → `{ id }`, если `id` есть, иначе `user` удаляется;
- `transaction`, `message`, `logentry.message`, каждое `exception.values[].value` и все `breadcrumbs[]` (через `scrubSentryBreadcrumb`) — через `maskChallengeIds`;
- хлебная крошка: `message`, `data.url`, `data.to`, `data.from` — через `maskChallengeIds`; у `data.url`, `data.to`, `data.from` удаляется строка запроса и фрагмент (вопрос п.11 — да: `fetch` к `/auth/*`). Других полей нет — крошка не меняется;
- функции не бросают на любом входе и возвращают тот же объект (мутация допустима).

`ErrorResponse.error.request_id` — `z.uuid()` (AC-32).

### Sentry сервера (`platform/sentry.ts`, T-3)

```ts
export interface ErrorContext { request_id?: string; method?: string; route?: string; path?: string; user_id?: string }
export interface ErrorReporter {
  readonly enabled: boolean;
  captureException(error: unknown, ctx?: ErrorContext): void;
  captureMessage(message: string, level: "warning" | "error"): void;
  flush(timeoutMs: number): Promise<boolean>;
}
export function createErrorReporter(opts: { dsn: string | null; environment: AppEnv; release: string; origin: string; transport?: TransportFactory }): ErrorReporter;
```
Событие 5xx из `errorHandler`: `tags.request_id` = `error.request_id` ответа, `request.method`, `request.url` = `<APP_ORIGIN><маскированный путь без строки запроса>`, `transaction` = `"<METHOD> <шаблон маршрута>"` (для неизвестного маршрута — `"<METHOD> <маскированный путь>"`), `environment`, `release`. Ровно одно событие на одну ошибку.

### `analytics` (`apps/server/src/analytics/service.ts`, T-4)

```ts
export type AnalyticsEvent =
  | { name: "user_registered" | "user_active" | "seek_started"; user_id: string }
  | { name: "seek_matched" | "seek_cancelled"; user_id: string; props: { wait_ms: number } }
  | { name: "game_started"; user_id: string; game_id: string }
  | { name: "game_finished"; user_id: string; game_id: string; props: { termination: string; after_restart: boolean } }
  | { name: "analysis_opened"; user_id: string | null; game_id: string };
export interface AnalyticsService {
  record(event: AnalyticsEvent): void;  // не бросает; запись — в фоне, своим соединением
  drain(): Promise<void>;               // ждёт начатые записи; не реджектится
}
export function createAnalyticsService(deps: { db: Db<Database>; time: TimeSource; log: FastifyBaseLogger; reporter: ErrorReporter }): AnalyticsService;
```
- Таблица `analytics_events`: `id uuid PK default gen_random_uuid()`, `name text NOT NULL`, `user_id uuid NULL`, `game_id uuid NULL`, `props jsonb NOT NULL DEFAULT '{}'`, `created_at timestamptz NOT NULL`; индекс `(name, created_at)`; FK и CHECK по имени нет.
- Проверка: `wait_ms` — целое ≥ 0; `termination` — `^[a-z_]{1,32}$`; `user_id`/`game_id` — uuid; лишний ключ или неизвестное `name` → строка не пишется, `warn` `"analytics event rejected"` с `name` и `keys` (только имена ключей).
- Тест транзакции (AC-27 в этой формулировке): `record` вызывается внутри транзакции тестового кода на базе воркера при переименованной `analytics_events`. Транзакция коммитится, в логе — `error` записи события. Сигнатура `record` не принимает `trx`.
- В логах: `"analytics event rejected"` (warn), `"analytics event write failed"` (error, с `err`).

### Клиент (T-5)
- `<meta>` выше — единственный вход конфигурации Sentry клиента.
- `createT(locale, { onMissing: "key" | "throw", onMissingKey?: (key: string) => void })` в `@chezz/i18n`.

## Изменения документов основ

Вносит architect в режиме apply после утверждения. Номера: A31, ADR-0010 — следующие свободные.

### 1. `docs/adr/0010-observability-wiring.md` (новый)
```markdown
# ADR-0010: Наблюдаемость `app`: Sentry без автоинструментации, конфиг клиента в `<meta>`, запись аналитики после коммита

Статус: принято (Ivan, <дата утверждения design.md E03>). Предложено: 2026-11-07 (architect, E03 design).

## Контекст
ARCHITECTURE A22 и OPERATIONS O22 требуют Sentry на сервере и клиенте с `release` = `APP_VERSION`. Одновременно действуют ограничения: два `buildApp` в одном процессе тестов (ADR-0005 п.2); один поток с бюджетом хода (ARCHITECTURE §9.4); CSP без inline-скриптов (SECURITY §6); один образ на среду. ARCHITECTURE §7.5 требует, чтобы запись события не ломала сценарий, а ошибка вставки внутри транзакции PostgreSQL прерывает всю транзакцию.

## Решение
1. Сервер: `@sentry/node` без `Sentry.init` и автоинструментации — свой `NodeClient` и `Scope` на `buildApp`, `defaultIntegrations: false`. В Sentry уходят 5xx `errorHandler` и необработанные исключения процесса (отправка ≤ 2 с до выхода). Трассировки нет.
2. Фильтр событий — `scrubSentryEvent` / `scrubSentryBreadcrumb` в `packages/protocol/src/scrub.ts` поверх `maskChallengeIds`, один для клиента и сервера.
3. Клиент получает DSN, `environment` и `release` из `<meta name="chezz-sentry-dsn|chezz-environment|chezz-release">`. Их вставляет `app` в `index.html` при отдаче. REST-операции нет.
4. `analytics.service.record(event)` — без `trx`, fire-and-forget, своим соединением пула. Модуль вызывает её после коммита своего сценария.

## Последствия
- Дублей от инструментации Fastify нет, `CMD` образа не меняется. Цена — нет автоматических хлебных крошек сервера и трассировки; включить трассировку можно только правкой этого ADR.
- Модуль `seo` (E-эпик публичных страниц), отдающий HTML с SPA, вставляет те же `<meta>` (функция `platform`).
- Событие сценария, откатившегося после `record`, может остаться в `analytics_events`. Поэтому вызов — только после коммита; падение `app` между коммитом и записью теряет событие (как строку лога).
- Альтернативы: `Sentry.init` через `--import` — глобальное состояние, конфликт с ADR-0005 п.2, автоинструментация на горячем пути; REST `GET /api/client-config` — лишний запрос до инициализации, ошибки старта теряются; переменные сборки Vite — DSN и SHA в сборке, образ зависит от среды; SAVEPOINT в `trx` вызывающего — запись держит транзакцию хода.
```

### 2. `docs/ARCHITECTURE.md` §3.4 — новая строка после A26
> | A31 | Наблюдаемость `app`: Sentry сервера без автоинструментации (свой клиент на `buildApp`), фильтр событий `scrubSentryEvent`/`scrubSentryBreadcrumb` в `packages/protocol` (один на клиент и сервер), конфиг Sentry клиента — `<meta>` в `index.html` от `app`; `analytics.service.record` — без `trx`, после коммита, fire-and-forget (ADR-0010) | E03 design; ADR-0010 | `Sentry.init` с `--import` — глобальное состояние против ADR-0005 п.2; REST-конфиг клиента — лишний запрос; запись события в `trx` вызывающего — её ошибка прерывает транзакцию |

### 3. `docs/ARCHITECTURE.md` §7.5 — после строки «MUST: запись события не блокирует и не ломает сценарий: ошибка записи логируется, ход и партия идут дальше.» добавить
> - MUST (A31, ADR-0010): `analytics.service.record(event)` не принимает `trx` и пишет своим соединением; модуль вызывает её после коммита своего сценария. Внешних ключей у `analytics_events` нет (запись техническая, A26). Метод сервиса — `record`; `trackEvent` — имя REST-операции (F4 P13).

### 4. `docs/ARCHITECTURE.md` §16 — строка после ADR-0009
> | ADR-0010 | Наблюдаемость `app`: Sentry без автоинструментации, конфиг клиента в `<meta>`, запись аналитики после коммита | `docs/adr/0010-observability-wiring.md` |

### 5. `docs/SECURITY.md` §15
- Было: «MUST (S37, F7 O18): сериализатор пути заменяет сегмент после `/challenge/` и `/api/challenges/` на `:id` — …» (строка без изменений). После неё добавить:
> - MUST: ошибка в логе — только `type`, `message`, `stack`, `code` (свой сериализатор `err`; поля вроде `detail` у ошибок `pg` не пишутся); к `message` и `stack` применяется `maskChallengeIds`.
- В пункте «MUST (S37): `beforeSend` и `beforeBreadcrumb` маскируют …» было: «… `breadcrumbs[].message` и `breadcrumbs[].data.url`/`to`/`from`. Если включена трассировка …» → стало: «… `breadcrumbs[].message` и `breadcrumbs[].data.url`/`to`/`from`; у `event.request.url` и `breadcrumbs[].data.url`/`to`/`from` строка запроса и фрагмент удаляются. Хуки — `scrubSentryEvent`/`scrubSentryBreadcrumb` в `packages/protocol` (ARCHITECTURE A31). Если включена трассировка …».

### 6. `docs/API_CONVENTIONS.md` §15, таблица раскладки — после строки `pages.ts`
> | `mask.ts` | `maskChallengeIds` — маскировка `id` вызова (SECURITY §15) |
> | `scrub.ts` | `scrubSentryEvent`, `scrubSentryBreadcrumb` — фильтр событий Sentry клиента и сервера (SECURITY §15, ARCHITECTURE A31) |

### 7. `docs/OPERATIONS.md` §6.2
Было: «- `ARG APP_VERSION` (git SHA, не секрет) → `ENV APP_VERSION`, метка `org.opencontainers.image.revision`; `app` отдаёт его в `app_info{version}` (API P16).»
Стало: «- `ARG APP_VERSION` (git SHA, не секрет) → `ENV APP_VERSION`, метка `org.opencontainers.image.revision`; `app` отдаёт его в `app_info{version}` (API P16) и в `<meta name="chezz-release">` для Sentry клиента; при `APP_ENV` = `prod`/`staging` без `APP_VERSION` `app` не стартует. В цели `app` — `ENV HOST=0.0.0.0 METRICS_HOST=0.0.0.0` (порт метрик `METRICS_PORT`, по умолчанию 9464); снаружи порт ограничивает compose (`127.0.0.1:9464`, 6.1). Это константы образа, в `env.allowlist` их нет.»

### 8. `docs/OPERATIONS.md` §9.4 п.0 и §11 п.2 (вопрос п.8)
- §9.4 п.0, было: «0. `games_active` > 10 и нет `force` → код 3 (O38).» → стало: «0. `chezz_games_active` > 10 и нет `force` → код 3 (O38). Метрики нет в ответе `/metrics` (до E06) или `app` не отвечает (первая выкатка) — значение 0.»
- §11 п.2: после «`entry.sh` — `games_active` prod > 2 → код 3.» добавить «(нет метрики или `app` prod не отвечает — 0, как 9.4 п.0)».

### 9. `docs/TESTING.md` §7.3
Было: «- `apps/server/test/support/app.ts`: `startApp({ config?, logDestination? })` → `{ url, wsUrl, time, database: { block(), unblock() }, close() }` на случайном порту.»
Стало: «- `apps/server/test/support/app.ts`: `startApp({ config?, logDestination?, time?, sentry? })` → `{ url, wsUrl, metricsUrl, time, analytics, sentryEvents(), database: { block(), unblock() }, close() }` на случайных портах (основной и метрик); `sentry: true` — транспорт Sentry в память. Сигнатура — `design.md` E01, «Тестовая инфраструктура сервера», и E03, «Публичные интерфейсы».» (остаток пункта без изменений).

### 10. `docs/ROADMAP.md`, таблица эпиков
- E01: «| в работе |» → «| готово |» (PR #3 смержен).
- E03: «| не начат |» → «| в работе |».

## Решения (ADR)

| Решение | Альтернативы | Почему |
|---|---|---|
| Sentry сервера — свой `NodeClient` без автоинструментации (ADR-0010) | `Sentry.init` + `--import`; ручной `captureException` поверх глобального `init` | ADR-0005 п.2 (два `buildApp`); нет дубля событий (С1 п.4); нет OpenTelemetry на горячем пути (§9.4); `CMD` E02 не меняется |
| Фильтр событий в `packages/protocol/src/scrub.ts` | копии в `apps/server` и `apps/web` с общим набором тестов; новый пакет | одна реализация рядом с `maskChallengeIds`; новый пакет — правка ARCHITECTURE §13 ради двух функций |
| Конфиг клиента — `<meta>` от `app` | REST-операция; `import.meta.env` при сборке | CSP без inline-скриптов; ошибка старта SPA ловится; `release` = `APP_VERSION` по построению; нет новой операции в API §12 |
| `record` без `trx`, после коммита, в фоне | SAVEPOINT в `trx`; очередь с повтором | §7.5 MUST: падение вставки не прерывает транзакцию хода; запись техническая, потеря при падении процесса допустима (как строки лога) |
| `APP_VERSION` по умолчанию `dev`, в `prod`/`staging` обязательна | `unknown` везде | без версии `deploy.sh` п.8а провалится позже и с неясной причиной |
| `/metrics` — `node:http`, не второй Fastify | второй Fastify; маршрут на основном порту | S32; нет строки лога и лимита на опрос (R7, EC-14); проще закрывать |
| `/metrics` на основном порту — обычный SPA-фолбэк | отдельный 404 | новый особый маршрут ради пути без данных; `app_info` всё равно нет (EC-13) |
| Порт метрик занят → `app` не стартует, код 1 | стартовать без метрик | причина видна сразу, а не в `deploy.sh` п.8а |
| Маскировка и в `err.message`/`stack` pino | только путь | дёшево; R4 (ошибка разработчика не выдаёт секрет) |
| Нет FK у `analytics_events` | FK на `users`, `games` | таблиц ещё нет; запись техническая; FK мешал бы обезличиванию и порядку миграций |
| `chezz_games_active` нет → 0 в `deploy.sh`/`load` | метрики-заглушки в E03 | нарезка ROADMAP; на первой выкатке `app` ещё нет |

## Выкатка и откат

- Миграция одна, только добавляющая (`analytics_events`): откат образа на прежний оставляет таблицу, прежний код её не читает.
- Новые переменные: `APP_VERSION` (уже из Dockerfile, E02), `METRICS_HOST`/`METRICS_PORT` — константы образа (правка 7). `SENTRY_DSN` уже в OPERATIONS §7 и `env.allowlist` (E02). Для E02 из E03 нужно: `ENV METRICS_HOST=0.0.0.0` в цели `app`; `SENTRY_INGEST` = хост DSN (иначе CSP `connect-src` режет отправку клиента).
- Проверка на VPS — первая выкатка prod после мержа E02 и E03 (OPERATIONS §9.4 п.8а). До неё — int-тесты и e2e.
- `deploy-staging` для E03 не нужен: эпик не трогает вход, удаление и выкатку; до первой выкатки prod staging запрещён (O40). `load-staging` до первой выкатки невозможен. Затронут `platform` — нагрузка проверится при первом `load.yml` после E02.
- Ручные шаги Ivan до первой выкатки (OPERATIONS §20): проект Sentry, «Prevent Storing of IP Addresses», алерт AL11 → e-mail, UptimeRobot.

## План задач

Порядок строгий: T-1 → T-2 → T-3 → T-4 → T-5 → T-6. `[infra]` и `[ci]` не нужны: `Dockerfile`, compose, Caddy — E02; `check-bundle.sh` уже в CI.

### T-1 [contracts] Риск: high
Фильтр событий Sentry и хвост E01 п.10. Риск high: это главный фильтр ПДн и секрета ссылки перед третьей стороной (SECURITY §15).
- Файлы: `packages/protocol/src/scrub.ts` (+ экспорт в `index.ts`), `scrub.test.ts`; `common.ts` (`request_id: z.uuid()`); `snapshot.ts` (`io: "output"` для `response`, `common.ErrorResponse`, `ws_server`); `snapshot/protocol.json` (перегенерация); правки `schemas.test.ts`, `snapshot.test.ts`.
- AC: AC-12…AC-15 (на уровне функций), AC-16 (хук для `beforeSendTransaction` — тот же `scrubSentryEvent`), AC-32; правила «Публичных интерфейсов» для `scrub.ts`; `PROTOCOL_VERSION` не меняется; `npm run check` зелёный.

### T-2 [backend:platform] Риск: low
Конфиг, метрики, логи (хвост E01 п.1), тестовая инфраструктура метрик.
- Файлы: `apps/server/package.json` (+ `prom-client`), `package-lock.json`; `platform/config.ts` (`APP_VERSION`, `SENTRY_DSN`, `METRICS_HOST`, `METRICS_PORT`); `platform/metrics.ts` (registry, `app_info`, `node:http`-сервер, хуки `onReady`/`onClose`); `platform/log.ts` (маскировка пути, сериализатор `err`); `app.ts` (метрики); `main.ts`; `test/support/app.ts` (`metricsUrl`, `time.wall`, `appVersion: "test"`, закрытие метрик в `close()`); правки тестовых `AppConfig` в своих `*.int.test.ts`; `.env.example`; `scripts/check-architecture.sh` (правило AC-17: в `apps/*/src/**` без `*.test.*` нет `\/challenge` и `\/api\/challenges` в регулярных выражениях — сначала grep экранированного слэша).
- AC: AC-1…AC-9, AC-17 (правило), EC-12, EC-13, EC-14, EC-15, EC-16 (метрики), EC-17; `routes.int.test.ts` зелёный.

### T-3 [backend:platform] Риск: high
Sentry сервера и `<meta>` для клиента. Риск high: отправка данных внешнему обработчику, необработанные исключения процесса.
- Файлы: `apps/server/package.json` (+ `@sentry/node`), `package-lock.json`; `platform/sentry.ts` (`createErrorReporter`, `ErrorReporter`); `platform/errors.ts` / `platform/http.ts` (репортёр в `errorHandler` при ≥ 500); `platform/client-config.ts` (вставка `<meta>` с экранированием, функция для будущего `seo`); `app.ts` (`AppDeps.reporter?` — без него пустой; отдача HTML с `<meta>` на `/`, `/index.html`, фолбэк; `onClose` → `flush(2000)`); `main.ts` (`createErrorReporter` из конфига; `uncaughtException`/`unhandledRejection` → лог `fatal`, capture, `flush(2000)`, `exit(1)`); `test/support/app.ts` и `test/support/sentry.ts` (`sentry: true`, транспорт в память, `sentryEvents()`).
- AC: AC-10, AC-11, AC-12 (`sendDefaultPii: false` в опциях клиента), AC-18, AC-19 (сервер), EC-3…EC-11, EC-18; HTML-контракт `<meta>` из «Публичных интерфейсов».

### T-4 [backend:analytics] Риск: low
Модуль `analytics`.
- Файлы: `apps/server/migrations/0001_analytics_events.ts`; `apps/server/src/analytics/{tables.ts,repo.ts,service.ts}`; `database.ts` (`& AnalyticsTables`); `app.ts` (фабрика после `platform`, `onClose` → `drain()`); `.dependency-cruiser.cjs` — только если правило L0 для `analytics` ещё не описано; `test/support/app.ts` (`analytics`), `test/support/analytics.ts` (`listAnalyticsEvents`).
- AC: AC-23…AC-31 (AC-27 — в формулировке «Публичных интерфейсов»), EC-19…EC-25.

### T-5 [frontend] Риск: low
Sentry клиента и «нет ключа перевода».
- Файлы: `apps/web/package.json` (+ `@sentry/browser`), `package-lock.json`; `apps/web/src/shared/observability/sentry.ts` (+ `sentry.test.ts`, jsdom); `main.tsx` (`initSentry()` до `createRoot`); `shared/i18n/I18nContext.tsx` (`onMissingKey` → один `captureMessage` на ключ); `packages/i18n/src/index.ts` (`onMissingKey?`) + тест; `vite.config.ts` (`build.sourcemap: true` — `.map` рядом с `assets/`, без ссылки из `index.html`).
- AC: AC-19 (клиент), AC-20 (unit-часть: без `<meta>` DSN — `init` не вызывается; с ним — `environment`/`release` из `<meta>`, хуки из `@chezz/protocol`), AC-21, AC-22, EC-26, EC-27.

### T-6 [e2e] Риск: low
Прогон `tests/e2e/observability.spec.ts` (tester пишет его на шаге режима 1 у T-5): главная и `/challenge/<uuid>` без DSN → в `page.on("request")` нет хостов `*.sentry.io` / `*.ingest.*`; в HTML есть `meta[name="chezz-release"]` и `meta[name="chezz-environment"]`, нет `meta[name="chezz-sentry-dsn"]`. Требование к `webServer` — SPA отдаёт `app` (не `vite dev`); иначе `<meta>` нет — проверка `<meta>` пропускается с пометкой.

## Риски и открытые вопросы

К Ivan:
1. Вопросы `requirements.md` п.1–4 без ответа — приняты значения по умолчанию (см. шапку). Если нужна трассировка — правка ADR-0010 и SECURITY §15 (`beforeSendTransaction` уже маскирует).
2. Правка 8 (OPERATIONS §9.4 п.0, §11: нет `chezz_games_active` → 0) — решение для E02. Есть риск: после E06 пропавшая метрика тоже даст «0 партий». Альтернатива — заглушки метрик в E03, против нарезки ROADMAP. Подтвердите вариант «0».

Риски реализации:
- `NodeClient` + `Scope` без `Sentry.init` — поддерживаемый, но менее частый путь SDK. Если в текущем мажоре `@sentry/node` он не отправляет события без глобального `init`, T-3 останавливается блокером (не обходить через глобальный `init`), architect пересматривает ADR-0010.
- `@sentry/browser` + `scrub` в главном бандле — ≈ 25–30 КБ gzip; T-5 проверяет `check-bundle.sh`. Превышение — блокер, не ленивая загрузка молча.
- `SENTRY_INGEST` в CSP (E02) должен совпадать с хостом DSN — иначе клиентские события молча не уходят. Проверка — первая выкатка (Ivan видит тестовое событие в Sentry).
