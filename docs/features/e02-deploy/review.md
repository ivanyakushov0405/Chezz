# Ревью e02-deploy

## T-1 — итерация 1
Вердикт: CHANGES_REQUESTED
### Блокеры
- [eslint.config.js:11, :77-93] `tests/deploy/**/*.ts` добавлен в `VITEST_FILES`, и на него действует общий запрет `skipIf`. Исключения для `tests/deploy/` нет. Проверено: `it.skipIf(process.platform === "win32")(...)` в `tests/deploy/x.test.ts` даёт ошибку `no-restricted-syntax` («.skipIf запрещены… только векторы вида C»). TESTING §1 (V24) и design (A1, «Выжимка» tests, ADR п.5) это исключение прямо разрешают. Тесты прав файлов из T-2…T-4 без него не пройдут `npm run check`, а eslint.config.js не входит в зону tester. → Что сделать: добавить блок для `files: ["tests/deploy/**/*.ts"]` по образцу `GLICKO_VECTORS`. В нём `.only/.skip/.todo/runIf` остаются запрещены, а `skipIf` разрешён только с аргументом `process.platform === "win32"`. Пример селектора запрета: `CallExpression[callee.object.name=/^(it|test|describe|suite)$/][callee.property.name='skipIf']:not([arguments.0.type='BinaryExpression'][arguments.0.operator='==='][arguments.0.left.object.name='process'][arguments.0.left.property.name='platform'][arguments.0.right.value='win32'])`. Если `vitest/no-disabled-tests` тоже срабатывает на `skipIf`, выключить его только в этом блоке. Обновить комментарий у `GLICKO_VECTORS`: «единственное место» уже не так. Проверить, что `it.skipIf(process.platform === "win32")` проходит линт, а `it.skipIf(true)` и `it.skip` дают ошибку. Пункты чек-листа: 2а (TESTING §1, §11), 1 (design T-1: «правила Vitest» для `tests/deploy/**` с учётом исключения V24).

### Желательно
- [vitest.config.ts:72] `groupOrder: 3` у `deploy-image` — отступление, в design его нет. Оно разумно: проект не идёт параллельно с `int`/`contract`, которые делят тестовую БД, а AC-5 запускает `app` на той же БД. Предлагаю принять и отразить в TESTING §6 → architect-apply.
- [package.json:19] `test:affected` (`vitest run --changed origin/main`) захватит проект `deploy-image`, если меняются `*.image.test.ts` или `tests/deploy/support/*`. Тогда локальному прогону нужны Docker и сеть. CI это не затрагивает: в `ci.yml` нет `test:affected`. Стоит упомянуть в TESTING §6 рядом с примечанием про `--changed` → architect-apply.
- [vitest.config.ts:73-77] У `deploy-image` нет явного `exclude`, работает значение Vitest по умолчанию. Это корректно. Для симметрии с `deploy` можно указать `exclude: ["**/node_modules/**"]`. Это вкусовое замечание.
- Согласованность с основой tester 89edfb1 в порядке: `tests/deploy/tsconfig.json` (`lib: es2024`, `types: node`, `include: **/*.ts`) совпадает с design; ссылка в корневом `tsconfig.json` есть; `support/bash.ts` подхватывается ESLint и `tsc -b`. Тесты tester не изменены: `git diff` по `tests` и `fixtures` пуст.
- Зависимость `yaml@^2.9.1` (devDependency, ISC, без транзитивных) — причина указана в design T-1, требование SECURITY §18 выполнено.

## T-1 — итерация 2
Вердикт: CHANGES_REQUESTED
Блокер итерации 1 закрыт по сути. Сам проверил линтом через stdin на `tests/deploy/x.test.ts`: `it.skipIf(process.platform === "win32")` проходит; `it.skipIf(true)`, `it.skipIf(process.platform !== "win32")`, `it.skip`, `it.only` падают. Комментарий у `GLICKO_VECTORS` обновлён.
### Блокеры
- [eslint.config.js:113-128] Новый блок ослабил запрет `.skip` в `tests/deploy/` по сравнению с общим блоком `VITEST_FILES`. Проверено линтом: в `tests/deploy/` проходят `it.concurrent.skip(...)` и `const s = it.skip; s(...)`. В `apps/server/test/` оба варианта дают ошибку. Причин две. (1) `"vitest/no-disabled-tests": "off"`: правило на `skipIf` не срабатывает (проверено: с ним `skipIf(process.platform === "win32")` даёт rc=0), поэтому выключать его не нужно. При этом TESTING §11 разрешает снимать его только для 7.5 (вид C). (2) В блоке пропал селектор `MemberExpression[...][property.name=/^(only|skip|todo)$/]`. → Что сделать: удалить строку `"vitest/no-disabled-tests": "off"`; вернуть в `no-restricted-syntax` блока селектор `MemberExpression[object.name=/^(it|test|describe|suite)$/][property.name=/^(only|skip|todo)$/]` из общего блока; в первом селекторе блока оставить `bench`, как в общем. Проверить, что `it.concurrent.skip` и `const s = it.skip` падают, а `it.skipIf(process.platform === "win32")` проходит. Пункт чек-листа 2а (TESTING §1, §11).
### Желательно
- Позже (исполнитель не трогал, оставлено по указанию оркестратора): все пункты «Желательно» итерации 1 — `groupOrder: 3` → TESTING §6, примечание про `test:affected` и `deploy-image` (→ architect-apply), явный `exclude` у `deploy-image`.

## T-1 — лимит раундов
k = 4 > 3. Выбор Ivan (2026-11-08): (1) подсказка и ещё 2 раунда.

## T-1 — итерация 3
Вердикт: APPROVE
Блокер итерации 2 закрыт. Блок `tests/deploy/**/*.ts` (eslint.config.js:112-131) больше не выключает `vitest/no-disabled-tests`; селектор `MemberExpression` вернулся; для `it.concurrent.*` добавлен свой селектор. Сам проверил линтом через stdin на `tests/deploy/x.test.ts`. Без ошибок проходят `it.skipIf(process.platform === "win32")`, `it(...)`, `it.concurrent(...)`. Ошибку дают `it.skipIf(true)`, `it.skip`, `it.concurrent.skip`, `const s = it.skip`, `describe.only`, `it.todo`, `it.runIf(true)`. TESTING §1 и §11 соблюдены.
### Блокеры
- нет
### Желательно
- [eslint.config.js:123] Сообщение у селектора `concurrent` не упоминает `.runIf`, хотя селектор его ловит. Это косметика.
- Позже: пункты «Желательно» итерации 1 — `groupOrder: 3` → TESTING §6, примечание про `test:affected` и `deploy-image` (→ architect-apply), явный `exclude` у `deploy-image`.

## T-2 — итерация 1
Вердикт: APPROVE
Проверено: сделано всё, что требуют design П4 и П9, OPERATIONS §6.1, §6.2, §6.3, §7 и SECURITY §6, построчно. Значения CSP и остальных четырёх заголовков совпадают дословно; `-Server` на месте, директивы `log` нет, порт 9464 не проксируется. В Dockerfile, compose и allowlist нет ни секретов, ни ПДн. В `ARG`/`ENV` только `APP_VERSION`. `.dockerignore` закрывает `.env*`, `.claude` (в том числе `settings.local.json`), `.git`, `docs`. O33 у `app`, `app-staging`, `tools-staging` выполнено: `user 1000:1000`, `cap_drop ALL`, `no-new-privileges`, `read_only`, `tmpfs /tmp`. Наружу опубликованы только порты `edge`, остальные на `127.0.0.1`. Нет `privileged`, `docker.sock` и bind-mount, кроме Caddyfile `:ro`. Лимиты сверены с таблицей §6.1. Файлы образа принадлежат root, процесс запускается от `node`. Каталог `/data/screenshots` — 1000:1000, 700; именованный том при создании получает владельца из образа. `REPO_ROOT` и `MIGRATIONS_DIR` (`apps/server/src/platform/config.ts:28`, `db.ts:18`) в образе разрешаются в `/app` и `/app/apps/server/migrations`, оба каталога скопированы. Тесты tester не изменены: `git diff` и `git status` по `tests`, `fixtures`, `apps/server/test`, `packages/chess/test` пусты.
Отступления исполнителя:
- (1) Заглушка `${*_IMAGE:-chezz.invalid/unset/...}` (`deploy/compose.yml:64`, `:103`, `:145`). Принимаю. Без неё при пустых `compose.*.env` команда `docker compose` не разбирает конфиг: у сервиса нет ни `image`, ни `build`. Тогда `ps`, `rm` и `stop` после `bootstrap.sh` не работают. Домен `.invalid` не разрешается (RFC 6761), поэтому `up` и `pull` с заглушкой ничего не запустят. Таблица OPERATIONS §6.1 при этом указывает `${PROD_APP_IMAGE}` без значения по умолчанию, это записано в «Желательно».
- (2) Удаление `*.test.ts` и `packages/*/scripts` из цели `app` (`deploy/Dockerfile:38-39`). Принимаю. Это прямо вытекает из §6.2 («только prod-зависимости», без тестов и скриптов). В рантайме `packages/protocol/scripts` (`dump.ts`, `snapshot.ts`) не импортируется: на них ссылаются только npm-скрипты пакета.
### Блокеры
- нет
### Желательно
- [deploy/compose.yml:64, :103, :145] Значение по умолчанию `chezz.invalid/unset/...` не упомянуто в OPERATIONS §6.1. Нужно дописать туда строку о назначении заглушки: `ps` и `rm` при пустых `compose.*.env`, а `up` и `pull` падают → architect-apply.
- [deploy/compose.yml:90] `db` получает `env_file: prod.env` целиком, а значит и `GOOGLE_CLIENT_SECRET` с `COOKIE_SECRET`, которые ему не нужны. Так прямо задано в OPERATIONS §6.1 («пароль и URL в одном файле»), поэтому это не блокер. Минимальные права можно получить так: передавать `db` только `POSTGRES_PASSWORD`, например через `environment` или отдельный файл. Это решение уровня документа → architect-apply, при желании.
- [deploy/Dockerfile:9; deploy/compose.yml `postgres:18`, `caddy:2`] Базовые образы не закреплены digest. Это соответствует документам. Нужно проверить, что в T-5 Dependabot покрывает и `Dockerfile` (экосистема `docker`), а не только `docker-compose`: иначе обновления `node:24-bookworm-slim` будут приходить только при пересборке.
- [deploy/Dockerfile:32-35] В `runtime` при `npm ci --omit=dev` ставятся и prod-зависимости workspace `apps/web` (react и прочие). В рантайме сервера они не нужны, образ без них стал бы меньше. Это вкусовое замечание.
- Изменены файлы `deploy/` (`Dockerfile`, `compose.yml`, `Caddyfile`, `env.allowlist`): diff — Ivan до push (O36).
- Предложение tester из log.md (таймауты у `docker port`, `docker inspect`, `docker run` в AC-5 `image.image.test.ts`) — к tester, позже.
