# E01: Скелет репозитория

История: E01 v0.3, утверждено Ivan 2026-11-07 — правки AC-10, AC-25, AC-42 по `design.md`, «Изменения документов основ (v0.3)», п.16–18.

Версия 0.2 · 2026-11-05 · analyst (режим feature). Основа: ROADMAP v0.2 (строка E01, «Пояснения к нарезке»), профиль `.claude/profile.md` («Скелет репозитория (первый эпик) — 7 задач»), ADR-0005, ADR-0006, TESTING §5–§7, §9, §11–§14, API §3, §5, §7, §12.6, §14–§16, ARCHITECTURE §7, §12, §13, SECURITY §6, §9, §15, §17, §18, DESIGN §5, §8–§10, §15–§17, OPERATIONS §6.4, §8, §16.1, §17.

Изменения 0.2 (ответы Ivan): ADR-0005 и ADR-0006 приняты — п.1 «Открытых вопросов» закрыт; главная-заглушка — экран `lobby` с `data-state="default"` без правки DESIGN, экрана `not-found` в E01 нет — п.4 закрыт, AC-35, AC-44, AC-45 и связанные места приведены к решению.

## Цель

Дать конвейеру и Ivan рабочий каркас монорепозитория, на котором любой следующий эпик (E02 «Выкатка», E03 «Наблюдаемость», E04 «Вход») сразу пишет код и тесты по правилам F2–F7: npm workspaces, тестовая PostgreSQL, процесс `app` с `buildApp(config, deps)` и `/api/health`, пакеты `protocol`, `chess` (только каркас), `i18n`, SPA с главной-заглушкой (экран `lobby`), все автоматические проверки `npm run check`, основа e2e и CI (`check`, `e2e`). Пользователи эпика — агенты конвейера (backend-dev, frontend-dev, tester, devops) и Ivan; игрок видит только главную-заглушку «Chezz · Бета» на RU и EN. Для игрока эпик ничего не даёт; его польза в том, что дальше правила F2–F5 проверяет машина, а не ревью (TESTING §11).

## Ограничения (от человека)

- Состав и порядок задач — только профиль, «Скелет репозитория (первый эпик) — 7 задач»; требования не переопределяют, какая задача что создаёт (оркестратор, ROADMAP «Пояснения к нарезке»).
- `packages/chess` — только каркас: `package.json` с chess.js, `tsconfig`, пустой экспорт, подключение в workspace. Обёртка правил, `fixtures/chess/`, `packages/chess/test/` — E06 (ROADMAP «Пояснения к нарезке», E01).
- ADR-0005 (сборка модулей) и ADR-0006 (rate limit по User) приняты Ivan (2026-11-05); статус в файлах ADR обновляет architect (режим apply).
- Главная-заглушка — экран `lobby` (DESIGN §9.2) в состоянии `data-state="default"` с временным составом; DESIGN не правится, новый ID экрана не вводится (Ivan, 2026-11-05). Экрана `not-found` в E01 нет.
- UI — только главная-заглушка. Макеты — новый файл Figma, его создаёт designer (DESIGN §16.4, U34); ссылку в профиль вписывает Ivan.
- Размер L, лимит 50 вызовов агентов (профиль, «Размеры фич»).

## Зависимости (эпики, статус)

| Что | Статус | Влияние |
|---|---|---|
| Эпики | нет (ROADMAP: «Зависит от — —») | — |
| ADR-0005 «Сборка модулей сервера» | принят Ivan (2026-11-05); статус в файле — architect | задачи 2 и 4 реализуют его п.1–2, 4–7, 9 |
| ADR-0006 «Rate limit по User» | принят Ivan (2026-11-05); статус в файле — architect | задача 4 реализует п.1, 2, 4 |
| Файл Figma | нет (профиль, «Макеты»: `file: —`) | designer создаёт; ссылка в профиле — до задачи 5 (PIPELINE_DECISIONS, «вне линзы: файл Figma в скелете») |
| Проверка `infra-up` этапа 0 | не проходит до задачи 2 | пропущена по В4 (лог фичи) |

Блокеров нет.

## Scope

### Входит

По задачам профиля (номер задачи — `T-n`; файлы — профиль, здесь только требования к поведению):

- **T-1 `[infra]`** — `deploy/compose.test.yml`: сервис `db-test` по OPERATIONS §6.4, TESTING §7.1.
- **T-2 `[backend:platform]`** — корневые конфиги и скрипты TESTING §6; `apps/server`: `main.ts`, `app.ts` (`buildApp`), `platform/` (конфиг, `db.ts` с `Db`/`Trx`/`withTransaction`, `time.ts` с `TimeSource`, `http.ts` с `Caller`/`CallerResolver`, `ws.ts` с типами `WsHandlers`/`WsContext`, логирование pino), `database.ts`, `test/support/` (`startApp`, `ManualTimeSource`, `globalSetup` БД), `migrations/` (пусто), `scripts/seed.ts` (режим `--demo` на пустой схеме и отказ на prod); `.dependency-cruiser.cjs` (таблица ARCHITECTURE §7.1 и правило импортов ADR-0005 п.4); `scripts/check-architecture.sh` (правила ARCHITECTURE §7.4 и `example.com` OPERATIONS §8); `scripts/check-bundle.sh`; `LICENSE`, `README.md`, `.env.example`, `.gitignore`, `.nvmrc`.
- **T-3 `[contracts]`** — `packages/protocol` по API §15 (`version.ts`, `common.ts`, `errors.ts`, `rest/`, `ws/`, `pages.ts`, `snapshot/protocol.json`, команда `dump`), `maskChallengeIds` (SECURITY §15), тесты TESTING §11 (`schemas.test.ts`, `snapshot.test.ts`, `pages.test.ts`, тест маскировки); каркас `packages/chess`; `scripts/check-api-doc.sh`. Объём каталога в протоколе — «Открытые вопросы», п.2.
- **T-4 `[backend:platform]`** — `registerRoute`, `getHealth` (`GET /api/health`), rate limit по ADR-0006, `routes.int.test.ts`, `cors.int.test.ts`; шаг tester — contract-тесты `getHealth` и лимита.
- **T-5 `[frontend]`** — `apps/web` (Vite, React, `tokens.css` со всеми токенами DESIGN §4, §5, §7.1, Stylelint, `contrast.test.ts`, главная-заглушка — экран `lobby` в состоянии `default`, прокси Vite), `packages/i18n` (`ru.json`, `en.json`, `t()`, тест ключей); шаг tester — основа e2e (`playwright.config.ts`, `tests/e2e/tsconfig.json`, `openScreen`, `@smoke` главной, `screens.spec.ts` со скриншотами в `tests/e2e/screens/`).
- **T-6 `[ci]`** — `.github/workflows/ci.yml` (job `check`, `e2e`), `CODEOWNERS`, `dependabot.yml`, `scripts/check-workflows.sh`; текст готовит devops, коммитит и пушит Ivan.
- **T-7 `[e2e]`** — прогон e2e задачи 5 в `desktop` и `mobile-360`.
- designer: файл Figma со страницами `00 Tokens`, `01 Components`, `02 Screens`, `99 Archive` и переменными из DESIGN §4–5 (U23); фреймы экрана `lobby` `360 / light / default` и `1280 / light / default` с временным составом заглушки (DESIGN §16.2–16.4). Фреймы остальных состояний `lobby` (матрица DESIGN §10.4) — E09.

Временный состав заглушки (`lobby`, `default`): `Logo` (знак-конь + «Chezz»), `Badge` «Бета», одна строка текста; без навигации, кнопки входа, пресетов и списка вызовов. Ключи строк — по DESIGN §15 (`app.name`, `lobby.<элемент>`).

### Не входит / позже

| Что | Где |
|---|---|
| Обёртка правил `packages/chess`, `fixtures/chess/`, `packages/chess/test/` | E06 (T-1 `[contracts]`) |
| `Dockerfile`, `compose.yml`, Caddy (заголовки CSP, HSTS), `deploy.yml`, `load.yml` | E02 |
| Sentry сервера и клиента, `/metrics` с `app_info{version}`, применение `maskChallengeIds` в pino и Sentry, модуль `analytics` | E03 |
| Таблицы, User, Session, вход Google, `resolveCaller` из `auth`, фабрики `createPlayer`/`createRating`/…, `seedSessionToken`, состав сида `--demo` по TESTING §7.6 | E04 и эпики, вводящие таблицы (ROADMAP «Сквозные решения», п.7) |
| Проверка «два Игрока с одного IP считаются раздельно» через HTTP (ADR-0006 п.4) | E04 (в E01 — unit-тест ключа, AC-25) |
| WebSocket `/ws`, лимит соединений и token bucket | E22 |
| Режим сида `--load`, `tests/load/`, скрипт `npm run load` с работающим генератором | E21 |
| `shell` целиком: навигация, кнопка входа, кнопка «Сообщить об ошибке», подвал с `/terms`, `/privacy` и переключателем языка (U21), `ConnectionBanner` | E04, E16, E18 |
| Полный состав `lobby` по DESIGN §9.2 и его состояния кроме `default` (`loading`, `empty`, `guest`, `active-game`, …, DESIGN §10.4); замена временного состава заглушки | E09 |
| Экран `not-found`: поведение SPA на неизвестных путях в E01 не задаётся и не проверяется | позже (вне E01) |
| Экран `legal` | позже (вне E01) |
| Ruleset `main`, environments, включение обязательных проверок (OPERATIONS §16.1) | Ivan, до первой выкатки |
| Ручной Lighthouse «первая отрисовка ≤ 2,5 с на 4G» | Ivan перед этапом 5 (TESTING §8) |

Вне этапа (BUSINESS §1.7): жалобы, админ-панель, бан, турниры, бот, чат — в E01 ничего из этого нет.

## Сценарии

**С-1. Агент начинает следующую фичу (основной).** Агент на чистом клоне (Windows + Git Bash или ubuntu CI) выполняет `npm ci` → `npm run db:test:up` → `npm run check` → `npm test` → `npm run test:e2e`; всё зелёное (TESTING §6, §12). Новый модуль добавляется строкой в `app.ts` и `database.ts` (ADR-0005, «Последствия»), и его нарушения слоёв ловит `check`.

**С-2. Тест поднимает `app`.** Contract-тест вызывает `startApp()` → получает `{url, wsUrl, time, close()}`; `time` — `ManualTimeSource`; база — `chezz_test_<n>` из шаблона `chezz_template` (TESTING §7.1, §7.3). Два файла тестов в разных воркерах не делят ни БД, ни состояние модулей (ADR-0005 п.2).

**С-3. Проверка живости.** `GET /api/health` → `200 {"status":"ok"}`; при недоступной БД → `503 {"status":"unavailable"}` (API §12.6). Её используют E02 (healthcheck, smoke) и внешний пинг.

**С-4. Гость открывает главную.** Браузер с языком `ru-RU` открывает `/` → экран `lobby` (`data-state="default"`) с заглушкой на RU, `<html lang="ru">`; с `en-US` — на EN; на 360 px без горизонтальной прокрутки; тема — по `prefers-color-scheme` (ТЗ §5 «Локализация», «Адаптивность»; DESIGN §9.2, U8, §15).

**С-5. Нарушение правила ловит машина.** Разработчик пишет `selectFrom` в `service.ts`, импортирует чужой `repo.ts`, ставит `.only` в тесте или цвет `#fff` в `*.module.css` → `npm run check` красный с понятным сообщением (TESTING §11).

**С-6. PR в `main`.** CI запускает `check` и `e2e` параллельно; PR только с `docs/**` — `e2e` зелёный без прогона (TESTING §12, V19); скриншоты 360/1280 — артефакт `screens` (В6).

**С-7. Альтернативный: флуд на API.** Гость шлёт 301-й запрос за минуту к `/api/*` → `429 rate_limited` с `Retry-After` (ТЗ §5 «Безопасность»; SECURITY §9; ADR-0006).

## Edge cases

| # | Ситуация | Ожидаемое поведение | ТЗ / документ |
|---|---|---|---|
| EC-1 | `npm run db:test:up` дважды подряд | оба раза код 0, контейнер один | TESTING §6 «идемпотентна» |
| EC-2 | Проект Vitest без тестов (например, `contract` до шага tester T-4; `test:affected` в T-2) | прогон завершается кодом 0, а не «No test files found» | профиль: `affected-tests` в задачах 2–6 |
| EC-3 | Две `buildApp` в одном процессе тестов | у каждой своё состояние; `close()` одной не ломает запросы к другой | ADR-0005 п.2; TESTING §7.3 |
| EC-4 | `ManualTimeSource.advance(ms)`: два таймера с дедлайнами внутри сдвига, один — за ним; один отменён `clearTimer` | срабатывают только два первых, синхронно, по возрастанию дедлайна; отменённый и дальний — нет; `now()` и `wallNow()` сдвинуты ровно на `ms` | TESTING §7.2 |
| EC-5 | Запрос с cookie `__Host-sid=<любое>` до эпика `auth` | `request.caller = {who: "guest"}`, ответ как гостю, ошибки нет | ADR-0005 п.7 |
| EC-6 | Клиент (не `edge`) шлёт свой `X-Forwarded-For`, каждый раз разный | ключ лимита — адрес сокета; 301-й запрос — 429 | SECURITY §9 (`trustProxy` не `true`) |
| EC-7 | Входящий заголовок `X-Request-Id: attacker` | игнорируется: `request_id` в теле ошибки и логе — UUID, сгенерированный сервером | API §3 |
| EC-8 | `GET /api/health?code=abc&state=xyz` с `Cookie` и `Authorization` | строка лога: путь `/api/health` без строки запроса; нет `abc`, `xyz`, значения cookie и `Authorization` | SECURITY §15 |
| EC-9 | БД упала, потом поднялась без перезапуска `app` | пока недоступна — `503 {"status":"unavailable"}`; после подъёма — снова `200 {"status":"ok"}` | API §12.6 |
| EC-10 | `/api/health` без `X-Protocol-Version` или с чужим номером | `200`, проверки версии нет | API §7 |
| EC-11 | Запрос с `Origin: https://evil.example`, в том числе `OPTIONS` (preflight) | в ответе нет `Access-Control-Allow-*` | API §3, §16; SECURITY §6 |
| EC-12 | Частые обращения к `/api/health` (healthcheck, пинг) | считаются в общий лимит по IP; 300/мин с одного IP проходят | SECURITY §9; ADR-0006 п.2 |
| EC-13 | `maskChallengeIds`: `/api/challenges` (без `id`), `/challenge/:id` (уже маскирован), два `id` в одной строке, полный URL со строкой запроса и `#`, `/game/<id>` | без `id` — без изменений; повторная маскировка — без изменений; оба `id` заменены; маскируется только сегмент `id`, остальное сохраняется; `/game/<id>` не меняется | SECURITY §15, S37 |
| EC-14 | `scripts/check-architecture.sh` при отсутствии `apps/web`, `.github`, модулей | несуществующие пути пропускаются, код 0; правило `example.com` не срабатывает на текст самого скрипта | профиль, задача 2 |
| EC-15 | `npm run seed -- --demo` при `APP_ENV=prod` | код ≠ 0, в БД ничего не записано | TESTING §7.6 MUST |
| EC-16 | В `ErrorCode` есть код, которого нет в API §5.2, или наоборот; то же для операций §12 и `type` §13 | `check-api-doc.sh` красный и называет расхождение в обе стороны | API §16 |
| EC-17 | Схема протокола изменена, `snapshot/protocol.json` — нет | `snapshot.test.ts` красный | API §7, §16 |
| EC-18 | Ключ есть в `ru.json`, нет в `en.json` (или наоборот); нет `error.<code>` для кода `ErrorCode` | тест `packages/i18n` красный | DESIGN §15, §17 |
| EC-19 | `t()` с несуществующим ключом | в режиме разработки — исключение; в сборке — возвращает сам ключ (отправка в Sentry — E03) | DESIGN §15 |
| EC-20 | Язык браузера `ru-UA` / `de-DE`; в `localStorage` сохранён `en` при браузере `ru-RU`; в `localStorage` мусор (`fr`) | `ru` / `en`; `en`; мусор игнорируется, язык — по браузеру | DESIGN §15; ТЗ §5 «Локализация» |
| EC-21 | Система в тёмной теме, гость | атрибута `data-theme` нет, действуют тёмные значения токенов; без inline-скрипта | DESIGN §5, U8 |
| EC-22 | Окно 360×740 | `scrollWidth ≤ 360`, текст вида ключа перевода не виден | ТЗ §5 «Адаптивность»; DESIGN §17 |
| EC-23 | Задан `E2E_BASE_URL` | `webServer` не запускается; `trace`, `video`, `screenshot` — `off`, `reporter: "list"` | TESTING §9 MUST |
| EC-24 | PR меняет только `docs/**` | job `e2e` зелёный, шаги после проверки путей пропущены; фильтров `paths` в workflow нет | TESTING §12, V19 |
| EC-25 | В `ci.yml` добавлен `pull_request_target`, `workflow_run` или лишний триггер | `scripts/check-workflows.sh` красный | OPERATIONS §8 |
| EC-26 | Клон на Windows с `core.autocrlf=true` | `scripts/*.sh` запускаются в Git Bash и в CI без ошибок из-за `\r` | TESTING §6 (Windows, Git Bash); «Открытые вопросы», п.6 |
| EC-27 | `tsc -b` после каждой задачи | нет ссылок на ещё не созданные workspace (нет TS6053) | профиль, «Скелет» |
| EC-28 | Главная грузит ресурсы | все запросы страницы — на свой origin; сторонних CDN, шрифтов и трекеров нет | ТЗ §5 «Аналитика»; ARCHITECTURE §12; DESIGN §1 |
| EC-29 | Гость открывает `/` (сессии нет) | `data-state` ровно `default`; состояние `guest` в E01 не выставляется (появится с E09 вместе с кнопками игрока) | решение Ivan 2026-11-05; DESIGN §10, §10.4 |
| — | Гонки вызова (принятие, отмена, 30 мин) | не применимо: вызовов нет; ADR-0008 — E08 | — |
| — | Флаг против хода | не применимо: партий нет; в E01 только `TimeSource`/`ManualTimeSource` (EC-4) — основа для E06 | — |
| — | 60 с переподключения | не применимо: WebSocket нет (E22, E07) | — |
| — | Перезапуск сервера (ARCHITECTURE §9.3) | не применимо к данным; `startApp().close()` закрывает без штатного завершения (TESTING §7.3) — основа для V16 | — |
| — | 1 `open` вызов и 1 `active` партия | не применимо: таблиц нет | — |
| — | Гость | все запросы E01 — гость (EC-5); главная доступна без входа (EC-29) | ТЗ §3 |
| — | Удалённый игрок | не применимо: User нет; в сиде — с E04 | — |

## Данные и владельцы

- Сущностей и таблиц в E01 нет: `migrations/` пустая, `Database` — пустое пересечение (ADR-0005 п.5). Первая таблица — E04.
- Сид: `--demo` на пустой схеме ничего не пишет; отказ на `APP_ENV=prod` — уже здесь (EC-15).
- Тестовые базы: `chezz_template`, `chezz_test_<n>`, `chezz_e2e` (TESTING §7.1, §9); владелец — инфраструктура тестов (`apps/server/test/support/`, зона backend).
- Типы протокола — только `packages/protocol` (владелец — зона contracts); строки — `packages/i18n` (зона frontend).

## Комплаенс и риски

Персональных данных E01 не собирает и не хранит (ни User, ни Session). Риски — для Ivan, решение за ним:

| Риск | Чем закрыто в E01 | Остаток |
|---|---|---|
| Репозиторий публичный (S36): секрет попадёт в коммит | `.env*` в `.gitignore`, `.env.example` — только имена; `gitleaks` в job `check` (SECURITY §18) | `gitleaks git .` по всей истории перед открытием — Ivan (OPERATIONS §17) |
| Логи `app` с cookie, токенами, `code`/`state` OAuth | базовая настройка pino: путь без строки запроса, `redact` заголовков (AC-15) | маскировка `id` вызова в логах — E03; до E03 маршрутов вызовов нет, `app` в prod не выкатывается |
| Пароль тестовой БД `chezz` в репозитории | не секрет (OPERATIONS §6.4); порт только на `127.0.0.1` (AC-2) | — |
| Артефакты CI видны всем | артефакт `screens` — только PNG главной без cookie (В6); trace не выгружается | — |
| Лицензия | `LICENSE` — GPL-3.0, `license` у корня и workspaces (O28) | лицензии `merida` и звуков — Ivan до E06 |
| `.github/workflows/**` | агент готовит текст, Ivan коммитит и пушит; diff `.github/` показывается до push (O36) | CI на PR заработает только после push Ivan |
| Секрет в шагах CI | в `ci.yml` секретов нет (`permissions: contents: read`) | — |

## Критерии приёмки

Формат: AC — проверяемое утверждение; в скобках — чем проверяется. «Проверка задачи» — команда из профиля; «самопроверка» — разработчик временно вносит нарушение, видит красный `check`, откатывает и пишет это в отчёте (reviewer сверяет).

### T-1 `[infra]`
- [ ] AC-1: `docker compose -f deploy/compose.test.yml config -q` и `… up -d --wait` — код 0; сервис `db-test` здоров по `pg_isready`. (проверка задачи)
- [ ] AC-2: сервис — образ `postgres:18`, порт `127.0.0.1:54329` (не `0.0.0.0`), `POSTGRES_USER`/`POSTGRES_PASSWORD` = `chezz`, данные в `tmpfs`; по `postgres://chezz:chezz@127.0.0.1:54329/postgres` `SHOW server_version` начинается с `18`, `SHOW fsync` = `off`. (проверка задачи + `psql`)

### T-2 `[backend:platform]`
- [ ] AC-3: на чистом клоне `npm ci` — код 0; корневой `package.json` содержит `workspaces`, `"license": "GPL-3.0-or-later"`, `engines.node` 24, devDependency `@playwright/test` и все скрипты TESTING §6 (`db:test:up`, `check`, `test:unit`, `test:int`, `test:contract`, `test:affected`, `test`, `test:e2e`, `seed`). (ревью + `npm ci`)
- [ ] AC-4: `npm run check` (без `check-api-doc.sh`) зелёный; Stylelint — с `--allow-empty-input`. (проверка задачи)
- [ ] AC-5: ESLint: `it.only`, `it.skip`, `test.only` (Playwright), `test.skip` (Playwright), `innerHTML`, `dangerouslySetInnerHTML` → `check` красный. (самопроверка)
- [ ] AC-6: `dependency-cruiser`: импорт между модулями вне таблицы ARCHITECTURE §7.1 (например, `users` → `games`); импорт чужого `repo.ts`, `api.ts`, `tables.ts`, `domain/**` (ADR-0005 п.4); `api.ts` → свой `repo.ts`; `domain/` → `kysely`/`pg`/`fastify`/`ws`; `apps/web` → `apps/server` → `check` красный. (самопроверка)
- [ ] AC-7: `scripts/check-architecture.sh`: `selectFrom`/`insertInto`/`updateTable`/`deleteFrom`/`` sql` `` в `apps/server/src/` вне `repo.ts`; `Date.now`/`performance.now`/`new Date()` в `domain/`; `dropTable`/`dropColumn`/`renameColumn`/`renameTo`/`setDataType` в `migrations/`; `example.com` в `.github`, `deploy`, `scripts` → код ≠ 0. Фабрики `test/support/` и `scripts/seed.ts` под правило SQL не попадают; EC-14 выполняется. (самопроверка)
- [ ] AC-8: Vitest: проекты `unit`, `int`, `contract` с файлами по TESTING §6; у `int` и `contract` — `globalSetup`, `pool: "forks"`, ≤ 2 воркеров; `retries` нет; EC-2 выполняется. (ревью конфига + прогон)
- [ ] AC-9: `globalSetup` создаёт `chezz_template`, применяет миграции (их ноль — без ошибки), каждый воркер получает `chezz_test_<n>` из шаблона; повторный прогон не падает на существующих базах. (прогон `npm run test:int` дважды)
- [ ] AC-10: `startApp()` возвращает `{url, wsUrl, time, database, close()}` на случайном порту; два `startApp()` параллельно — разные порты, `close()` одного не влияет на другой (EC-3). (int разработчика `apps/server/src/platform/skeleton.int.test.ts`; помощник — `apps/server/test/support/app.ts`)
- [ ] AC-11: `ManualTimeSource` ведёт себя по EC-4. (unit разработчика)
- [ ] AC-12: пока резолвер `auth` не подключён, любой запрос, в том числе с cookie, получает `caller = {who: "guest"}` (EC-5). (int разработчика)
- [ ] AC-13: `npm run seed -- --demo` на пустой схеме — код 0; при `APP_ENV=prod` — код ≠ 0, без записей (EC-15). (int или скрипт-тест разработчика)
- [ ] AC-14: `LICENSE` — полный текст GPL-3.0; `.gitignore` исключает `.env*`, кроме `.env.example`; в `.env.example` нет значений секретов SECURITY §17; `.nvmrc` — Node.js 24. (ревью)
- [ ] AC-15: строка лога запроса содержит метод, путь без строки запроса, статус, время, `request_id`; EC-7 (часть «лог») и EC-8 выполняются. (int разработчика; задача — T-2 или T-4 по `design.md`, «Открытые вопросы», п.7)

### T-3 `[contracts]`
- [ ] AC-16: `npm run check` полный (с `check-api-doc.sh`) зелёный; `npm run -w packages/protocol dump` выводит `ErrorCode`, `REST_ROUTES`, `ClientMessage`, `ServerMessage`. (проверка задачи)
- [ ] AC-17: `check-api-doc.sh` красный при расхождении документа и кода в любую сторону (EC-16). (самопроверка)
- [ ] AC-18: тест `schemas.test.ts`: каждая входящая схема отклоняет объект с лишним полем; все ключи соответствуют `^[a-z][a-z0-9_]*$`; во входящих нет `user_id`, `creator_id`, `white_id`, `black_id`; в `Game` (если есть в протоколе) нет `fen`, `pgn`. (unit)
- [ ] AC-19: тест `snapshot.test.ts` сравнивает `z.toJSONSchema` всех схем с `snapshot/protocol.json`; EC-17 выполняется. (unit)
- [ ] AC-20: `PAGES` — функция на каждую строку API §14; `pages.test.ts` проверяет каждую (`PAGES.game("9a1c")` → `/game/9a1c`; `PAGES.player("knight_rider-7")` → `/player/knight_rider-7`). (unit)
- [ ] AC-21: `maskChallengeIds`: `/challenge/<uuid>` → `/challenge/:id`; `/api/challenges/<uuid>/accept` → `/api/challenges/:id/accept`; все случаи EC-13. (unit, SECURITY §15 MUST)
- [ ] AC-22: `PROTOCOL_VERSION` — целое, экспортируется из `version.ts`. (unit)
- [ ] AC-23: `packages/chess` — workspace с зависимостью `chess.js`, собирается `tsc -b`, экспорт пустой, папки `test/` нет. (ревью + `check`)

### T-4 `[backend:platform]`
- [ ] AC-24: `GET /api/health` при живой БД → `200`, тело ровно `{"status":"ok"}`, заголовок `Cache-Control: no-store`; при недоступной БД → `503 {"status":"unavailable"}`; EC-9, EC-10 выполняются. (contract, tester)
- [ ] AC-25: функция ключа лимита: `caller.who = "guest"` → `ip:<ip>` (IPv6 — подсеть /64, IPv4-mapped — как IPv4); `"onboarding"` и `"player"` → `user:<user_id>`; два разных `user_id` с одного IP — разные ключи. (unit разработчика, ADR-0006 п.1, SECURITY §9)
- [ ] AC-26: 300 запросов гостя к `/api/health` с одного IP за минуту — все `200`; 301-й → `429`, тело `{"error":{"code":"rate_limited","message":…,"details":{"retry_after_ms":<int > 0>},"request_id":<UUID>}}`, заголовок `Retry-After`; EC-6, EC-7 выполняются. (contract, tester)
- [ ] AC-27: у каждого маршрута `/api/*` есть настройка лимита (обход списка маршрутов). (int разработчика, ADR-0006 п.4)
- [ ] AC-28: `routes.int.test.ts`: множество маршрутов из `onRoute` (кроме `/auth/*`, страниц, статики) равно записям `REST_ROUTES`; нет `DELETE`; нет пути с `/api/v1`. (int разработчика, API §16; «Открытые вопросы», п.2)
- [ ] AC-29: `cors.int.test.ts`: EC-11; `@fastify/cors` нет ни в одном `package.json`. (int разработчика)
- [ ] AC-30: `registerRoute` проверяет «Кто», `Origin` на POST/PATCH (`403 origin_forbidden`), `X-Protocol-Version` (`409 client_outdated`), строгую схему (`400 validation_failed` без входных значений в `details`), переводит `AppError` в статус по API §5.2, неизвестное исключение → `500 internal` без подробностей. (как проверять без маршрутов каталога — «Открытые вопросы», п.3)

### T-5 `[frontend]`
- [ ] AC-31: `npm run check` зелёный; Stylelint без `--allow-empty-input`; проект Vitest с jsdom для `apps/web/**`. (проверка задачи)
- [ ] AC-32: `tokens.css` содержит токены DESIGN §4, §5, §7.1 для обеих тем; `contrast.test.ts` читает пары из DESIGN §5 между маркерами `contrast-pairs` и проходит; пара ниже порога → тест красный. (unit разработчика)
- [ ] AC-33: Stylelint: hex, именованный цвет, `rgb()`, `px`/`rem`/`em` в `*.module.css` (кроме `min-width` медиа-запросов) → `check` красный; `tokens.css` не проверяется. `check-architecture.sh`: `style={{…#fff…}}` в `*.tsx` и `--base-*` вне `tokens.css` → красный. (самопроверка, DESIGN §17)
- [ ] AC-34: тест `packages/i18n`: EC-18; ключ `app.name` = «Chezz» в RU и EN; EC-19. (unit разработчика)
- [ ] AC-35: главная `/` из собранного `app` (гость): ровно один элемент `[data-screen="lobby"]`, его `data-state` ровно `"default"` (EC-29); внутри виден `Logo` (знак-конь и «Chezz»), `Badge` «Бета» и одна строка текста; кнопки входа, навигации, пресетов и списка вызовов нет; все видимые строки — из ключей `packages/i18n`. (e2e, tester)
- [ ] AC-36: язык выбирается по EC-20; `<html lang>` = выбранный язык. (e2e, tester)
- [ ] AC-37: EC-21 (тёмная тема гостя) и EC-22 (360 px) выполняются в `desktop` и `mobile-360`. (e2e, tester)
- [ ] AC-38: EC-28: все запросы главной — на свой origin. (e2e, tester)
- [ ] AC-39: интерактивные элементы главной (если есть, например ссылка `Logo`) достижимы клавишей Tab, фокус виден (`--focus-width`, `--color-focus`). (e2e, tester; DESIGN §14)
- [ ] AC-40: `scripts/check-bundle.sh` после сборки: gzip чанков главной ≤ 300 КБ → код 0; искусственный чанк сверх порога → код ≠ 0. (самопроверка; ТЗ §5)
- [ ] AC-41: в режиме разработки Vite проксирует `/api`, `/auth`, `/ws` на `app`: `GET <vite>/api/health` → ответ `app`. (ручная проверка разработчика, API §3)
- [ ] AC-42: правило «адреса только из `PAGES`»: литерал, начинающийся с `/game/`, `/player/`, `/challenge/`, `/leaderboard/` (в `"`, `'` или `` ` ``), в `apps/web/src` и `apps/server/src/seo` вне `pages.ts` и тестов → `check` красный. (самопроверка; задача правила — «Открытые вопросы», п.5)
- [ ] AC-43 (шаг tester): `playwright.config.ts` — проекты `desktop` (Chromium 1280×800), `mobile-360` (Chromium 360×740, касание), `webkit` (390×844), `firefox`; `webServer` создаёт `chezz_e2e`, применяет миграции, выполняет сид `--demo`, собирает и запускает `app`; `retries: 1` только при `CI=true`; EC-23. (ревью конфига + прогон)
- [ ] AC-44 (шаг tester): `openScreen(page, path, id)` ждёт `[data-screen="<id>"]`, проверяет непустой `data-state` и `scrollWidth ≤ ширина окна`; `@smoke`-тест вызывает `openScreen(page, "/", "lobby")` и проверяет `[data-state~="default"]`. (e2e)
- [ ] AC-45 (шаг tester): `screens.spec.ts`: экран `lobby` (`/`, состояние `default`) × `desktop`, `mobile-360` × `ru`, `en` — открывается через `openScreen(page, "/", "lobby")`, нет горизонтальной прокрутки, нет видимого текста по `^[a-z_]+(\.[a-z_]+)+$`, `<html lang>` = язык; скриншоты без cookie сохраняются в `tests/e2e/screens/`. Других экранов (в том числе `not-found`) в E01 нет. (e2e)

### T-6 `[ci]`
- [ ] AC-46: `ci.yml`: триггеры только `pull_request` в `main` и `push` в `main`; `permissions: contents: read`; `concurrency: ci-${{ github.ref }}` с отменой для PR; нет `paths`/`paths-ignore`; `scripts/check-workflows.sh` зелёный, EC-25 — красный. (проверка задачи + самопроверка)
- [ ] AC-47: job `check`: `npm ci` → `npm run check` → `gitleaks` по изменениям (находка — красный) → `npm audit --omit=dev --audit-level=high` (только предупреждение) → `test:unit` → `test:int` → `test:contract`; `services:` `postgres:18` на 54329; `timeout-minutes: 15`. (ревью; TESTING §12)
- [ ] AC-48: job `e2e`: первый шаг — проверка путей (EC-24); затем PostgreSQL `services:`, сборка, `scripts/check-bundle.sh`, `npm run test:e2e` в `desktop` и `mobile-360`; `actions/upload-artifact` с именем `screens` и путём `tests/e2e/screens/**`, без trace; `timeout-minutes: 20`. (ревью; TESTING §12, В6)
- [ ] AC-49: сторонние actions закреплены полным SHA; `actions/checkout` с `persist-credentials: false`; кэш npm и браузеров Playwright. (ревью; OPERATIONS §8)
- [ ] AC-50: `CODEOWNERS` — `/.github/`, `/deploy/`, `/scripts/ops/`, `/LICENSE`, `/docs/SECURITY.md`, `/docs/OPERATIONS.md`; `dependabot.yml` — `npm` (`/`), `github-actions` (`/`), `docker` (`/deploy`), раз в неделю. (ревью; OPERATIONS §16.1)

### T-7 `[e2e]` и фича
- [ ] AC-51: `npm run test:e2e` зелёный в `desktop` и `mobile-360` локально; на PR зелёные job `check` и `e2e`, артефакт `screens` есть. (прогон; TESTING §14)

## Открытые вопросы

Нумерация сохранена: на номера ссылаются AC и Edge cases.

1. ~~Ivan — принять ADR-0005 и ADR-0006 до старта T-2.~~ **Закрыт (Ivan, 2026-11-05):** оба ADR приняты; статус в файлах ADR обновляет architect в режиме apply. T-2 можно начинать.
2. **architect — объём каталога в протоколе скелета (блокирует проектирование T-3 и T-4).** `check-api-doc.sh` сверяет с кодом весь каталог API §5.2, §12, §13, а `routes.int.test.ts` требует «маршруты Fastify = `REST_ROUTES`» (API §16). Если в T-3 описать весь каталог — `routes.int` красный до последнего эпика (зарегистрирован только `getHealth`); если только `getHealth` — красный `check-api-doc.sh`. Нужно правило: например, пометка «реализовано» в каталоге или сравнение `onRoute ⊆ REST_ROUTES` плюс список ещё не подключённых операций. От ответа зависят AC-16, AC-18, AC-28, AC-34 (`error.<code>` на каждый код).
3. **architect — как проверить `registerRoute` в E01 (AC-30).** В скелете нет маршрутов с «Кто» = И, POST и телом. Варианты: тестовый маршрут на отдельном экземпляре `buildApp` только в int-тесте разработчика (не в `REST_ROUTES`, не в prod-сборке — SECURITY §1 «нет тестового входа») или перенос проверок в E04 вместе с первыми маршрутами. Сюда же — лимит 16 КБ тела (`payload_too_large`).
4. ~~Ivan / designer — ID экрана и состав главной-заглушки.~~ **Закрыт (Ivan, 2026-11-05):** вариант (а) — `data-screen="lobby"`, `data-state="default"` с временным составом (`Logo`, `Badge` «Бета», одна строка текста), DESIGN не правится. Экрана `not-found` в E01 нет. Отражено в «Ограничениях», «Scope», EC-29, AC-35, AC-44, AC-45; фреймы Figma — `lobby` `360 / light / default` и `1280 / light / default`.
5. **architect — кто добавляет правило «адреса только из `PAGES`» в `check-architecture.sh` (AC-42).** API §16 требует его «в скелете», но `scripts/check-architecture.sh` нет в зоне contracts (T-3); варианты — T-2 (backend, пути `apps/web` и `seo` пока пропускаются) или T-5 (frontend).
6. **architect — `.gitattributes` с `*.sh text eol=lf` (EC-26).** Файла нет в списке T-2 профиля; без него на Windows с `core.autocrlf=true` скрипты `scripts/*.sh` падают в Git Bash из-за `\r`. Добавить в T-2 (корневой файл, зона backend)?
7. **architect — базовая настройка pino (AC-15) в E01 или E03.** ROADMAP относит к E03 только маскировку `id` вызова; путь без строки запроса и `redact` заголовков нужны с первого лога `app`. По умолчанию analyst — E01 (T-2 или T-4).
8. **architect — `node file.ts` без сборки (TESTING §6) работает только со стираемым синтаксисом TypeScript** (без `enum`, `namespace`, параметров-свойств). Закрепить в `tsconfig` (`erasableSyntaxOnly`) для `scripts/seed.ts` и `apps/server`, иначе ошибка проявится только при запуске сида в e2e.
9. **architect — сброс окна лимита (AC-26).** `@fastify/rate-limit` считает время сам, не через `TimeSource`: «через минуту лимит снова открыт» contract-тестом с `ManualTimeSource` не проверить. Достаточно ли в E01 проверки 300/301 без проверки сброса?
