# Ревью e01-skeleton

## T-1 — итерация 1
Вердикт: APPROVE

Проверено: `deploy/compose.test.yml` (новый, единственное изменение задачи; `log.md` — оркестратор). Состав сервиса `db-test` построчно совпадает с OPERATIONS §6.4 и TESTING §7.1: `postgres:18`, `127.0.0.1:54329:5432`, `chezz`/`chezz`, `tmpfs: /var/lib/postgresql` (для образа 18 `PGDATA` = `/var/lib/postgresql/18/docker` лежит внутри tmpfs), `fsync=off`, `synchronous_commit=off`, `full_page_writes=off`, healthcheck `pg_isready`. AC-1, AC-2, EC-1 подтверждены прогоном оркестратора (`config -q`, двойной `up -d --wait` → один контейнер, healthy; `server_version` 18.6, `fsync` off).
Правила зоны devops (OPERATIONS §1, SECURITY §1, §17, §18): порт только на `127.0.0.1`; нет `privileged`, `docker.sock`, bind-mount хоста; нет `example.com`, логина владельца, IP, секретов (пароль `chezz` — не секрет по OPERATIONS §6.4, отмечен в комментарии); новых зависимостей нет; новый контейнер уже описан в документах (§6.4), правки ARCHITECTURE §14 не требуются. Отдельное имя проекта `chezz-test` не пересекается с prod-проектом `chezz` (OPERATIONS §6.1).
Тестовые пути tester не тронуты.

### Блокеры
- нет

### Желательно
- [deploy/compose.test.yml] Изменён путь `deploy/` — diff показать Ivan до push (O36; OPERATIONS §1).
- [deploy/compose.test.yml:2] Комментарий ссылается на `npm run db:test:up`, которого пока нет (корневого `package.json` нет); EC-1 в формулировке requirements («`npm run db:test:up` дважды») закрывается окончательно только после задачи, добавляющей скрипт, — проверить её там.

## T-2 — итерация 1
Вердикт: CHANGES_REQUESTED

Проверено: все новые и изменённые файлы задачи (корневые конфиги, `apps/server/**`, `scripts/check-architecture.sh`, `scripts/check-bundle.sh`, `.gitattributes`, `LICENSE`, `README.md`, `.env.example`, `.gitignore`, `.nvmrc`). Пути тестов tester не изменены (`git status --porcelain` по ним пуст). Мои прогоны: `npm run check` — код 0; `npx vitest run` ×3 — 4 файла, 19/19 зелёные.
Самопроверки повторены в scratchpad (вне репозитория):
- ESLint (AC-5): `it.only`, `it.skip`, `test.only` и `test.skip` в Playwright, `innerHTML`, `dangerouslySetInnerHTML` дают ошибку.
- `check-architecture.sh` (AC-7, AC-7a, EC-14): дерева нет → код 0; SQL вне `repo.ts`, чужая таблица в `repo.ts`, `Date.now` в `domain/`, `dropTable` в миграции, `createUsersService(` в `games/`, `example.com` в `deploy/` → код 1, сообщение с файлом, строкой и правилом.
- `dependency-cruiser` (AC-6): `users` → `games`, `api` → свой `repo`, `domain` → `kysely`, `apps/web` → `apps/server` дают ошибку.

AC-3 (скрипты TESTING §6, `license`, `engines`, `@playwright/test`), AC-8 (проекты, `globalSetup`, `forks`, `maxWorkers: 2`, нет `retries`, `passWithNoTests` в корне — для проекта это поле запрещено типами Vitest 5), AC-14 (`LICENSE` — полные 0–17 + How to Apply; `.gitignore` с `.env*` и `!.env.example`; `.nvmrc` = 24), EC-27 (ссылка `tsconfig` только на `apps/server`) — в порядке.
Правила зоны backend:
- ADR-0005 п.2: синглтонов на уровне файла нет.
- `TimeSource`: системный — только в `main.ts`.
- SECURITY §15: `redact` cookie, authorization, set-cookie; путь без строки запроса; встроенные строки Fastify с полным URL отключены.
- API §3: `X-Request-Id` генерирует сервер.
- `trustProxy: false`, `@fastify/cors` нет.
- Сид при `APP_ENV=prod` отказывает до подключения к БД (TESTING §7.6).

### Блокеры
- [.dependency-cruiser.cjs:44-53] Правило `foreign-module-internals` запрещает любой модуль импортировать `platform/*`: у `platform` нет `service.ts`, а `pathNot` пропускает только `service|events`. Проверил в scratchpad: `users/repo.ts` → `platform/db.ts` и `platform/http.ts` дают `error foreign-module-internals`. По ADR-0005 п.5, п.7, п.8 и ARCHITECTURE §7.1 модули обязаны импортировать `platform/db.ts` (`Db`, `Trx`, `forTables`), `platform/http.ts` (`registerRoute`, `Caller`), `platform/ws.ts`, `platform/time.ts`, а позже и `platform/errors.ts`. Сейчас `check` зелёный только потому, что модулей нет; первый модуль (E04) упрётся в красный `check`. Что сделать: добавить `^apps/server/src/platform/` в `to.pathNot`, а в отчёте задачи — самопроверку «`users/repo.ts` → `platform/db.ts` — без ошибки». (Пункт чек-листа 2а/3; ADR-0005 п.4–5, ARCHITECTURE §7.1, §7.4)
- [apps/server/src/platform/skeleton.int.test.ts:139-142] Это нестабильный тест и вероятная причина падения первого прогона. В склейку всех строк лога входит `request_id` (UUID v4, hex), а в списке запрещённых подстрок есть `"abc"`. Случайный UUID содержит `abc` примерно с вероятностью 0,6 % (замер: 200 000 `randomUUID()`). Тогда AC-15 падает без дефекта в коде. Что сделать: искать запрещённые значения в строке лога без поля `request_id` (например, удалить его из объекта перед `JSON.stringify`) либо проверять `abc`/`xyz` только в `req.path` и в тексте вне UUID. Заменить в запросе `abc`/`xyz` на не-hex значения нельзя: значения заданы в EC-8. Других источников нестабильности в `test/support` не нашёл. Создание баз под `pg_advisory_lock` корректно. `globalSetup` защищён `Symbol.for` и выполняется один раз за прогон. `groupOrder` разводит `int` и `contract` по времени, поэтому `chezz_test_<VITEST_POOL_ID>` одновременно не делится. `CREATE DATABASE … TEMPLATE` после `db.destroy()` шаблона защищён ожиданием PostgreSQL до 5 с. У самотеста шаблона свои имена `chezz_selftest_*`, базы воркеров он не трогает. (Тесты; TESTING §1 «падение, которое не повторилось», §15 «случайное падение — разбирать как баг»)

### Желательно
- [apps/server/test/support/app.ts:28-32] `startApp` принимает `logDestination`, которого нет в «Публичных интерфейсах» design (там только `config`). Расширение обратно совместимо, но tester T-4 читает только design → внести поле в design.md «Тестовая инфраструктура сервера» (→ architect-apply).
- [requirements.md AC-10] В скобках написано «int разработчика в `test/support/`». Тесты лежат в `src/platform/skeleton.int.test.ts`, и это верно: TESTING §1, §5, §6 требуют `int` в `apps/server/src/**/*.int.test.ts`, а из `test/support/` Vitest не запускает ничего. Формулировку AC поправить (→ architect-apply / analyst).
- [apps/server/test/support/app.ts:91-96] `close()` не вызывает `app.close()` и хуки `onClose`. Это соответствует TESTING §7.3 (имитация падения), но в T-4 плагины (`@fastify/rate-limit`, `@fastify/static`) не освободят свои ресурсы, а в форке Vitest могут остаться активные handle. В T-4 проверить, что воркер завершается без «close timed out»; если нет — закрывать ресурсы плагинов, не вызывая `onClose` сервисов.
- [apps/server/src/platform/skeleton.int.test.ts:69-80] AC-10 «app восстанавливается без перезапуска» проверяется отдельным пулом `probe`, а не запросом к самому app. Это допустимо, пока нет `/api/health`, но в T-4 восстановление подтверждает contract-тест health (EC-9/EC-10) — убедиться, что он делает `block → 503 → unblock → 200` на одном `startApp`.
- [apps/server/src/main.ts:18, apps/server/src/app.ts:44-46] Миграции применяются дважды: в `main.ts` и в `onReady`. Так требует design, и это безвредно (Migrator идемпотентен). Достаточно одного места; при следующем касании выбрать одно (→ architect-apply, если менять design).
- [LICENSE:4, 648, 667] Старая редакция текста GPL-3.0 (`http://fsf.org/`, `http://www.gnu.org/licenses/`); юридический текст тот же (разделы 0–17, How to Apply), AC-14 выполнен. По желанию заменить на текущий `https://www.gnu.org/licenses/gpl-3.0.txt` (Ivan).
- [.gitattributes:3] После `* text=auto eol=lf` 12 файлов рабочей копии остались с CRLF (в индексе LF). Ничего не ломает; при желании выполнить `git add --renormalize .` перед коммитом — делает оркестратор.
- [package.json:23-36] Зависимости совпадают с планом (SECURITY §18). Причину для каждой должен назвать отчёт разработчика, особенно для `@eslint/js`, `typescript-eslint`, `@types/node`, `@types/pg`, `@vitest/eslint-plugin`; если её нет — дописать в log.md. Версии: TS ~6.0, ESLint 9, Stylelint 17, Vitest 5.1; правил о версиях нет.
- [scripts/check-bundle.sh:139] Считает все `assets/*.js|css`, а не только ресурсы из `index.html`. По design это доделывает T-5 — проверить там.

## T-2 — итерация 2
Вердикт: APPROVE

Проверены блокеры итерации 1 и изменения после неё: `.dependency-cruiser.cjs` и `apps/server/src/platform/skeleton.int.test.ts`. Другие файлы задачи не менялись (со слов оркестратора; набор путей в `git status` прежний). Мои прогоны: `npm run check` — код 0; `npx vitest run --project int` — 11/11.
- Блокер 1 закрыт. [.dependency-cruiser.cjs:53] В `pathNot` правила `foreign-module-internals` добавлено исключение `^apps/server/src/platform/`. Повторил самопроверку в scratchpad: `users/repo.ts` → `platform/db.ts` больше не даёт `foreign-module-internals`. Ошибки по-прежнему дают `rating/service.ts` → `users/tables.ts` и `games/service.ts` → `rating/repo.ts`, `rating/tables.ts`. Импорт из `platform/` в модуль ловят `module-deps-platform` и `foreign-module-internals` (ARCHITECTURE §7.1 «platform — ни от кого»).
- Блокер 2 закрыт. [apps/server/src/platform/skeleton.int.test.ts:139-145] Перед поиском запрещённых подстрок `request_id` удаляется из каждой строки лога. Форма поля и его равенство заголовку проверяются выше (`toMatchObject`, `UUID_V4`). Остальные поля лога hex-UUID не содержат: `base: null`, `ms` — число. Источник случайного падения устранён, EC-7 и EC-8 проверяются по-прежнему.

### Блокеры
- нет

### Желательно
- Пункты «Желательно» итерации 1 остаются в силе. Пометки → architect-apply: `logDestination` в design, формулировка AC-10. Для T-4: `close()` и ресурсы плагинов, проверка восстановления через health.

## T-3 — итерация 1
Вердикт: CHANGES_REQUESTED

Проверено: `packages/protocol/**` и `packages/chess/**` (новые), `scripts/check-api-doc.sh`, а также правки корня: ссылки в `tsconfig.json`, `check-api-doc.sh` в скрипте `check`, `package-lock.json` (добавлены только `zod`, `chess.js` 1.4.0 с лицензией BSD-2-Clause и ссылки на workspace). Пути тестов tester не тронуты: `git status --porcelain` по ним пуст. Мои прогоны: `npm run check` — код 0, `check-api-doc: ok`; `npx vitest run --project unit` — 6 файлов, 26/26.
- AC-17 / EC-16. Проверил шире, чем разработчик: в scratchpad, через `API_DOC` и `PROTOCOL_DUMP`, без правки репозитория. Скрипт красный (код 1) и называет расхождение поимённо в каждом случае:
  - код ошибки переименован в 5.2, то есть расходится в обе стороны;
  - лишний код в `ErrorCode`;
  - операция одновременно в `REST_ROUTES` и в `PENDING_CATALOG`;
  - операция есть в документе, но её нет ни в `REST_ROUTES`, ни в `PENDING_CATALOG`;
  - операция есть в `PENDING_CATALOG`, но её строка удалена из §12;
  - реализованная операция отсутствует в документе;
  - у `getHealth` расходится путь, отдельно — метод;
  - `type` клиента переименован в §13, а также в §9.1;
  - лишний `type` сервера в `PENDING_CATALOG`.
  Документ с CRLF разбирается корректно.
- AC-16: `dump` по форме design. AC-19 / EC-17, AC-20, AC-21 / EC-13, AC-22 — тесты с номерами есть и зелёные. AC-23: `export {}`, `chess.js`, папки `test/` нет. EC-27: ссылки только на существующие workspace.
- Правила зоны contracts (API §1, §7, §14, §15, §16; SECURITY §12, §15; ARCHITECTURE §1, §10; GLOSSARY §1, §12):
  - раскладка и имена — по §15, `RouteDef` по §15 п.3, `PAGES` — 12 функций на строки §14;
  - `maskChallengeIds` — одна реализация, `/game/<id>` не трогает;
  - `ErrorCode` совпадает с 5.2;
  - CORS нет, `/api/v1` нет, сущностей вне этапа нет;
  - `z.never()` для пустых `ClientMessage`/`ServerMessage` допустим: форму design оставил на выбор разработчика.

### Блокеры
- [packages/protocol/src/rest/health.ts:4] `GetHealthResponse` объявлен через `z.strictObject`, поэтому в снимке у ответа `additionalProperties: false` (`snapshot/protocol.json:154`). Это противоречит API §1: строгие только входящие схемы, а «клиент разбирает ответы сервера нестрого». Противоречит и API §7: новое поле ответа — совместимое изменение. Клиент, который проверяет ответ схемой из `REST_ROUTES.getHealth.response`, сломается на совместимом изменении. Файл — первая схема ответа в протоколе, и следующие эпики возьмут его за образец. «Тело ровно `{"status":"ok"}`» из AC-24 проверяет contract-тест сервера, а не строгость схемы. Что сделать: заменить на `z.object({status: z.enum(["ok", "unavailable"])})`, перезаписать снимок (`npm run -w packages/protocol snapshot`), `PROTOCOL_VERSION` не менять: протокол ещё не выпущен, и ослабление совместимо. (Пункт 2а/5; API §1, §7)

### Желательно
- [packages/protocol/src/schemas.test.ts:46-51] Тест «отклоняет объект с лишним полем» проверяет только схемы, которые принимают `{}`. Схему с обязательными полями он молча пропускает. Строгость тогда держится только на признаке `additionalProperties !== false` в JSON Schema. Схема с `z.preprocess` или `transform` при `unrepresentable: "any"` даёт `{}` без `properties` и проходит обе проверки. Сейчас входящих схем ноль, поэтому это не блокер. Что сделать: в первом тесте считать нарушением входящую схему без `properties` или без `anyOf`/`oneOf` объектов, либо держать рядом со схемой минимальный валидный пример и проверять на нём лишнее поле (AC-18; API §16).
- [packages/protocol/src/schemas.test.ts:40-44] Правило `snake_case` из API §1 относится ко всем ключам JSON. Тест же обходит только входящие схемы, и `ErrorResponse`, `GetHealthResponse` и будущие `ServerMessage` не проверяются. Дешёвое расширение: прогнать проверку ключей (без проверки строгости) по всему `buildSnapshot()`.
- [packages/protocol/src/common.ts:14] В `request_id: z.string()` формат можно сузить до `z.uuid()`: по API §3 это UUID, который генерирует сервер. Ответ клиент разбирает нестрого, так что это только точность схемы.
- [packages/protocol/src/snapshot.ts:13] Снимок ответов и `ServerMessage` строится с `io: "input"`. Для схем, которые выдаёт сервер, точнее `io: "output"`: различие появится с `default` и `transform`. Стоит решить сейчас, пока снимок пустой. Если менять design, то → architect-apply.
- [package.json зависимости `zod`, `chess.js`] Причина по SECURITY §18 очевидна (ARCHITECTURE A14, A3; план T-3), но в log.md нет отчёта разработчика с ней. Нужно дописать одной строкой.

## T-3 — итерация 2
Вердикт: APPROVE

Проверены блокер итерации 1 и то, что изменилось после неё: `rest/health.ts`, `snapshot/protocol.json`, `schemas.test.ts`, строка о зависимостях в log.md. Мой прогон: `npx vitest run --project unit` — 27/27.
- Блокер закрыт. [packages/protocol/src/rest/health.ts:4] `GetHealthResponse` теперь объявлен через `z.object`. В `snapshot/protocol.json` больше нет `additionalProperties: false`, снимок совпадает со схемой. `PROTOCOL_VERSION` = 1 не менялся, это верно (API §1, §7).
- Пункт «Желательно» о лишнем поле выполнен. [schemas.test.ts:63-70] Каждая входящая схема получает `{extra_field_x: 1}`, тест ждёт `unrecognized_keys`. Проверил в node:
  - `z.strictObject` с обязательными полями на таком входе даёт `unrecognized_keys` вместе с ошибками обязательных полей, поэтому схемы с обязательными полями больше не пропускаются;
  - нестрогий `z.object` даёт только `invalid_type`, то есть тест его ловит.
- Пункт «Желательно» о `snake_case` выполнен. [schemas.test.ts:72-74] Ключи проверяются по всему `buildSnapshot()`, включая ответы.
- SECURITY §18: причины для `zod` и `chess.js` записаны в log.md:43.

### Блокеры
- нет

### Желательно
- Пункты итерации 1 о `request_id: z.uuid()` и `io: "output"` для схем, которые выдаёт сервер, остаются в силе. Если менять design, то → architect-apply.

## T-4 — итерация 1
Вердикт: APPROVE

Проверено: `apps/server/src/app.ts`, `apps/server/src/platform/http.ts`, `errors.ts`, `rate-limit-store.ts`, `health.ts`, `repo.ts`, тесты разработчика (`http.test.ts`, `health.test.ts`, `routes.int.test.ts`, `cors.int.test.ts`, `register-route.int.test.ts`, `spa.int.test.ts`), `apps/server/package.json`, `package-lock.json`. Тестовые пути tester не тронуты: `git diff` и `git status --porcelain` по `apps/server/test`, `packages/chess/test`, `fixtures`, `tests` пусты. Мои прогоны: `npm run check` — код 0; `vitest --project unit,int,contract apps/server` — 82/82; `--project contract` — 18/18.
Сверил исходник `@fastify/rate-limit` 11.2.2: ключ `+ groupId`, `child()` на каждый маршрут с `config.rateLimit`, `Retry-After = ceil(ttl/1000)`, `throw errorResponseBuilder(...)`, `normalizeIP` (по умолчанию /64, IPv4-mapped → IPv4).
- AC-24…AC-30, EC-6, EC-7, EC-9…EC-12 закрыты: на каждый есть тест с номером, и все они зелёные. В `bare()` на голом Fastify `registerRoute` проверяет порядок `Origin → версия → «Кто» → тело/params/query`. Есть проверки «без входных значений в `details`», `__proto__` → `json`, ровно 16 КБ / 16 КБ + 1, `internal` без подробностей и код только для WS → 500.
- Правила зоны backend (ARCHITECTURE §7.1, §7.4, A27; API §1, §3, §5, §7, §16; SECURITY §1, §6, §9, §15, §18):
  - SQL только в `platform/repo.ts`, время только через `TimeSource`, синглтонов уровня файла нет;
  - `Origin` проверяется на POST/PATCH, при отсутствии заголовка тоже 403;
  - CORS нет, DELETE нет, `/api/v1` нет;
  - `trustProxy: false`, `X-Request-Id` только серверный;
  - статика без лимита, `wildcard: false` (обхода путей и маршрута `/*` нет);
  - ответ разбирается через `def.response.safeParse` и нестрогий `z.object`, так что лишние поля отбрасываются (SECURITY §12);
  - тестового входа в `buildApp` нет: синтетические маршруты и заглушка резолвера — только в int-тесте.
- Зависимости `@fastify/rate-limit`, `@fastify/static` (MIT) и workspace `@chezz/protocol` есть в плане T-4, причины — в log.md (SECURITY §18).
- Пункт T-2 «`close()` и ресурсы плагинов» снят: в хранилище лимита таймеров нет. Пункт T-2 «восстановление через health» закрыт contract-тестом EC-9.

Отступления, которые вынес разработчик:
1. Отложенный разбор тела (413, `content_type` и `json` — на шаге схем, после `Origin`, версии и «Кто», в счёт лимита) — **принимаю**. Это соответствует ADR design «отказы тоже считаются в лимит» и не ослабляет CSRF: `Origin` проверяется первым. Чтение тела ограничено так же, как у встроенного `bodyLimit` Fastify (по `Content-Length` до чтения, затем по потоку). Нужна правка design: «Перевод ошибок» и порядок `registerRoute`.
2. Ключ гостя IPv6 → /64, IPv4 и IPv4-mapped → `ip:<ip>` — **принимаю**. Это поведение `normalizeIP` по умолчанию, и иначе лимит обходится сменой адреса внутри /64. Но буква ADR-0006 п.1 и AC-25 — `ip:<request.ip>`, поэтому нужна правка ADR-0006 п.1 и SECURITY §9 (ключ) → architect.
3. `AppDeps.onRoute?` — **принимаю**. Это только наблюдатель, поведения prod он не меняет, доступа в обход Session не даёт (SECURITY §4). Сигнатуру нужно дописать в design «Сигнатуры скелета».
4. `reply.code(def.status)` до обработчика, обработчик может сменить код (health → 503) — **принимаю** для P16. В design записать, что ответ вне §5 со своим статусом — только у `getHealth`, остальные отказы идут через `AppError`.
5. Общее хранилище счётчиков, `child()` возвращает то же хранилище, особые лимиты — `groupId` — **принимаю**. Это совпадает с SECURITY §9 («REST, включая вход и upgrade, — 300/мин») и с EC-12. Встроенный `LocalStore` давал бы 300/мин на каждый маршрут. Расхождение с design: окно считается по `TimeSource`, а в ADR design строка «Сброс окна… `@fastify/rate-limit` считает время сам» отвергала «часы плагина через `TimeSource`». Новое решение согласуется с A27 и делает сброс окна проверяемым, поэтому строку ADR нужно переписать. Ответ на вопрос tester («общий ли счётчик») — тоже в design.
6. Ссылки `tsconfig` `apps/server` → `packages/protocol` нет (TS6310) — **не блокер**. Корневой `tsconfig.json` ссылается на `packages/protocol`, а исходники пакета проверяются в программе сервера через workspace. Design такой ссылки не требует. Если её нужно добавить (`composite` + `emitDeclarationOnly` у protocol), это решение contracts → architect.
- `internal` без подробностей (причина — в лог с `request_id`), коды только для WS в REST → 500, таймаут health 2 с через `TimeSource` (A27; таймер снимается в `finally`) — в порядке.

### Блокеры
- нет

### Желательно
- [apps/server/src/platform/register-route.int.test.ts:177] Ветка `WHO_REFUSAL.player → forbidden` (http.ts:214) не покрыта: нет синтетического маршрута без `player` в `who`. AC-30 и API §1 («остальным — `forbidden`»). Добавить маршрут `who: ["guest"]` и проверку `player → 403 forbidden`.
- [apps/server/src/platform/errors.ts:139, log.ts:35] На каждой 500 в лог пишется `err` через `pino.stdSerializers.err`, а он сериализует все перечислимые поля ошибки. У ошибок `pg` это `detail` (`Key (email)=(…) already exists`), то есть с появлением `users` (E04) в лог попадёт e-mail (SECURITY §15 MUST NOT). Сейчас таблиц нет, но до E04 стоит ввести свой сериализатор `err` (`type`, `message`, `stack`, `code`) → backend, E03/E04.
- [apps/server/src/app.ts:70] `assetsDir` строится от `webDistDir` как есть, а `filePath` — через `path.resolve`. `loadConfig` отдаёт абсолютный путь, но `AppConfig` из теста с относительным путём молча даст `no-cache` для `/assets/*`. Заменить на `path.resolve(webDistDir, "assets") + path.sep`.
- [apps/server/src/platform/health.ts:200, db.ts:27] После таймаута `ping` не отменяется, а у пула нет `connectionTimeoutMillis`. При зависшей сети каждая проверка health занимает ожидание в пуле (max 10). Тогда обычные запросы встанут в очередь за ними. Задать `connectionTimeoutMillis` (например 2000) в `createDb` → backend, до E02 (healthcheck контейнера).
- [apps/server/src/platform/http.ts:105-153] Парсер `*` ставит `request.body = undefined` и `bodyIssue`, но не бросает ошибку. Маршрут не через `registerRoute` (будущие `/auth/*` у auth) молча получит пустое тело. В design или комментарии `apiRateLimit` записать: «маршрут вне `registerRoute`, читающий тело, обязан проверить `request.bodyIssue`» → architect-apply.
- [apps/server/src/platform/http.ts:174-187] `/auth/<нет>` и `/ws<…>` без маршрута отдают 404 без счётчика лимита (лимит только для `isApiPath`). Сейчас это не нарушение (SECURITY §9 считает маршруты входа и upgrade, а их пока нет), но 404 по `/auth/*` стоит считать в лимит вместе с E03 → architect.

Правки design.md (→ architect-apply):
- «Перевод ошибок» и порядок `registerRoute`: 413, `content_type`, `json` — на шаге схем, после «Кто», в счёт лимита (п.1); обработчик `getHealth` меняет статус через `reply.code()` (п.4).
- ADR-0006 п.1, SECURITY §9, AC-25: ключ гостя IPv6 — подсеть /64, IPv4-mapped → IPv4 (п.2).
- «Сигнатуры скелета»: `AppDeps.onRoute?`; `installHttp(app, HttpOptions)` с `notFoundFallback`; `apiRateLimit(opts?: {max, timeWindowMs, group})`; поля `AppConfig` в «Публичных интерфейсах» (вопрос tester из log.md) (п.3).
- Строка ADR «Сброс окна лимита»: окно по `TimeSource`, общий счётчик на ключ, особые лимиты — `groupId` (п.5).
- Ссылка `tsconfig` `apps/server` → `packages/protocol`: оставить без неё или ввести `composite`/`emitDeclarationOnly` у protocol (п.6, решение contracts).
