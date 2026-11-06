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
