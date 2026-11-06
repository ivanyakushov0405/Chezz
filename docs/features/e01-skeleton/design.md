# Design: E01 «Скелет репозитория»

Версия 0.1 · 2026-11-06 · architect (режим design). Основа: `requirements.md` v0.2 (51 AC, EC-1…EC-29), `design-spec.md` v0.3 (Figma `z6VyHSdwqFzCQIdP7ScisI`), профиль «Скелет репозитория (первый эпик) — 7 задач», ADR-0005, ADR-0006 (приняты Ivan 2026-11-05), новый ADR-0009, ARCHITECTURE §3, §5, §7, §12, §13; API §3, §5, §7, §12.6, §14–§17; SECURITY §6, §9, §15; TESTING §5–§7, §9, §11–§13; DESIGN §1, §4, §5, §7, §9.2, §10, §15–§17; OPERATIONS §1, §6.4, §7, §8, §16.1.

Версия 0.2 · 2026-11-06: план утверждён Ivan; apply «Изменений документов основ» п.1–8 выполнен 2026-11-06, п.9 не внесён (решение Ivan); `.github/CODEOWNERS` пишет Ivan сам — убран из T-6.

## Обзор решения

Монорепозиторий npm workspaces: `@chezz/server` (`apps/server`), `@chezz/web` (`apps/web`), `@chezz/protocol`, `@chezz/chess`, `@chezz/i18n` (`packages/*`). TypeScript без сборки для Node (`node file.ts`, только стираемый синтаксис); пакеты экспортируют исходники `.ts`; `tsc -b` — проверка типов всего дерева.

Процесс `app` собирается по ADR-0005: `main.ts` читает конфиг и создаёт `deps` → `buildApp(config, deps)` (Fastify) → `listen`. В E01 модулей, кроме `platform`, нет: `app.ts` подключает `platform` (логирование, `request.caller` = гость, ошибки, rate limit по ADR-0006, `registerRoute`), маршрут `getHealth` и раздачу собранного SPA. Миграции (их ноль) применяются при старте.

Противоречие «`check-api-doc.sh` против `routes.int.test.ts`» решает **ADR-0009**: `packages/protocol` содержит схемы только реализованных операций (в E01 — `getHealth`), а всё остальное из каталога API — именами в `PENDING_CATALOG`; скрипт сверяет «документ = реализовано ⊔ запланировано», `routes.int` — точное равенство маршрутов и `REST_ROUTES`. `ErrorCode` — полный сразу.

SPA (Vite + React, CSS Modules + `tokens.css`): один экран `lobby` в состоянии `default` (временный состав: `Logo`, `Badge` «Бета», строка текста), язык RU/EN, тема по `prefers-color-scheme`. Роутера в E01 нет (выбор — E04).

Проверки `npm run check`: `tsc -b`, ESLint, Stylelint, `dependency-cruiser`, `check-architecture.sh`, `check-api-doc.sh`. CI — `ci.yml` (`check`, `e2e`), текст готовит devops, коммитит Ivan.

## Выжимка правил для этой фичи

Общие:
- Имена — из GLOSSARY (§1, §12); TS-типы протокола — только `packages/protocol` (ARCHITECTURE §1, API §1).
- Секретов и ПДн нет в коде, логах, репозитории; `.env*` в `.gitignore` (SECURITY §1, §17). Новая зависимость — с причиной в отчёте задачи (SECURITY §18).
- Тесты tester не правятся developer (TESTING §1); имена тестов содержат `AC-n` / `EC-n` (TESTING §4).
- Правка правила F2–F5 — вместе с его проверкой в той же задаче (TESTING §11).
- Корневой конфиг в задаче правит одна роль; ссылок `tsconfig` на несуществующие workspace нет (профиль, «Скелет»).

Сервер (T-2, T-4):
- Сборка: `buildApp(config, deps)`; сервис — фабрика, состояние в замыкании, синглтонов на уровне файла нет; из чужого модуля — только `service.ts`, `events.ts`; `create<Чужой>Service` зовёт только `app.ts` (ADR-0005 п.1–4).
- Слои модуля: `api → service → domain, repo`; `domain` без `kysely`/`pg`/`fastify`/`ws` и без `Date.now`/`performance.now`/`new Date()`; SQL — только в `repo.ts` (кроме `migrations/`, `test/support/`, `scripts/seed.ts`) (ARCHITECTURE §7.2, §7.4).
- Время — только `TimeSource` (`now`, `wallNow`, `setTimer`, `clearTimer`); в тестах `ManualTimeSource` (ARCHITECTURE A27, TESTING §7.2).
- Миграции — только добавляющие (ARCHITECTURE §5).
- `X-Request-Id` генерирует сервер (`crypto.randomUUID()`, `requestIdHeader: false`), то же значение — в ответе, теле ошибки, логе (API §3).
- Лог запроса: метод, путь без строки запроса, статус, мс, `request_id`, IP, `user_id` (если не гость); `redact` `req.headers.cookie`, `req.headers.authorization`, `res.headers["set-cookie"]`; тел нет (SECURITY §15). Маскировка `/challenge/<id>` в логе — E03.
- Ошибки — формат API §5.1, коды и статусы — §5.2; `internal` без подробностей; `validation_failed.details.issues` — без входных значений (API §5, SECURITY §15).
- Изменяющие — только POST/PATCH; `Origin` = `APP_ORIGIN` на POST/PATCH, иначе `403 origin_forbidden` (SECURITY §6). CORS нет совсем, `@fastify/cors` нет (API §3).
- `X-Protocol-Version` ≠ `PROTOCOL_VERSION` или нет → `409 client_outdated`; без проверки: `/api/health`, `/auth/*`, страницы (API §7).
- Тело REST ≤ 16 КБ; ответы `/api` — `Cache-Control: no-store` (API §3, SECURITY §9).
- Rate limit: `@fastify/rate-limit`, `global: false`, `hook: "preHandler"`, ключ `user:<user_id>` / `ip:<ip>`, 300/мин; IP-лимит — `RATE_LIMIT_IP_PER_MIN`; `trustProxy` не `true` (в E01 — выключен; адрес `edge` — E02); статика и HTML — без лимита (ADR-0006, SECURITY §9).
- `GET /api/health`: `200 {"status":"ok"}` / `503 {"status":"unavailable"}`, не формат §5 (API §12.6, P16).
- Сид: `--demo` детерминированный; при `APP_ENV=prod` — ошибка без записи (TESTING §7.6).

Протокол (T-3):
- Раскладка и имена — API §15; входящие схемы `z.strictObject`, ключи `^[a-z][a-z0-9_]*$`, во входящих нет `user_id`, `creator_id`, `white_id`, `black_id` (API §1, §16).
- `PAGES` — функция на каждую строку API §14; адреса страниц — только через `PAGES` (API §14).
- `maskChallengeIds` — одна функция в `packages/protocol` (SECURITY §15, S37).
- Каталог: реализованное — в схемах и `REST_ROUTES`, запланированное — в `PENDING_CATALOG` (ADR-0009).

Клиент (T-5):
- Стили — CSS Modules + токены `tokens.css`; литералов цвета и размеров в `*.module.css` и `style={}` нет; `--base-*` — только в `tokens.css` (DESIGN §1, §17).
- Корень экрана: `data-screen="lobby"`, `data-state="default"` (DESIGN §1, §10).
- Строки — ключи `packages/i18n`, RU = EN; `error.<code>` на каждый `ErrorCode` + `error.network`, `error.unknown`, `error.engine_failed` (DESIGN §11, §15, §17).
- Язык гостя: `localStorage` → иначе `navigator.language` с `ru` → `ru`, иначе `en`; `<html lang>` = язык (DESIGN §15, §14).
- Тема гостя — только медиа-запрос, атрибута `data-theme` нет, inline-скриптов нет (DESIGN §5, U8; SECURITY §6 CSP).
- От 360 px без горизонтальной прокрутки; фокус виден (`--focus-width`, `--color-focus`) (DESIGN §1, §14).
- Главная ≤ 300 КБ gzip; ресурсы только со своего origin, шрифтов и CDN нет (ARCHITECTURE §12, §14; DESIGN §1, U4).

e2e (T-5 шаг tester, T-7):
- Селекторы — `data-screen`, `data-state`, роли и подписи доступности, не классы (TESTING §9).
- При `E2E_BASE_URL`: `webServer` не запускается; `trace`/`video`/`screenshot` — `off`, `reporter: "list"` (TESTING §9 MUST).
- `retries: 1` только при `CI=true`; в Vitest `retries` нет (TESTING §15).

CI (T-6):
- Триггеры `pull_request` в `main`, `push` в `main`; `permissions: contents: read`; без `paths`; без `pull_request_target`, `workflow_run`; actions по полному SHA; `persist-credentials: false` (OPERATIONS §1, §8; TESTING §12).
- Секретов в `ci.yml` нет; `.github/workflows/**` коммитит и пушит Ivan (OPERATIONS §1, O36).

## Публичные интерфейсы для тестов

### Тестовая инфраструктура сервера (T-2; использует tester в T-4 и далее)

`apps/server/test/support/app.ts`:
```ts
export interface TestApp {
  url: string;              // http://127.0.0.1:<случайный порт>
  wsUrl: string;            // ws://127.0.0.1:<порт>/ws (в E01 сервера WS нет — только адрес)
  time: ManualTimeSource;
  database: {
    block(): Promise<void>;   // база воркера недоступна для app (соединения рвутся, новые отклоняются)
    unblock(): Promise<void>; // снова доступна; app восстанавливается без перезапуска
  };
  close(): Promise<void>;   // без штатного завершения (TESTING §7.3)
}
export function startApp(options?: { config?: Partial<AppConfig> }): Promise<TestApp>;
```
- База — `chezz_test_<n>` воркера (TESTING §7.1); `APP_ORIGIN` = `url`; `RATE_LIMIT_IP_PER_MIN` — по умолчанию (300), если не задан в `options.config`.
- `AppConfig` экспортирует `apps/server/src/platform/config.ts` (поля — ниже, «Сигнатуры скелета»).

`apps/server/test/support/time.ts`:
```ts
export class ManualTimeSource implements TimeSource {
  constructor(start?: { now?: number; wall?: Date });
  now(): number; wallNow(): Date;
  setTimer(ms: number, fn: () => void): TimerId; clearTimer(id: TimerId): void;
  advance(ms: number): Promise<void>; // EC-4: таймеры с дедлайном ≤ now+ms — синхронно, по возрастанию дедлайна
                                      // (поставленные из обработчика внутри окна — тоже); затем ждёт хуки простоя (E06)
}
```

### HTTP-контракты `app` (T-4; contract-тесты tester)

| Запрос | Ответ |
|---|---|
| `GET /api/health`, БД доступна | `200`, тело ровно `{"status":"ok"}`, `Cache-Control: no-store`, `Content-Type: application/json; charset=utf-8` |
| `GET /api/health`, БД недоступна (`database.block()`) | `503`, тело ровно `{"status":"unavailable"}`; ответ ≤ 3 с (таймаут проверки БД 2 с) |
| `GET /api/health` без `X-Protocol-Version` или с чужим | как выше (без проверки версии) |
| 301-й запрос к `/api/*` за 60 с с одного IP (гость) | `429`, `{"error":{"code":"rate_limited","message":<строка>,"details":{"retry_after_ms":<int > 0, ≤ 60000>},"request_id":<UUID>}}`, заголовок `Retry-After: <целое ≥ 1, секунды>` |
| Любой ответ `app` | заголовок `X-Request-Id: <UUID v4>`, сгенерированный сервером; входящий `X-Request-Id` игнорируется; в теле ошибки `request_id` = заголовку |
| `GET /api/<нет такого>` | `404 {"error":{"code":"not_found","message":…,"details":null,"request_id":…}}`; считается в rate limit |
| Любой запрос с `Origin: https://evil.example` (включая `OPTIONS`) | нет заголовков `Access-Control-Allow-*` |
| `X-Forwarded-For` от клиента | не влияет на ключ лимита (ключ — адрес сокета) |
| `GET /` (собранный `apps/web/dist` есть) | `200 text/html` — `index.html` SPA, `Cache-Control: no-cache`; `/assets/*` — `public, max-age=31536000, immutable`; другие пути вне `/api`, `/auth`, `/ws` без файла — тот же `index.html` |

Коды и форма ошибок — API §5; заголовок версии — `X-Protocol-Version: <PROTOCOL_VERSION>` из `@chezz/protocol`.

### Протокол (T-3; читает tester)

`@chezz/protocol` (`packages/protocol/src/index.ts`) экспортирует: `PROTOCOL_VERSION`; `ErrorCode` (все коды API §5.2); `ErrorResponse` (формат §5.1, REST); `GetHealthResponse` (`{status: "ok" | "unavailable"}`); `REST_ROUTES` (в E01 — `getHealth`); `RouteDef`; `Who = "guest" | "onboarding" | "player"`; `ClientMessage`, `ServerMessage` (в E01 — пустые объединения); `PENDING_CATALOG`; `PAGES`; `Category`; `maskChallengeIds(text: string): string`.

`REST_ROUTES.getHealth` = `{method: "GET", path: "/api/health", who: ["guest", "onboarding", "player"], response: GetHealthResponse, status: 200, errors: []}`.

`PAGES` (API §14): `home()` → `/`; `welcome()`; `player(nickname)` → `/player/<encodeURIComponent(nickname)>`; `playerGames(nickname)` → `/player/<…>/games`; `leaderboard(category)`; `game(id)`; `gameAnalysis(id)` → `/game/<id>/analysis`; `challenge(id)`; `settings()`; `accountDelete()` → `/account/delete`; `terms()`; `privacy()`.

`npm run -w packages/protocol dump` → JSON в stdout:
```json
{"protocol_version": 1, "error_codes": ["validation_failed", "…"],
 "rest": [{"operation": "getHealth", "method": "GET", "path": "/api/health"}],
 "ws_client": [], "ws_server": [],
 "pending": {"rest": ["getMe", "…"], "ws_client": ["pong", "…"], "ws_server": ["welcome", "…"]}}
```

### Клиент и e2e (T-5; tester в шаге T-5 и T-7)

- Главная `/`: ровно один `[data-screen="lobby"]` с `data-state="default"`; внутри — ссылка `role=link` с доступным именем «Chezz» и `href="/"` (единственный интерактивный элемент), текст `Badge` и строка текста:

  | Ключ | RU | EN |
  |---|---|---|
  | `app.name` | Chezz | Chezz |
  | `app.beta` | Бета | Beta |
  | `lobby.coming_soon` | Скоро здесь можно будет играть в шахматы онлайн. | Online chess is coming soon. |
- `document.title` = `Chezz`; `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`.
- Язык: `localStorage["chezz.locale"]` ∈ {`ru`, `en`} (другое значение игнорируется) → иначе `navigator.language` начинается с `ru` → `ru`, иначе `en`; `<html lang>` = выбранный язык после загрузки.
- Тема гостя: у `<html>` нет `data-theme`.
- Все запросы страницы — на свой origin.
- Сборка: `npm run build -w @chezz/web` → `apps/web/dist/`. Разработка: `npm run dev -w @chezz/web` (Vite, прокси `/api`, `/auth`, `/ws` → `http://127.0.0.1:3000`).
- `webServer` Playwright (рекомендуемая команда; один `command` через `&&`):
  ```
  node apps/server/scripts/prepare-db.ts --recreate && node apps/server/scripts/seed.ts --demo && npm run build -w @chezz/web && node apps/server/src/main.ts
  ```
  env: `DATABASE_URL=postgres://chezz:chezz@127.0.0.1:54329/chezz_e2e`, `HOST=127.0.0.1`, `PORT=3100`, `APP_ORIGIN=http://127.0.0.1:3100`, `RATE_LIMIT_IP_PER_MIN=100000`; `url: http://127.0.0.1:3100/api/health`; `baseURL: http://127.0.0.1:3100`; `reuseExistingServer: !process.env.CI`.
- `prepare-db.ts --recreate`: удаляет и создаёт базу из `DATABASE_URL` (подключается к `postgres` того же сервера) и применяет миграции; без флага — создаёт, если нет, и мигрирует. Отказ (код ≠ 0, ничего не меняет) при `APP_ENV` = `prod` или `staging`, а также если имя базы не начинается с `chezz_`.

### Сигнатуры скелета (для следующих эпиков; закрывают API F4-Q5)

```ts
// apps/server/src/platform/config.ts
export interface AppConfig { appEnv: "dev" | "staging" | "prod"; appOrigin: string;
  rateLimitIpPerMin: number; webDistDir: string | null; logLevel: string }
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig & { host: string; port: number; databaseUrl: string };
// apps/server/src/app.ts
export interface AppDeps { db: Db; time: TimeSource; logDestination?: pino.DestinationStream }
export function buildApp(config: AppConfig, deps: AppDeps): Promise<FastifyInstance>;
// apps/server/src/platform/http.ts
export type Caller = { who: "guest" } | { who: "onboarding" | "player"; user_id: string; session_id: string };
export type CallerResolver = (req: FastifyRequest) => Promise<Caller>;
export function registerRoute<R extends RouteDef>(app: FastifyInstance, def: R,
  handler: (ctx: { caller: Caller; params; query; body; request: FastifyRequest; reply: FastifyReply }) => Promise<Response<R>>,
  opts?: { rateLimit?: { max: number; timeWindowMs: number }; checkProtocolVersion?: boolean }): void;
export const apiRateLimit: (opts?) => RouteRateLimitConfig; // для /auth/* (auth) и upgrade (realtime), ADR-0006 п.2
// apps/server/src/platform/errors.ts
export class AppError extends Error { constructor(code: ErrorCode, details?: unknown) }
// apps/server/src/platform/db.ts
export type Db; export type Trx; export function withTransaction<T>(db: Db, fn: (trx: Trx) => Promise<T>): Promise<T>;
export function migrateToLatest(db: Db): Promise<void>;
// apps/server/src/platform/time.ts
export interface TimeSource { now(): number; wallNow(): Date; setTimer(ms: number, fn: () => void): TimerId; clearTimer(id: TimerId): void }
// apps/server/src/platform/ws.ts — только типы WsHandlers, WsContext (ADR-0005 п.8)
```
Конфиг из окружения: `APP_ENV` (нет → `dev`; `staging`/`prod` требуют `APP_ORIGIN`), `APP_ORIGIN` (нет в `dev` → `http://localhost:5173`), `DATABASE_URL`, `HOST` (`127.0.0.1`), `PORT` (`3000`), `RATE_LIMIT_IP_PER_MIN` (`300`), `WEB_DIST_DIR` (`apps/web/dist` от корня репозитория; каталога нет → SPA не раздаётся, предупреждение в лог), `LOG_LEVEL` (`info`).

Порядок в `registerRoute` (после хука `onRequest` с `request.caller` и `preHandler` лимита): `Origin` (POST/PATCH) → `X-Protocol-Version` (если `checkProtocolVersion !== false`) → «Кто» (`guest` вне списка → `unauthenticated`; `onboarding` → `onboarding_required`; `player` → `forbidden`) → схемы `params`, `query`, `body` (`z.strictObject`) → обработчик → `def.response.parse(результат)` (ошибка — `500 internal`) → `def.status`.

Перевод ошибок (обработчик ошибок `platform`): `AppError(code)` → статус API §5.2; ошибка zod → `400 validation_failed`, `details.issues: [{path: "a.b", rule}]`, `rule` по коду zod: `too_big` → `max`, `too_small` → `min`, `unrecognized_keys` → `unknown_key` (путь — сам ключ), `invalid_type` → `type`, `invalid_value` → `enum`, `invalid_format` → `format`, прочее → `invalid`; тело > 16 КБ → `413 payload_too_large`; тело не `application/json` → `400 validation_failed` (`rule: "content_type"`, `path: ""`); битый JSON → `400 validation_failed` (`rule: "json"`, `path: ""`); лимит → `429 rate_limited`; прочее → `500 internal` (причина — в лог с `request_id`).

## Изменения документов основ

Вносит architect в режиме apply после утверждения этого файла. Номера решений: A30, P34–P35, U41–U42 — следующие свободные. **Статус: п.1–8 внесены в apply 2026-11-06; п.9 не внесён — решение Ivan.**

### 1. `docs/adr/0005-server-module-assembly.md`
Строку «Статус: предложено. Дата: 2026-11-05 (architect, режим roadmap; ROADMAP «Сквозные решения» п.1).» заменить на:
> Статус: принято (Ivan, 2026-11-05). Предложено: 2026-11-05 (architect, режим roadmap; ROADMAP «Сквозные решения» п.1). Правки документов из «Последствий» внесены в apply E01.

### 2. `docs/adr/0006-rate-limit-by-user.md`
Строку статуса заменить на:
> Статус: принято (Ivan, 2026-11-05). Предложено: 2026-11-05 (architect, режим roadmap; ROADMAP «Сквозные решения» п.2). Правки документов из «Последствий» внесены в apply E01.

### 3. `docs/adr/0009-api-catalog-pending.md`
Статус «предложено» → «принято (Ivan, <дата утверждения design.md E01>)». Файл уже создан этим design.

### 4. `docs/ARCHITECTURE.md`
4.1. Шапка: «версия 0.5 от 2026-11-05» → «версия 0.6 от <дата apply>»; в «История» добавить строку:
> - v0.6, <дата apply> — apply E01: ADR-0005 (A30, §7.2, §7.4, §13.1) и ADR-0006 (A21) приняты Ivan 2026-11-05; ADR-0009; закрыты F2-Q9, F2-Q10, F2-Q12.

4.2. §3.4, строку A21 заменить на:
> | A21 | Rate limit: REST — `@fastify/rate-limit` по IP для гостя и по User для Session (П1 и Игрок). Регистрирует `platform` (`global: false`, `hook: "preHandler"`): лимит у каждого маршрута `/api/*` ставит `registerRoute`, ту же настройку `platform` отдаёт для `/auth/*` и WebSocket-upgrade; ключ — `keyGenerator` по `request.caller`: `user:<user_id>` или `ip:<ip>`; `platform` не зависит от `auth` (ADR-0006). WebSocket-upgrade входит в лимит REST; сообщения внутри WebSocket — token bucket в `realtime` на соединение; на User вместо token bucket — лимит открытых соединений. Набор и значения лимитов — F3 §9 | ТЗ §5; ревью r1; текст — reopen (F3 §9, F3-Q3); регистрация и ключ — ADR-0006 (F2-Q9), принят Ivan 2026-11-05 | Лимит в Caddy — не видит User и сообщения WebSocket; хук лимита в `auth` — `platform` зависел бы от `auth` или лимит по User — от порядка регистрации плагинов |

4.3. §3.2, в конец таблицы добавить строку:
> | A30 | Сборка процесса `app` (ADR-0005): корень сборки `apps/server/src/app.ts` — `buildApp(config, deps)`; сервис модуля — фабрика `createXService(deps)`, состояние — в её замыкании; из чужого модуля импортируются только `service.ts` и `events.ts`; типы таблиц — `src/<модуль>/tables.ts`, общий `Database` — `src/database.ts`; «Кто» — `Caller` из `platform/http.ts`, его ставит хук `platform` через резолвер, переданный из `app.ts`; WebSocket-обработчики модулей `app.ts` передаёт в `realtime.registerHandlers`. `Game`, `Challenge`, `Seek` — только типы протокола; строка БД — `<Имя>Table`, доменные объекты — по роли (`ClockState`, `GameRoom`) | ревью r3 (F2-Q10, F2-Q12; API F4-Q6); ADR-0005, принят Ivan 2026-11-05 | Синглтоны модулей — два `buildApp` в одном процессе тестов делят состояние (F6 §7.3); DI-контейнер — лишняя зависимость ради ≈ 12 модулей |

4.4. §7.2, блок кода заменить на:
```
api.ts      — registerXApi(app, svc): маршруты Fastify через registerRoute; xWsHandlers(svc): обработчики сообщений WebSocket
service.ts  — интерфейс XService и фабрика createXService(deps); публичный интерфейс для других модулей
events.ts   — типы событий и createXEvents() (если есть), 7.3
domain/     — чистая логика без ввода-вывода (часы, Glicko-2, окно подбора)
repo.ts     — запросы Kysely к таблицам своего модуля
tables.ts   — только типы строк своих таблиц: XTables (имя таблицы → интерфейс строки)
```
и после первого пункта списка добавить:
> - MUST (ADR-0005): `createXService(deps)` получает в `deps` только `db`, `time`, `config`, сервисы `platform`/`analytics` и сервисы модулей из таблицы 7.1; состояние модуля (реестры, очереди, кэши, издатель событий) — в замыкании фабрики. MUST NOT: синглтоны и изменяемое состояние на уровне файла. Фабрики вызывает только `apps/server/src/app.ts` по слоям L0 → L6; `start()`/`stop()` сервиса — в `onReady`/`onClose` Fastify.

4.5. §7.4, первый пункт дополнить после «`apps/web` не импортирует `apps/server`»:
> ; из чужого модуля — только `service.ts` и `events.ts` (не `api.ts`, `repo.ts`, `tables.ts`, `domain/**`); `app.ts`, `main.ts`, `database.ts` — вне правил модулей (ADR-0005 п.1, п.4)

второй пункт дополнить в конце:
> ; вызов `create<Модуль>Service(` чужого модуля в `apps/server/src/<модуль>/` — ошибка (фабрики зовёт только `app.ts`, ADR-0005 п.4)

4.6. §13.1, в блок кода после строки `src/app.ts` добавить:
```
  src/database.ts            Database — пересечение XTables всех модулей (ADR-0005 п.5)
  src/platform/              config, db (Db, Trx, withTransaction, migrateToLatest), time, http (Caller, registerRoute), ws (типы), errors (AppError)
```
строку `src/<модуль>/` заменить на:
```
  src/<модуль>/              api.ts, service.ts, events.ts, domain/, repo.ts, tables.ts (7.2)
```
после строки `scripts/seed.ts` добавить:
```
  scripts/prepare-db.ts      создать базу из DATABASE_URL и применить миграции (e2e); отказ на prod/staging
```

4.7. §16, в таблицу добавить строки:
> | ADR-0005 | Сборка модулей сервера: `buildApp`, фабрики, межмодульные импорты, `Caller`, WS-обработчики | `docs/adr/0005-server-module-assembly.md` |
> | ADR-0006 | Rate limit по User без зависимости `platform` от `auth` | `docs/adr/0006-rate-limit-by-user.md` |
> | ADR-0009 | Каталог API и код: реализованное и `PENDING_CATALOG` | `docs/adr/0009-api-catalog-pending.md` |

4.8. §17: удалить строки F2-Q9, F2-Q10, F2-Q12; в «Закрыты» добавить:
> - F2-Q9 (rate limit по User) → A21, ADR-0006 (принят Ivan 2026-11-05).
> - F2-Q10 (межмодульные импорты) → 7.4, ADR-0005 п.4; F2-Q12 (сборка модулей, `Database`, имя `Game`) → A30, 7.2, ADR-0005 (принят Ivan 2026-11-05).

### 5. `docs/API_CONVENTIONS.md`
5.1. Шапка: версия → 0.5 от <дата apply>, добавить «apply E01: P34–P35, ADR-0005, ADR-0009; закрыты F4-Q5, F4-Q6». В «Как читать» после «2.5 решения reopen 1R» вставить «, 2.6 решения фич».

5.2. После §2.5 добавить раздел:
> ### 2.6. Решения фич
>
> | № | Решение | Источник | Альтернатива и почему не она |
> |---|---|---|---|
> | P34 | Каталог в коде растёт по эпикам: схемы и `REST_ROUTES` — только реализованные операции; остальные операции и `type` каталога — имена в `PENDING_CATALOG` (`pending.ts`); `ErrorCode` полный всегда. `check-api-doc.sh` сверяет «документ = реализовано ⊔ запланировано» (16) | E01 design (requirements E01, вопрос 2); ADR-0009 | Весь каталог в `REST_ROUTES` сразу — `routes.int` красный до последнего эпика, схемы партии пишутся до её проектирования; сверять только реализованное — документ и код расходятся незаметно |
> | P35 | Ошибки разбора тела: > 16 КБ — `413 payload_too_large`; не `application/json` (кроме Feedback) — `400 validation_failed` с `rule: "content_type"`; битый JSON — `400 validation_failed` с `rule: "json"`; `details.issues[].rule` — `max`, `min`, `unknown_key`, `type`, `enum`, `format`, `invalid` (3, 5.1) | E01 design (requirements E01, вопрос 3) | `415` для любого типа тела — второй смысл кода, который сейчас значит только «скриншот не того формата» |

5.3. §3, после пункта «MUST: POST без тела допустим…» добавить:
> - Тело > 16 КБ — `413 payload_too_large`; тело не `application/json` (кроме Feedback) — `400 validation_failed`, `details.issues: [{"path": "", "rule": "content_type"}]`; битый JSON — то же с `rule: "json"` (P35).

5.4. §5.1, пункт про `details` дополнить:
> Значения `rule`: `max`, `min`, `unknown_key` (путь — сам лишний ключ), `type`, `enum`, `format`, `content_type`, `json`, `invalid` (прочее) (P35).

5.5. §15, в таблицу раскладки после строки `rest/routes.ts` добавить:
> | `pending.ts` | `PENDING_CATALOG` — операции раздела 12 и `type` разделов 9.1, 9.3, 13, которые есть в документе, но ещё не реализованы (P34, ADR-0009) |

5.6. §15, в абзаце «Имена» заменить «доменный объект — по ARCHITECTURE F2-Q12» на «доменный объект — по роли (ARCHITECTURE A30, ADR-0005 п.6)».

5.7. §15, шаг 3 заменить на:
> 3. Запись в `REST_ROUTES` и удаление операции из `PENDING_CATALOG`; новый код — в `errors.ts` и 5.2.

шаг 4 заменить на:
> 4. Обработчик — в `apps/server/src/<модуль>/api.ts`, функция `registerXApi(app, svc)`, через `registerRoute(app, REST_ROUTES.<операция>, handler, opts?)` из `platform`: он проверяет `Origin`, версию, «Кто», схемы и переводит `AppError` в статус; `opts` — особый лимит (Feedback), `checkProtocolVersion: false`. `registerXApi` вызывает `app.ts`. Клиент — `api.call("<операция>", …)` из `apps/web/src/shared/api`.

абзац «Добавить сообщение WebSocket» заменить на:
> Добавить сообщение WebSocket: строка в раздел 13 (и 9.1/9.3 для партии) → схема в `ws/client.ts` или `ws/server.ts`, удаление `type` из `PENDING_CATALOG` → обработчик команды в `xWsHandlers(svc): WsHandlers` в `api.ts` модуля; `app.ts` передаёт его в `realtime.registerHandlers` (ADR-0005 п.8) → шаг 5.

5.8. §16, строку «Каталог 12, коды 5.2, типы 13 = код» заменить на:
> | Каталог 12, коды 5.2, типы 9.1, 9.3, 13 = код | `scripts/check-api-doc.sh`: выписывает из разделов 5.2, 9.1, 9.3, 12, 13 коды, операции (с методом и путём) и `type` и сравнивает с `npm run -w packages/protocol dump`: коды = `ErrorCode`; операции и `type` документа = реализованные (`REST_ROUTES`, `ClientMessage`, `ServerMessage`) ⊔ `PENDING_CATALOG` — каждое имя ровно в одном месте, лишних нет; у реализованных совпадают метод и путь. Строки 13 со ссылкой на 9.1/9.3 (`game.*`) раскрываются по этим разделам (P34) |

5.9. §17.1: удалить строки F4-Q5, F4-Q6; под таблицей добавить:
> Закрыты в apply E01: F4-Q5 → сигнатуры скелета (`design.md` E01, «Сигнатуры скелета»; код `apps/server/src/platform/`), 15; F4-Q6 → ADR-0005 п.7–8 (`Caller`, `CallerResolver`, `realtime.registerHandlers` из `app.ts`).

### 6. `docs/SECURITY.md`
§9, первый абзац: предложение «Кто регистрирует лимит по User — ARCHITECTURE F2-Q9.» заменить на:
> Кто регистрирует лимит и как считается ключ — ADR-0006: `platform`, `keyGenerator` по `request.caller` (`user:<user_id>` у Session, иначе `ip:<ip>`).

### 7. `docs/TESTING.md`
Отдельный проект Vitest для `apps/web` (jsdom), профиль: «проект Vitest с jsdom для `apps/web/**`».
7.1. §5, строка `unit`, колонка «Проект Vitest / инструмент»: `unit` → «`unit`; `apps/web` — `web` (jsdom)».
7.2. §6, строка `npm run test:unit`: `vitest run --project unit` → `vitest run --project unit --project web`; строка `npm test`: «все три проекта» → «все проекты (`unit`, `web`, `int`, `contract`)».
7.3. §6, пункт «Проекты Vitest»: после «`apps/server/test/acceptance/**`;» вставить «`web` — `apps/web/**/*.test.{ts,tsx}`, окружение jsdom (в `unit` их нет);».

### 8. `docs/DESIGN_SYSTEM.md`
8.1. Шапка: версия → 0.5 от <дата apply>, «apply E01: U41–U42».
8.2. §2.6, строку U31, колонку «Решение» заменить на:
> Название — «Chezz» (ключ `app.name`, одинаков в RU и EN). Знак — силуэт шахматного коня на подставке: компонент `Logo` в `shared/ui` — конь в дуге C (свой SVG `logo-knight.svg`, `fill: currentColor`, цвет `--color-accent`); `favicon.svg` — тот же конь без дуги (U42); иконка Open Graph по умолчанию — знак `Logo`. Фирменные цвета — токены разделов 4–5

8.3. В конец §2.7 добавить строки:
> | U41 | Начертания и межстрочный интервал — токены `--font-weight-regular` 400, `--font-weight-strong` 600 (название, подписи кнопок и вкладок), `--font-line-height` 1.4 (раздел 4) | E01 design (design-spec E01, вопрос 3; макеты Figma) | Числа в модулях — правило раздела 1 их разрешает, но вес «жирного» разойдётся между компонентами |
> | U42 | `favicon.svg` — знак без дуги (компонент Figma `favicon`); `currentColor` во вкладке не работает, поэтому цвет — значения `--color-accent` светлой и тёмной темы через `@media (prefers-color-scheme: dark)` внутри SVG; совпадение с `tokens.css` проверяет тест (раздел 17) | E01 design (design-spec E01, «Указания для T-5»; выбор знака — Ivan, 2026-11-06) | Один цвет без медиа-запроса — синий 600 на тёмной вкладке плохо виден; PNG — лишние файлы и размеры |

8.4. §2.7, строку U39: «Vitest + jsdom, проект `unit`» → «Vitest + jsdom, проект `web`».
8.5. §4, после строки «Размеры шрифта» добавить строку:
> | Начертание и интервал | `--font-weight-regular 400`, `--font-weight-strong 600`, `--font-line-height 1.4` (U41) |

8.6. §17, первая фраза: «проект `unit`» → «проект `web`»; в таблицу после строки «Контраст пар раздела 5» добавить:
> | Цвета `favicon.svg` = `--color-accent` тем (U42) | тест `apps/web/src/shared/ui/favicon.test.ts`: значения `--color-accent` светлой и тёмной темы из `tokens.css` (как в `contrast.test.ts`) совпадают с цветами в `apps/web/public/favicon.svg` |

### 9. `docs/OPERATIONS.md` — **не внесено — решение Ivan** (2026-11-06: `CODEOWNERS` пишет Ivan сам, исключение не вводится, OPERATIONS не меняется; номер O46 не занят). Текст ниже — только история предложения.
9.1. §1, пункт «MUST NOT: литерал `example.com` и логин владельца…» заменить на:
> - MUST NOT: литерал `example.com` и логин владельца в `.github/**`, `deploy/**`, `scripts/**` — проверяет `scripts/check-architecture.sh` (раздел 8). Исключение — `.github/CODEOWNERS`: без логина владельца он не работает (16.1 п.2, O46).

9.2. §3.2, в конец таблицы:
> | O46 | В `.github/CODEOWNERS` — логин владельца репозитория (единственное место в `.github/**`, `deploy/**`, `scripts/**`); `check-architecture.sh` пропускает этот файл | E01 design (задача `[ci]`) | `@<owner>`-заглушка — CODEOWNERS не действует; команда-организация вместо логина — у личного репозитория её нет |

### Не меняется
DESIGN §16 (решение Ivan); OPERATIONS (решение Ivan, п.9); `ROADMAP.md`; GLOSSARY; профиль (ссылку на Figma вписывает Ivan).

## Решения (ADR)

| Решение | Альтернативы | Почему |
|---|---|---|
| Каталог API: реализованное в схемах, остальное — `PENDING_CATALOG` (ADR-0009) | весь каталог в `REST_ROUTES` сразу; пометка «реализовано» в таблицах API; `onRoute ⊆ REST_ROUTES` | обе проверки API §16 остаются строгими; схемы пишутся в эпике своей фичи; документ не обрастает служебными колонками |
| `ErrorCode` полный в E01 | коды по эпикам через `PENDING_CATALOG` | перечисление дешёвое; `error.<code>` нужны целиком (DESIGN §11); меньше правок `ErrorCode` в каждом эпике |
| `registerRoute` проверяется int-тестом разработчика на голом Fastify с `platform` и синтетическими `RouteDef` (POST с телом, «Кто» = И) и заглушкой `CallerResolver` | перенос в E04; тестовый маршрут в `buildApp` | правила API §5, §7, SECURITY §6 готовы к E04; в `buildApp` и prod тестового маршрута и «тестового входа» нет (SECURITY §1, TESTING §7.3). `buildApp` резолвер извне не принимает |
| Проверки в `registerRoute` — внутри обёртки обработчика, после `preHandler` лимита; zod — не через схему Fastify | схемы Fastify (`preValidation`) | отказы `origin_forbidden`, `client_outdated`, `validation_failed` тоже считаются в лимит; одна библиотека схем (zod, API §1) |
| Логирование (pino, `request_id`, путь без строки запроса, `redact`) — в T-2 | T-4; E03 | первый лог `app` появляется в T-2; маскировка `/challenge/<id>` — E03 (ROADMAP), до E03 таких маршрутов нет |
| `/api/*` без маршрута — `404 not_found` в формате §5 с rate limit; SPA-фолбэк — в `setNotFoundHandler`, а не маршрут `/*` | маршрут-шаблон `GET /*` | маршрут-шаблон перехватил бы `/api/<нет>` и попал бы в `onRoute`; 404 не обходит лимит |
| Раздача SPA — в `app.ts` (`@fastify/static`), не в модуле | `platform`; `seo` | `app.ts` — корень сборки и не модуль (ADR-0005 п.1); `platform` по 7.1 статикой не занимается; `seo` появится в E15 и дополнит `index.html` |
| Недоступность БД в contract-тестах — `startApp().database.block()` (`ALTER DATABASE … ALLOW_CONNECTIONS false` + разрыв соединений) | неверный `DATABASE_URL` | `app` с неверной БД не стартует (миграции при старте); EC-9 требует подъёма без перезапуска. `platform/db.ts` ставит обработчик `pool.on("error")` — иначе обрыв простаивающего соединения роняет процесс |
| Сброс окна лимита в E01 не проверяется (только 300/301 и `Retry-After`) | конфиг окна для тестов; часы плагина через `TimeSource` | `@fastify/rate-limit` считает время сам; переключатель окна ради теста — лишняя ручка конфига; сброс — поведение библиотеки |
| TS: `erasableSyntaxOnly`, `verbatimModuleSyntax`, `module`/`moduleResolution` `nodenext`, относительные импорты с `.ts` (`rewriteRelativeImportExtensions`); пакеты экспортируют `src/*.ts` | сборка `tsc` в `dist` для Node | `node file.ts` (TESTING §6) работает для `main.ts`, `seed.ts`, `prepare-db.ts` без сборки; запрещённый синтаксис ловит `tsc -b`, а не падение сида в e2e |
| Проект Vitest `web` (jsdom) отдельно от `unit` | комментарий `@vitest-environment jsdom` в каждом файле; `environmentMatchGlobs` | профиль требует проект с jsdom; комментарий легко забыть; `environmentMatchGlobs` устарел в Vitest 3 |
| `.gitattributes` (`* text=auto eol=lf`, `*.sh text eol=lf`, `*.png binary`) — в T-2 | `core.autocrlf=false` у каждого клона | EC-26: `\r` в `scripts/*.sh` ломает Git Bash и CI; правило в репозитории, а не на машине. Файла нет в зоне `backend` — «Открытые вопросы», п.1 |
| Правило «адреса только из `PAGES`» в `check-architecture.sh` — в T-5 (`apps/web/src`, `apps/server/src/seo`; нет пути — пропуск) | T-2; T-3 | правило фронта и его проверка — у frontend (зона, TESTING §11); в T-2 нет `apps/web`, а `check-architecture.sh` не в зоне contracts |
| Без `--layout-text-max`: ширину строки заглушки ограничивают поля `--space-4` | новый токен | design-spec п.5 допускает строку в одну линию на 1280; токен ради временной заглушки не нужен |
| Начертания — токены `--font-weight-*`, `--font-line-height` (U41) | числа в модулях | один источник значений для `Logo` сейчас и кнопок в E04 |
| Роутер SPA — не в E01 | `react-router` сейчас | в E01 один экран; выбор (свой маленький или библиотека, бюджет 300 КБ) — `design.md` E04 (`/welcome`) |

## Выкатка и откат

- В E01 ничего не выкатывается: `deploy.yml` нет (E02), `deploy-staging` до первой выкатки prod запрещён (O40). Ручных проверок staging нет.
- Порядок: T-1…T-6 в одной ветке `feature/e01-skeleton`; `.github/workflows/ci.yml` (T-6) Ivan коммитит и пушит сам; перед `git push` коммитов с `deploy/compose.test.yml` и `.github/` — показ diff Ivan (O36). CI на PR заработает после push Ivan.
- До мержа: ruleset `main` и обязательные проверки (OPERATIONS §16.1) — Ivan, до первой выкатки, не условие E01.
- Новые переменные окружения (имена): `APP_ENV` (новое значение по умолчанию `dev`), `APP_ORIGIN`, `DATABASE_URL`, `HOST`, `PORT`, `RATE_LIMIT_IP_PER_MIN`, `WEB_DIST_DIR`, `LOG_LEVEL`, `TEST_DATABASE_URL`. Секретов нет. В `env.allowlist` и OPERATIONS §7 их вносит E02 (там появляются `HOST=0.0.0.0` в контейнере и адрес `edge` для `trustProxy`).
- Откат — revert PR. Данных нет, миграций нет.

## План задач

Шаг 3 «Проверки» каждой задачи — её «проверка» из профиля; `tester-untouched` — всегда. Шаг tester — только у T-4 и T-5.

### T-1 [infra] Риск: high
`deploy/compose.test.yml` — сервис `db-test` строго по OPERATIONS §6.4 и TESTING §7.1 (`postgres:18`, `127.0.0.1:54329:5432`, `chezz`/`chezz`, `tmpfs: /var/lib/postgresql`, `fsync=off`, `synchronous_commit=off`, `full_page_writes=off`, healthcheck `pg_isready`). Риск high — путь `deploy/` (diff O36).
- Проверка: `docker compose -f deploy/compose.test.yml config -q && docker compose -f deploy/compose.test.yml up -d --wait`.
- AC-1, AC-2; EC-1 (повторный `up -d --wait` — код 0, контейнер один).

### T-2 [backend:platform] Риск: high
Корень и сервер без маршрутов. Риск high: основа всех эпиков, `redact` логов (SECURITY §15), отказ сида на prod, правила границ.
- Корень: `package.json` (`"private": true`, `workspaces: ["apps/*", "packages/*"]`, `"license": "GPL-3.0-or-later"`, `engines.node: ">=24 <25"`, скрипты TESTING §6 — `test:unit` с `--project unit` (проект `web` добавит T-5), devDependency `@playwright/test`, `typescript`, `vitest`, `eslint` с плагинами `vitest`, `playwright`, `react`, `stylelint`, `dependency-cruiser`), `package-lock.json`, `tsconfig.base.json` (общие опции из «Решений»), `tsconfig.json` (ссылки только на `apps/server`), `vitest.config.ts` (проекты `unit`, `int`, `contract` по TESTING §6; `int`, `contract` — `globalSetup`, `pool: "forks"`, `maxWorkers: 2`; `passWithNoTests: true`; `retries` нет), `eslint.config.js` (правила TESTING §11, запрет `innerHTML` — `no-restricted-properties`/`no-restricted-syntax`), `.dependency-cruiser.cjs` (таблица 7.1 для всех 12 модулей, правило импортов ADR-0005 п.4, `api` → свой `repo`, `domain` → `kysely`/`pg`/`fastify`/`ws`, `apps/web` → `apps/server`; `app.ts`, `main.ts`, `database.ts` вне правил модулей), `.nvmrc` (`24`), `.gitignore` (`node_modules/`, `dist/`, `.env*` кроме `!.env.example`, `test-results/`, `playwright-report/`, `tests/e2e/screens/`), `.gitattributes` (если Ivan добавит зону — «Открытые вопросы», п.1), `.env.example` (имена из «Выкатка и откат» с безопасными локальными значениями, без секретов), `LICENSE` (полный GPL-3.0), `README.md` (команды TESTING §6, Windows — Git Bash), `scripts/check-architecture.sh` (правила ARCHITECTURE §7.4 с дополнением «`create<Модуль>Service(` чужого модуля»; `example.com` в `.github`, `deploy`, `scripts` с исключением самого скрипта; несуществующие пути — пропуск; сообщение называет файл и правило), `scripts/check-bundle.sh` (каркас: нет `apps/web/dist` — код 2 «сначала сборка»; порог и подсчёт доделывает T-5).
- `check` = `tsc -b` + ESLint + Stylelint (`--allow-empty-input`) + `depcruise` + `bash scripts/check-architecture.sh` (без `check-api-doc.sh`).
- `apps/server`: `package.json` (`@chezz/server`, `fastify`, `pino`, `kysely`, `pg`, `zod`), `tsconfig.json`, `src/main.ts` (конфиг → пул → `migrateToLatest` → `buildApp` → `listen`; SIGTERM/SIGINT → `close`), `src/app.ts` (`buildApp`: Fastify с `genReqId: randomUUID`, `requestIdHeader: false`, заголовок ответа `X-Request-Id`, логгер с сериализаторами SECURITY §15 и `redact`, хук `onRequest` с `request.caller` от резолвера «всегда гость», `migrateToLatest` в `onReady`), `src/database.ts` (пустой `Database`), `src/platform/` (`config.ts`, `db.ts` с `pool.on("error")`, `time.ts`, `http.ts` — `Caller`, `CallerResolver`, `alwaysGuest`; `ws.ts` — типы), `migrations/` (пустая, `.gitkeep`), `scripts/seed.ts` (`--demo`: ничего не пишет; `APP_ENV=prod` → код 1 до подключения), `scripts/prepare-db.ts` (см. «Публичные интерфейсы»), `test/support/` (`app.ts` — `startApp`, `time.ts` — `ManualTimeSource`, `db.ts` — `globalSetup`: `chezz_template` + миграции, база воркера `chezz_test_<VITEST_POOL_ID>` из шаблона, повторный прогон пересоздаёт базу воркера; `setup.ts` — `TRUNCATE` всех таблиц кроме миграций перед каждым файлом).
- Тесты разработчика: `ManualTimeSource` (EC-4), два `startApp` параллельно (EC-3), гость с cookie (EC-5), строка лога (AC-15, EC-7 «лог», EC-8 — запросом к несуществующему пути), сид (`--demo` и отказ на prod), `globalSetup` дважды.
- Проверка: `npm run check`.
- AC-3…AC-15 (AC-15 — здесь, решение п.7 requirements); EC-2, EC-3, EC-4, EC-5, EC-7 (лог), EC-8, EC-14, EC-15, EC-26 (при `.gitattributes`), EC-27. Доп. AC-7a: вызов `createUsersService(` в `apps/server/src/games/` → `check-architecture.sh` красный (самопроверка).

### T-3 [contracts] Риск: low
- `packages/protocol` (`@chezz/protocol`, `zod` 4): `version.ts` (`PROTOCOL_VERSION = 1`), `errors.ts` (`ErrorCode` — все коды обеих таблиц API §5.2), `common.ts` (`ErrorResponse`, `Category`), `rest/health.ts` (`GetHealthResponse`), `rest/routes.ts` (`RouteDef`, `Who`, `REST_ROUTES` = `getHealth`), `ws/client.ts`, `ws/server.ts` (пустые `ClientMessage`, `ServerMessage` — форма на выбор разработчика, `dump` даёт `[]`), `pending.ts` (`PENDING_CATALOG` — все операции §12, кроме `getHealth`; все `type` §9.1, §9.3, §13), `pages.ts` (`PAGES`), `mask.ts` (`maskChallengeIds`), `index.ts`, `snapshot/protocol.json`, скрипты `dump` и `snapshot` (перезапись снимка). Тесты рядом: `schemas.test.ts`, `snapshot.test.ts`, `pages.test.ts`, `mask.test.ts`.
- `packages/chess` (`@chezz/chess`): `package.json` с `chess.js`, `tsconfig.json`, `src/index.ts` с `export {}`; папки `test/` нет.
- `scripts/check-api-doc.sh` по API §16 в редакции «Изменений документов основ» п.5.8 (JSON `dump` разбирает `node`, без `jq`).
- Корень: ссылки `tsconfig.json` на `packages/protocol`, `packages/chess`; `check-api-doc.sh` в `check`; `package-lock.json`.
- Проверка: `npm run check` (полный).
- AC-16…AC-23; EC-13, EC-16, EC-17. Уточнение AC-17: красный также при имени и в `REST_ROUTES`, и в `PENDING_CATALOG`, и при несовпадении метода или пути. AC-18: при нуле входящих схем тест проходит и проверяет `REST_ROUTES` и `ClientMessage` по мере появления.

### T-4 [backend:platform] Риск: high
Шлюз всех REST: `Origin`, «Кто», лимит. Риск high — от него зависят CSRF и права во всех эпиках (SECURITY §6, §7, §9).
- `platform/errors.ts` (`AppError`, статусы §5.2, обработчик ошибок и `setNotFoundHandler` по «Перевод ошибок»), `platform/http.ts` (`registerRoute`, `apiRateLimit`), регистрация `@fastify/rate-limit` (ADR-0006 п.1–2: `global: false`, `hook: "preHandler"`, `keyGenerator`, тело 429 по API §5.1, `Retry-After`), `bodyLimit: 16384`, `Cache-Control: no-store` на `/api`; модуль-маршрут `getHealth` (в `platform/health.ts` — `SELECT 1` с таймаутом 2 с; регистрирует `app.ts`, `checkProtocolVersion: false`); раздача SPA в `app.ts` (`@fastify/static`, кэш по «Публичным интерфейсам»).
- Тесты разработчика: `src/platform/routes.int.test.ts` (маршруты `/api/*` кроме `HEAD` = `REST_ROUTES` по методу и пути; нет `DELETE`; нет `/api/v1`), `src/platform/cors.int.test.ts` (EC-11; нет `@fastify/cors` в корневом и всех `apps/*`, `packages/*` `package.json`), `src/platform/register-route.int.test.ts` (AC-30 на голом Fastify с синтетическими `RouteDef` и заглушкой `CallerResolver`; плюс 16 КБ, `content_type`, `json`), unit ключа лимита (AC-25), int «у каждого `/api/*` есть `config.rateLimit`» (AC-27).
- Шаг tester (режим 1): `apps/server/test/contract/platform/health.test.ts` (AC-24, EC-9, EC-10), `apps/server/test/contract/platform/rate-limit.test.ts` (AC-26, EC-6, EC-7, EC-12); импорт только `test/support/**` и `@chezz/protocol`.
- Проверка: `npm run check`.
- AC-24…AC-30; EC-6, EC-7, EC-9…EC-12.

### T-5 [frontend] Риск: low
Макет: `lobby / 360 / light / default` https://www.figma.com/design/z6VyHSdwqFzCQIdP7ScisI?node-id=5-266, `lobby / 1280 / light / default` …?node-id=5-276 (тёмные — 5-286, 5-296); знаки — `27:108` (`logo-knight.svg`), `27:217` (`favicon.svg`); указания — design-spec «Указания для T-5». Начинать после apply (токены U41, U42).
- `apps/web` (`@chezz/web`): Vite + React, `index.html` (без inline-скриптов, `title`, favicon), `vite.config.ts` (прокси `/api`, `/auth`, `/ws` с `ws: true` → `http://127.0.0.1:3000`), `.stylelintrc.json` по DESIGN §17, `src/shared/ui/tokens.css` (все токены §4, §5, §6, §7.1 + U41; темы по §5), `src/shared/ui/Logo/`, `src/shared/ui/Badge/`, `src/shared/i18n/` (выбор языка, `lang`), экран `lobby` (`src/pages/lobby/`), `public/favicon.svg`, `src/shared/ui/logo-knight.svg`; тесты `contrast.test.ts`, `favicon.test.ts`, выбор языка (EC-20).
- `packages/i18n` (`@chezz/i18n`): `src/ru.json`, `src/en.json` (ключи из «Публичных интерфейсов» + `error.<code>` на каждый `ErrorCode` + `error.network`, `error.unknown`, `error.engine_failed`), `src/index.ts` (`Locale`, `LOCALES`, `createT(locale, {onMissing: "throw" | "key"})` с `{name}` и `Intl.PluralRules`), тест ключей (EC-18, EC-19, `app.name`).
- `scripts/check-architecture.sh`: правила DESIGN §17 (`style={{…}}`, `--base-*` вне `tokens.css`) и API §16 «адреса из `PAGES`» (`apps/web/src`, `apps/server/src/seo`). `scripts/check-bundle.sh`: gzip JS и CSS из `dist/index.html` (`script`, `link rel=stylesheet|modulepreload`) ≤ 307200 байт.
- Корень: ссылки `tsconfig.json` на `apps/web`, `packages/i18n`, `tests/e2e`; проект Vitest `web` (jsdom) и `test:unit` с `--project web`; ESLint React (`react/no-danger`); Stylelint без `--allow-empty-input`.
- Шаг tester (режим 1, до разработчика): `tests/e2e/playwright.config.ts` (проекты TESTING §9, `webServer` по «Публичным интерфейсам», EC-23), `tests/e2e/tsconfig.json`, `tests/e2e/support/open-screen.ts`, `tests/e2e/smoke.spec.ts` (`@smoke`, AC-44), `tests/e2e/lobby.spec.ts` (AC-35…AC-39), `tests/e2e/screens.spec.ts` (AC-45, PNG в `tests/e2e/screens/`). Готовность шага: `tester-lint` и `npx tsc -p tests/e2e/tsconfig.json --noEmit` (ссылку на `tests/e2e` в корень добавляет разработчик этой же задачи); прогон e2e — в T-7.
- Проверка: `npm run check`; ручная — AC-41.
- AC-31…AC-45; EC-18…EC-23, EC-28, EC-29.

### T-6 [ci] Риск: high
- `.github/workflows/ci.yml` по TESTING §12, OPERATIONS §8: job `check` (`services: postgres:18` на 54329, `TEST_DATABASE_URL`; `npm ci` → `npm run check` → `gitleaks git --log-opts="<base>..HEAD"` (база: `pull_request.base.sha` / `before`; `fetch-depth: 0`) → `npm audit --omit=dev --audit-level=high` (`continue-on-error: true`) → `test:unit` → `test:int` → `test:contract`; `timeout-minutes: 15`); job `e2e` (первый шаг — `git diff --name-only origin/main...HEAD`, только `docs/**` → остальные шаги пропущены, job зелёный; `services:` как в `check`; `npm ci` → кэш и `npx playwright install --with-deps chromium` → `npm run build -w @chezz/web` → `bash scripts/check-bundle.sh` → `npm run test:e2e -- --project=desktop --project=mobile-360` → `actions/upload-artifact` `screens`, путь `tests/e2e/screens/**`, `if: always()`, без trace; `timeout-minutes: 20`). Actions — полный SHA с комментарием версии; `persist-credentials: false`; кэш npm (`setup-node` `cache: npm`, `node-version-file: .nvmrc`) и браузеров.
- `.github/CODEOWNERS` агент **не пишет** — кладёт Ivan сам (решение 2026-11-06, «Открытые вопросы», п.2). Ни `check-workflows.sh`, ни `check-architecture.sh`, ни `ci.yml` не требуют этого файла и не читают его: до появления файла и после все проверки зелёные.
- `.github/dependabot.yml` (`npm` `/`, `github-actions` `/`, `docker` `/deploy`, `weekly`), `scripts/check-workflows.sh` (OPERATIONS §8: триггеры `ci.yml`; `deploy.yml`/`load.yml` — только `workflow_dispatch`, если есть; нет `pull_request_target`, `workflow_run`; `permissions` не шире `contents: read` у `ci.yml`), вызов `check-workflows.sh` в `check` — через корневой `package.json` нельзя (не зона devops) → вызов из `ci.yml` шагом после `npm run check`.
- Проверка: `npm run check`; `bash scripts/check-workflows.sh`.
- AC-46…AC-49; AC-50 — часть `dependabot.yml`; часть `CODEOWNERS` AC-50 закрывает Ivan своим файлом (ревью при коммите T-6, перечень путей — AC-50, OPERATIONS §16.1 п.2); EC-24, EC-25. Текст `.github/workflows/**` агент готовит, коммитит и пушит Ivan.

### T-7 [e2e] Риск: low
Прогон: `npm run db:test:up` → `npx playwright install chromium` (один раз) → `npm run test:e2e -- --project=desktop --project=mobile-360`. Красный — разработчику T-5 с отчётом; спор — arbiter.
- AC-51 (локальная часть; CI-часть — после push Ivan).

## Риски и открытые вопросы

Открытые вопросы к Ivan:
1. **`.gitattributes` вне зон.** `zones.conf` не даёт его ни одной роли. Предложение: строка `backend allow .gitattributes` (зона `setup-pipeline`, правит Ivan) до T-2. Без неё T-2 идёт без файла, EC-26 не закрыт, и на клоне с `core.autocrlf=true` `scripts/*.sh` могут падать в Git Bash.
2. ~~**CODEOWNERS и запрет логина (OPERATIONS §1).**~~ Закрыт решением Ivan 2026-11-06: `.github/CODEOWNERS` Ivan пишет сам при коммите T-6; исключение в OPERATIONS не вводится, OPERATIONS не меняется («Изменения документов основ», п.9 — не внесён). T-6 файл не создаёт, проверки от него не зависят.
3. **Ссылка на Figma в профиле** (`file: —`) — вписать `https://www.figma.com/design/z6VyHSdwqFzCQIdP7ScisI` до T-5; старый файл `gnC4bJJ1JlSgRH3q0mNLFx` — удалить или пометить (design-spec п.13).
4. **Отдельный проект Vitest `web`** меняет команду `test:unit` в TESTING §6 и DESIGN U39 («Изменения», п.7, п.8.4). Если Ivan против правки документов — вариант без правки: комментарий `@vitest-environment jsdom` в каждом тесте `apps/web` в проекте `unit`.

Отложено (E01 не блокирует):
- Вопросы designer: п.4 (hover/active/disabled для `secondary`/`danger`/`ghost`, hover полей), п.6 (размеры `Avatar` 24/32/64), п.14 (`Button size=l` во всех состояниях) — E04 (первые кнопки, `shell`, аватар), правка DESIGN §7, §7.1 в design E04; п.15 (многострочное поле) — E18; п.10 (`GameSummary` в §7), п.11 (флаг страны) — E11; п.16 (тема «как в системе») — API F4-Q8, Ivan, до E16; п.9 (доменные компоненты — в эпиках экранов) — согласен.
- Вопрос designer п.17 (иконки) закрыт документами: `lucide-react` (DESIGN U5, ARCHITECTURE §4.2), SVG в бандле, CSP `self` не задет.
- Вопрос designer п.5 (`--layout-text-max`) — не вводится (раздел «Решения»).
- `trustProxy` с адресом `edge` и `HOST=0.0.0.0` в контейнере — E02; маскировка путей в логах и Sentry — E03.
- ADR-0007, ADR-0008 — статус «предложено»; их строки в ARCHITECTURE §16 — в apply эпиков E04/E08.

Риски:
- **T-2 большая** (корень + сервер + тестовая инфраструктура). Если не укладывается в сессию — оркестратор делит на T-2a (корень, конфиги, проверки) и T-2b (`apps/server`, `test/support`) одной меткой подряд; состав профиля не меняется.
- **`node file.ts` и workspace-пакеты.** Node не снимает типы в `node_modules`; работает, пока симлинки workspace разрешаются в реальные пути (`--preserve-symlinks` не включать). Если проверка в T-3 покажет иное — открытый вопрос к architect, не обход.
- **Шаг tester T-5 без `apps/web`.** e2e-тесты пишутся до приложения и до ссылки `tests/e2e` в корневом `tsconfig`; их первый прогон — T-7. Падение `webServer` в T-5 — ожидаемо, не дефект шага tester.
- **gitleaks в CI** — бинарник или action; `gitleaks-action` для организаций требует лицензию (у личного репозитория — нет). Выбор — devops в T-6 с SHA.
