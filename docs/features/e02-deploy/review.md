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

## T-3 — итерация 1
Вердикт: CHANGES_REQUESTED
### Блокеры
- [deploy/remote/deploy.sh:130-133, 149-152 (deploy_apply шаг 6)] Если провал случился на шаге 6 (запись env), клон ещё не менялся, а `prod.repo.prev` хранит значение от прошлой выкатки; `restore_prev ... 1` делает `checkout` на этот устаревший коммит, и клон расходится с работающим образом → писать `prod.repo.prev` до шага 6 либо передавать в `restore_prev` признак «клон не менялся» (OPERATIONS §9.5, П6 п.12).
- [deploy/remote/entry.sh:66, 68] Перенаправление `> "$JOURNAL"` выполняется до ожидания `flock`. Вторая команда (и `status`, он без блокировки) обнуляет `last-<среда>.log` работающей команды; её `entry.sh` затем читает чужой журнал, и `result=` в stdout может не соответствовать коду выхода → писать во временный файл в `$STATE_DIR` и `mv` в журнал после получения блокировки (или `status` — в stdout без журнала). Требуется блокировка обеих сред и достоверная строка `result=` (A5, OPERATIONS §9.3).
- [deploy/remote/deploy.sh:150, lib.sh:55] OPERATIONS §5 (стр. 176): «`deploy.sh` пересоздаёт пустой файл, если его нет» (`compose.prod.env`, `compose.staging.env`). Не сделано: без `compose.staging.env` любой `compose` (шаг 10) падает на `--env-file` → создавать пустые файлы (640) в начале изменений.
### Желательно
- Отступления 1–4 приняты: (1) allowlist целевого коммита обоснован, код 3 вместо 2 при двух неполадках допустим; (2) возврат прежнего `prod.image.prev` верен; (3) `down` с игнором `rm` безвреден (TTL повторит); (4) `result=broken`/`up_failed` при отсутствии строки верно.
- Проверено без замечаний: белый список entry.sh (`[a-z0-9: ]` + точные формы), нет `set -x`, секреты не печатаются (в сообщениях только имена ключей), `atomic_write` (mktemp + chmod + mv, 600/640), коды 0–9, порядок проверок до изменений (fetch меняет только refs).
- `.github/`, `deploy/` изменены: diff — Ivan до push (O36).

## T-3 — итерация 2
Вердикт: APPROVE
### Блокеры
- Нет. Блокеры итерации 1 закрыты: (1) `CLONE_SWITCHED` ставится перед `checkout`, `restore_prev` возвращает клон только по нему (deploy.sh:147, 178); (2) журнал обнуляется и пишется под `flock`, `status` его не трогает, `bad_command`/`locked` дописываются через `>>` (entry.sh:21-31, 91); (3) `ensure_compose_env_files` создаёт пустые файлы с правами 640.
- Ловушка EXIT: `RESULT_DONE=0` задан до ловушки; `finish` ставит 1, поэтому при штатном выходе ловушка сразу возвращается и код выхода сохраняется; второго `result=` нет. На аварийном выходе `finish` в ловушке печатает один `result=` (повторный запуск ловушки при `exit` внутри неё не происходит).
### Желательно
- `.github/`, `deploy/` изменены: diff — Ivan до push (O36).

## Ревью эпика (остаток T-4, T-5)
Вердикт: CHANGES_REQUESTED

Проверено построчно: `deploy/bootstrap.sh`, `deploy/systemd/*`, `.github/workflows/deploy.yml`, `load.yml`, `.github/dependabot.yml` (рабочее дерево, не закоммичены), `tests/deploy/{bootstrap,systemd}.test.ts`, `tests/deploy/workflows/*`, `tests/deploy/support/workflow.ts`; стыки с `entry.sh` и `env.allowlist`. Прогнал сам: `bash scripts/check-workflows.sh` (ok, 3 файла), `npx vitest run --project deploy` по workflows, bootstrap и systemd (154 passed, 2 skipped).

Без замечаний:
- В `run:` нет `${{ }}`; выражения есть только в `run-name`, `concurrency` и `env:`. `secrets.*` встречаются только в `env:` шагов. `set -x`, `printenv` и вывода значений нет. Секреты уходят `printf '%s=%s\n'` прямо в stdin `ssh`, без файла. Ключ и `known_hosts` создаются под `umask 077` в `$RUNNER_TEMP`, `trap … EXIT` ставится до записи. Везде `StrictHostKeyChecking=yes`, `UserKnownHostsFile` и `BatchMode=yes`.
- Права: на верхнем уровне `permissions: {}`. Права у `plan`, `build`, `prod`, `staging`, а также `needs` и `if` у `prod` и `staging` совпадают с §9.2 дословно. `build` работает только при `deploy`. EC-1: при провале `plan` остальные job пропускаются.
- Job `staging`: `ssh-up` идёт первым, за ним `checkout`, `setup-node`, `npm ci`, `browsers`, `smoke`. После кода ветки SSH не вызывается: `ssh-down` выполняется только при `action=down`, а тогда шаги с кодом ветки не запускаются (OPERATIONS §1, §9.6 п.4, EC-40). Отклонения (`setup-node`, `--with-deps`) приняты в design П11.
- Цикл O45 по смыслу совпадает с §9.2а: `--first-parent --reverse`, `SEEN` для rebase-мержа, экранирование `|<>`` ` `` в заголовке, теме и авторе. Добавлены только счётчики N/M, итоговая строка и «новых коммитов нет». `gh` вызывается внутри `PR=$(…)`, поэтому сбой при `-eo pipefail` роняет шаг (fail-closed).
- Ключи в stdin SSH-шагов совпадают с `env.allowlist`: в `prod` это `[prod]∪[ops]`, в `ssh-up` и `load` — `[staging]`. `APP_ENV` задан литералом среды. Команды SSH проходят белый список `entry.sh`: для `deploy` это 4 или 5 аргументов, для `rollback` — 1 или 2, для `up` — 3, для `down`, `load`, `status` — 1. Маркеры `report_begin` и `report_end` (`deploy.sh:332,337`) совпадают с разбором в `ssh-load`.
- `load.yml`: только `workflow_dispatch`, `concurrency: deploy-staging` без отмены. В `load` только SSH-шаги, `ssh-down` — с `if: always()` (EC-24).
- `bootstrap.sh`: аргументы и `id -u` проверяются до любых изменений (код 2). `exec </dev/null` стоит сразу после разбора, весь скрипт — функции и `main` в последней строке, поэтому `bash -s` stdin не съедает. `sshd` настраивается последним, `sshd -t` выполняется до `restart` под `set -e` (R-c). Файл `00-chezz.conf` читается раньше `50-cloud-init.conf`. `ufw allow 22/tcp` стоит до `--force enable`. Повторный запуск ничего не портит: `fstab` правится через `grep -qxF`, клон, `*.env` и `authorized_keys` `ops` не трогаются, `authorized_keys` `deploy` пересобирается целиком. Ключи и URL проходят регулярные выражения, поэтому подставить кавычку или опцию в `command=` нельзя.
- Юниты совпадают с П10 дословно. `backup.sh` и `staging-ttl.sh` сами блокировку не берут, взаимной блокировки нет. Бит `x` есть у `bootstrap.sh`, `entry.sh`, `backup.sh`, `staging-ttl.sh`.
- В новых файлах нет `example.com`, IP, ключей хоста, логина владельца. В комментарии есть только имя «Ivan»: это не логин, оно есть и в документах.
- `dependabot.yml`: добавлен `docker-compose` для `/deploy`, weekly. Экосистема `docker` для `/deploy` уже была, так что Dockerfile покрыт (закрыт пункт «желательно» из T-2).

### Блокеры
- [deploy/bootstrap.sh:3-4] Команда запуска из комментария не работает. Внутри внешних одинарных кавычек хэш стоит в двойных: `--ops-password-hash "<openssl passwd -6>"`. Строку исполняет оболочка root на VPS, и `$6$<salt>$<hash>` в двойных кавычках раскрывается (`$6` — пустой позиционный параметр, `$<salt…>` — пустая переменная). Проверено: `bash -c 'printf "[%s]\n" "$6$Ab.cd/ef$XyZ"'` даёт `[.cd/ef]`. Поэтому `HASH_RE` не проходит, и первый bootstrap по инструкции всегда завершается кодом 2. Отказ безопасный, но AC-46 и A7 по документированному запуску не выполнимы. Та же ошибка в `docs/OPERATIONS.md:183` (§5, «Запуск:») и в `design.md:66` (A7), так что код повторил документ. → В комментарии `bootstrap.sh` заменить на `--ops-password-hash '\''<хэш openssl passwd -6>'\''` (одинарные кавычки внутри внешних) и дописать строку «хэш содержит `$` — только в одинарных кавычках». OPERATIONS §5 и design A7 поправить так же → architect-apply. По желанию добавить в `bootstrap.test.ts` тест, который передаёт аргументы через `bash -c '<строка из комментария>'`. (Чек-лист 2 — корректность; OPERATIONS §5; design A7.)

### Желательно
- [.github/workflows/deploy.yml:145] `for C in $(git rev-list … "$LIST_BASE"..HEAD)` не роняет шаг при сбое `git rev-list`: статус подстановки в списке `for` `set -e` не проверяет. Если `LIST_BASE` нет в клоне, цикл пустой, и в итог попадает «новых коммитов нет» — fail-open контроля O45. Без `bootstrap` это перекрыто: раньше падает шаг `diff` на `git diff "$BASE..HEAD"`. Открыт случай EC-3 (`bootstrap=true` с найденной базой): `diff` её не использует. Практически это закрывает ruleset (переписать `main` нельзя). → Перед циклом добавить `git cat-file -e "$LIST_BASE^{commit}" || { echo "::error::нет коммита $LIST_BASE"; exit 1; }`. Цикл §9.2а при этом не меняется.
- [.github/workflows/deploy.yml:198-205, load.yml:49-56] Digest берётся из `--metadata-file` (`containerimage.digest`) при драйвере buildx `docker` (`setup-buildx-action` нет). От версии Docker на runner и хранилища образов зависит, что окажется в этом поле: digest манифеста или индекса (с provenance) либо, в старых сборках, ID образа. Если там не тот digest, VPS даёт `pull_failed` (код 8). Это безопасно, но выкатка встанет. → На первом `staging deploy` сверить digest из итога с `docker buildx imagetools inspect ghcr.io/<owner>/chezz-app-staging:sha-<sha>`. При расхождении брать digest из `imagetools inspect --format '{{json .Manifest}}' | jq -r .digest` после push.
- [.github/workflows/deploy.yml:261, 325, 373; load.yml:103, 122, 147] Добавить к `ssh` `-o IdentitiesOnly=yes -o ConnectTimeout=30 -o ServerAliveInterval=60`. Команда может до 900 с ждать `flock` без вывода, и без keepalive её может оборвать NAT. Обрыв сам по себе безопасен (`setsid`), но шаг краснеет, а `result=` теряется.
- [.github/workflows/load.yml:147-148] `ssh-down` не обрамляет вывод в итоге блоком ```` ``` ````, в отличие от остальных шагов. Косметика.
- [deploy/bootstrap.sh:84-85] `ufw` не входит в `apt-get install`. В Ubuntu 24.04 (O2) он есть по умолчанию, но на минимальном образе провайдера `ufw default deny` упадёт под `set -e` до настройки `sshd`. Безопасно, но непонятно. → Добавить `ufw` в список пакетов.
- [deploy/bootstrap.sh:123] Хэш пароля `ops` передаётся аргументом и во время запуска виден в `ps` на VPS. Пока пользователей, кроме root, нет, это допустимо. Отметить в OPERATIONS §5 → architect-apply, по желанию.
- O36: изменены `deploy/` (`bootstrap.sh`, `systemd/*`) и `.github/` (`dependabot.yml`, `workflows/deploy.yml`, `workflows/load.yml`): diff показать Ivan до push. `.github/workflows/**` коммитит и пушит Ivan, не оркестратор.

### Позже
- Job `staging`: код ветки (`npm ci`, smoke) работает на том же runner после шага с `SSH_DEPLOY_KEY` staging. Секреты job остаются в памяти `Runner.Worker` и с `sudo` на runner читаются (так было при инциденте tj-actions). «Секрет на уровне шага» — не барьер против кода ветки. Это внутри принятого риска SECURITY §17 (секреты staging ничего не дают для prod, ключ ограничен `command=` staging), поэтому не блокер. Если риск будут пересматривать (этап 5), разнести SSH и smoke по разным job → architect-apply.
- Из брифа: shellcheck для `bootstrap.sh`, `docker build` в `ci.yml`, таймауты docker в `image.image.test.ts`, `db` получает весь `prod.env`, `groupOrder: 3` и `deploy-image` в TESTING §6.
