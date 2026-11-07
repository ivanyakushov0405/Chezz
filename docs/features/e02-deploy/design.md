# Design: E02 Выкатка — VPS, образ, `deploy.yml`, `load.yml`

Версия 0.1 · 2026-11-08 · architect (режим design). Вход: `requirements.md` v0.1 (утверждён Ivan; ответы Ivan на вопросы 1–5 — в «Обзоре»). Размер M, UI нет, риск high.

## Обзор решения

Эпик даёт файлы выкатки и проверяет их тестами без настоящего VPS. Ничего в prod не меняется до мержа: prod и VPS ещё нет, первую выкатку делает Ivan (С1).

Что в эпике:
1. Образ `deploy/Dockerfile` (цели `app`, `tools`), корневой `.dockerignore`, `deploy/compose.yml`, `deploy/Caddyfile`, `deploy/env.allowlist` — T-2.
2. Скрипты на VPS `deploy/remote/` (`entry.sh`, `deploy.sh`, `backup.sh`, `staging-ttl.sh` и общая библиотека) — T-3.
3. `deploy/bootstrap.sh`, `deploy/systemd/` — T-4.
4. `.github/workflows/deploy.yml`, `.github/workflows/load.yml`, `docker-compose` в `.github/dependabot.yml` — T-5.
5. Тесты инфраструктуры — новый уровень `deploy` в `tests/deploy/` (A1). У Vitest для него два проекта. `deploy` (без Docker-демона и сети) входит в `npm run test:unit` и поэтому идёт в CI без правки `ci.yml`. `deploy-image` (Docker-демон и сеть) запускается вручную. Проекты, скрипты и зависимость `yaml` в корневых конфигах заводит T-1 (зона backend: корневые конфиги правит она).

Ответы Ivan на вопросы `requirements.md` учтены так:
- **В1:** `deploy/backup.age.pub` в E02 не создаётся. `backup.sh` без него работает в режиме `local` (OPERATIONS §14.1 это уже допускает: `offsite` включается при наличии файла и `B2_*`). Ветка `offsite` — заглушка с ошибкой «offsite: E20» (код 1). Строку профиля «Эпик «Выкатка»» с `backup.age.pub` правит Ivan (F8) — см. «Открытые вопросы».
- **В2:** в режиме `local` на VPS хранятся 3 последних дампа, общие для `daily` и `pre-deploy` (§14.1 без изменений). Расхождение с ТЗ §5 («14 дней») остаётся до этапа 4.
- **В3:** GHCR — открытый вопрос Ivan; план написан под рекомендуемый вариант (а): после первой публикации Ivan вручную делает пакеты Public. Чтобы этот случай было видно, введён код 8 `pull_failed` (A3).
- **В4:** `scripts/ops/` — не в E02 (E20).
- **В5:** ROADMAP — не задача architect.

Сквозные решения (ADR-0011):
- одна блокировка `flock` на VPS для обеих сред и таймеров;
- новые коды 8 `pull_failed` и 9 `locked`;
- порядок «сначала все проверки, потом изменения» в `deploy`/`up`;
- переменные `CHEZZ_ROOT`/`CHEZZ_BACKUP_DIR` для запуска скриптов в тестах;
- уровень тестов `deploy`.

### Ответы на вопросы architect (A1–A10)

**A1. Чем проверять AC.** Тесты tester лежат в `tests/deploy/**/*.test.ts` (новый уровень, правка TESTING §1, §5, §6). У Vitest два проекта (T-1):

| Проект | Что | Требует | Где запускается |
|---|---|---|---|
| `deploy` | статический разбор файлов (YAML через `yaml`, Caddyfile и Dockerfile как текст, `docker compose … config --format json`, `bash -n`); запуск `deploy/remote/*.sh`, `bootstrap.sh` и `run:`-блоков workflow в `bash` с подменой внешних команд через `PATH` | `bash` (на Windows — Git Bash), `git`, `jq` (только тесты `run:`-блоков `deploy.yml`), Docker CLI (только `compose config`; демон не нужен) | `npm run test:unit` → CI job `check`; локально `npx vitest run --project deploy` |
| `deploy-image` | `docker build` обеих целей, проверка образа (`image inspect`, `run`), запуск `app` с тестовой БД (AC-5), `caddy validate` в `caddy:2` (AC-14), `shellcheck -S error` в `koalaman/shellcheck:v0.10.0` (AC-45) | Docker-демон, сеть (базовые образы, npm), `npm run db:test:up` | `npm run test:deploy-image` — проверка задачи T-2 и T-3 и прогон перед PR; в CI не входит (`ci.yml` не меняется, AC-64) |

- Права файлов (600/640/700) проверяются только на POSIX. На Windows (NTFS + Git Bash) `chmod` ничего не делает, поэтому такие утверждения — `it.skipIf(process.platform === "win32")`. Их выполняет CI (Linux). Это исключение TESTING §1 вносится правкой. Владельца (`chown deploy:ops`) тесты не проверяют: без root его не выставить. Группу `ops` файлы получают от setgid-каталогов (T-4), а скрипты сами `chown` не вызывают.
- `affected-tests` (`vitest --changed`) не видит изменений `*.sh`, `*.yml` и `Dockerfile`: они не входят в граф модулей. Поэтому прогон задач T-2…T-5 — `npx vitest run --project deploy` (плюс `npm run test:deploy-image` в T-2, T-3), а не `test:affected`.
- `shellcheck` — уровень `error`, только в `deploy-image` и в самопроверке devops. `systemd-analyze verify` не используется: на Windows и в CI-runner без systemd он недоступен. AC-49 проверяется статическим разбором юнитов (поля и значения ниже).
- Домены в тестах — `chezz.test` (зарезервированный TLD), владелец — `test-owner`. Литерала `example.com` нет нигде.

**A2. Пустые и обязательные секреты.** В stdin приходят строки `KEY=VALUE`. Пустое значение означает «не задан в environment», и такой ключ **не пишется** в файл. Это соответствует `loadConfig`: пустая строка = не задано. Обязательные ключи (`required` в `env.allowlist`) без значения дают код 2, и ничего не меняется. Обязательные:
- `[prod]`: `APP_ENV` (= `prod`), `APP_ORIGIN`, `DATABASE_URL`, `POSTGRES_PASSWORD`;
- `[ops]`: `APP_DOMAIN`, `ACME_EMAIL`, `SENTRY_INGEST`;
- `[staging]`: `APP_ENV` (= `staging`), `APP_ORIGIN`, `DATABASE_URL`, `POSTGRES_PASSWORD`, `SEED_TOKEN_SECRET`.

Остальные (`GOOGLE_*`, `COOKIE_SECRET`, `SENTRY_DSN`, `RATE_LIMIT_IP_PER_MIN`, `TELEGRAM_*`, `B2_*`, `BACKUP_REQUIRE_OFFSITE`) — `optional`. В E04 `GOOGLE_*` и `COOKIE_SECRET` станут `required` — это правка `env.allowlist` в задаче E04. `APP_ENV` не равно имени среды → код 2.

**A3. `docker pull` не удался.** Новый код 8 `pull_failed`: образ не скачан (сеть, приватный пакет, нет digest), ничего не изменено. `/release` сообщает Ivan: «проверить видимость пакета GHCR, повторить». Тот же код у `staging up` и `load`. Внутри `restore_prev` неудачный pull — это провал отката, код 4.

**A4. Провал первой выкатки (нет `prod.image.prev`).** `restore_prev` не выполняется. Вместо него `docker compose … stop app`, клон возвращается на `prod.repo.prev` (он есть всегда: шаг 7 записывает его до `checkout`), `state/prod.image` удаляется. Итог — строка `restore=no_prev`, код 4 `broken`. После этого повтор `bootstrap=true` проходит: база не проверяется, staging до успешной выкатки снова даёт 7.

**A5. Блокировка.** Одна блокировка `flock` на файл `$CHEZZ_ROOT/state/lock` для обеих сред, удерживает её процесс под `setsid`. Поэтому после обрыва SSH (EC-28) она держится до конца команды. Ожидание — до 900 с (`flock -w 900`), не дождался → код 9 `locked`, ничего не изменено. Без блокировки выполняется только `status` (только чтение). Таймеры: `chezz-backup.service` — `flock -w 900`, `chezz-staging-ttl.service` — `flock -w 60`. `backup.sh` сам блокировку не берёт: при выкатке её уже держит `deploy.sh`. Дополнительно `load.yml` — `concurrency: deploy-staging`, общая группа с `deploy.yml env=staging`.

**A6. Dependabot `docker-compose`.** Добавляется в T-5 (`/deploy`, weekly). `.github/dependabot.yml` не в `workflows/`, но относится к `.github/` → diff Ivan по O36.

**A7. Ключи и ref для `bootstrap.sh`.** Аргументами после `bash -s --`:
```
ssh root@<ip> 'bash -s -- \
  --repo-url https://github.com/<owner>/chezz.git \
  --ops-key "ssh-ed25519 AAAA… ivan" \
  --ci-prod-key "ssh-ed25519 AAAA… ci-prod" \
  --ci-staging-key "ssh-ed25519 AAAA… ci-staging" \
  --ops-password-hash "$6$…"' < deploy/bootstrap.sh
```
Ключи — открытые (не секрет), в репозиторий не попадают. Формат проверяется: `^ssh-ed25519 [A-Za-z0-9+/]+={0,3}( [A-Za-z0-9._@-]+)?$`; `--repo-url` — `^https://github\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+\.git$`; хэш — `^\$6\$`. Неверный аргумент или его нет → код 2, система не меняется. Хэш пароля для `sudo` у `ops` — `openssl passwd -6` на машине Ivan. Клон: `git clone --branch main` в `/srv/chezz/repo`; при повторном запуске существующий клон не трогается. Дальше клон переключает только `prod deploy` (O9).

**A8. Том `screenshots`.** В образе `app` каталог `/data/screenshots` принадлежит `node:node` (1000:1000) и имеет права 700. Docker копирует владельца в пустой именованный том при первом монтировании. compose: `app` — `screenshots:/data/screenshots`; `app-staging` — `tmpfs: /data/screenshots:uid=1000,gid=1000,mode=0700,size=256m`. Переменную пути задаёт эпик скриншотов (E18); до него `app` в каталог не пишет.

**A9. `status` staging.** Ровно ключи: `env=staging`, `image=<digest app-staging|none>`, `tools_image=<digest|none>`, `repo=<sha клона>`, `health=healthy|unhealthy|starting|absent`, `restarts=<n>`, `started_at=<state/staging.started|none>`, `staging=up|down`.

**A10. `force=true` при `env=staging` или `action≠deploy`.** Отказ в `plan`, как остальные сочетания EC-1.

## Выжимка правил для этой фичи

**devops (T-2…T-5)**
- Выкатка, откат, staging, нагрузка — только `deploy.yml`/`load.yml`; агентам — нет SSH, ключей, значений секретов (OPERATIONS §1, SECURITY §16).
- Секреты — только environments; в `run:` — только через `env:` шага, не job; нет `set -x`, `echo`/`printenv` с секретами (OPERATIONS §1, §7; SECURITY §17).
- Входы `workflow_dispatch` — только через `env:`; `env`, `action` — `choice`; `image` по `^sha256:[0-9a-f]{64}$` (OPERATIONS §1, §9.2).
- Триггеры и `permissions` — по OPERATIONS §8, §9.2, §11 (проверяет `scripts/check-workflows.sh`); `uses:` — по полному SHA; `checkout` — `persist-credentials: false`.
- Цикл O45 — inline в `deploy.yml`; `plan` и `build` не запускают файлов репозитория (OPERATIONS §9.2а).
- В job с environment код ветки идёт только после всех SSH-шагов; после него SSH не вызывается (OPERATIONS §1, §9.6).
- compose: порты наружу только у `edge` (80, 443, 443/udp), остальное — `127.0.0.1`; ужесточение O33; нет `privileged`, `docker.sock`, bind-mount, кроме `Caddyfile:ro` у `edge` (OPERATIONS §1, §6.1).
- Caddy: заголовки SECURITY §6 дословно; без `log`; 9464 не проксируется (OPERATIONS §6.3, SECURITY S32).
- Образ: без секретов в `ARG`/`ENV`; `APP_VERSION` — SHA (OPERATIONS §6.2).
- Клон переключает только `prod deploy` (и `restore_prev`); команды staging клон не меняют (OPERATIONS §1, O9).
- Коды 0–9 и строка `result=` — последняя строка вывода (OPERATIONS §9.3 с правкой этого design).
- В `deploy/**`, `.github/**` нет `example.com`, IP, ключа хоста, логина владельца, e-mail (OPERATIONS §1, §17).
- `.github/workflows/**` коммитит Ivan; diff `.github/`, `deploy/` — Ivan перед push (O36, O43).

**tests (tester, шаг 1 каждой задачи)**
- Тест на каждый AC/EC задачи с номером в имени (TESTING §1, §4); не читать реализацию — только этот design (TESTING §4).
- Без сети наружу и `.skip`; исключения — проект `deploy-image` (сеть для `docker build`) и `it.skipIf(process.platform === "win32")` для прав файлов (правка TESTING §1 этого design).
- Тесты не зависят друг от друга: каждый готовит свой `CHEZZ_ROOT` в `mkdtemp` (TESTING §1).

**backend (T-1)**
- Корневые конфиги — только свой блок (профиль, «Метки задач»); новая зависимость — с причиной (SECURITY §18).

## Публичные интерфейсы для тестов

### П1. Запуск bash из тестов (Windows и Linux)
Скрипты запускаются через `bash`. На Windows — `process.env.CHEZZ_BASH ?? "C:\\Program Files\\Git\\bin\\bash.exe"`, иначе `bash` (WSL-`bash.exe` из `System32` не подходит). Подменные команды — исполняемые bash-файлы без расширения в каталоге, который ставится первым в `PATH`. Помощник пишет tester в `tests/deploy/support/`.

### П2. Окружение скриптов VPS
| Переменная | По умолчанию | Что |
|---|---|---|
| `CHEZZ_ROOT` | `/srv/chezz` | `$CHEZZ_ROOT/repo` (клон), `$CHEZZ_ROOT/env`, `$CHEZZ_ROOT/state` |
| `CHEZZ_BACKUP_DIR` | `/var/backups/chezz` | дампы |
| `SSH_ORIGINAL_COMMAND` | — | команда (П3) |

- Владелец образов: `git -C "$CHEZZ_ROOT/repo" config --get remote.origin.url` → `github.com[:/]<owner>/` → `ghcr.io/<owner в нижнем регистре>`. Тест задаёт `remote.origin.url=https://github.com/Test-Owner/chezz.git`; fetch можно перенаправить на локальный bare-репозиторий через `url.<путь>.insteadOf`.
- Внешние команды через `PATH`: `docker`, `curl`, `git`, `setsid`, `flock`, `sleep`, `df`. Остальные — встроенные `bash` и coreutils. Вызовы тест распознаёт по ключевым словам ниже; другие флаги допустимы.

| Вызов | Ключевые слова в argv | Ответ подмены |
|---|---|---|
| compose | `docker compose -p chezz -f $CHEZZ_ROOT/repo/deploy/compose.yml --env-file …/compose.staging.env --env-file …/compose.prod.env` (prod-файл последним), затем подкоманда | — |
| сервис запущен? | `ps -q --status running <сервис>` | непустой stdout = запущен |
| подъём | `up -d --wait --wait-timeout 120` + `edge db app` / `app` / `app-staging db-staging` | код 0/≠0 |
| гашение staging | `--profile staging rm -sfv app-staging db-staging` | — |
| остановка (A4) | `stop app` | — |
| сид | `run --rm tools-staging node apps/server/scripts/seed.ts --demo` | код |
| нагрузка | `run --rm -e LOAD_REPORT=/tmp/report.json tools-staging sh -c …` | stdout — отчёт, код |
| дамп | `exec -T db pg_dump -U app -d chezz -Fc` | stdout — байты дампа, код |
| pull | `docker pull ghcr.io/<owner>/<пакет>@sha256:…` | код (≠0 → 8 или 4) |
| метка | `docker image inspect` + `org.opencontainers.image.revision` + ref | stdout — SHA |
| контейнер | `docker inspect` + `chezz-app-1` (prod) / `chezz-app-staging-1` и `RestartCount` / `Health.Status` / `StartedAt` | stdout; ≠0 = нет контейнера |
| prune | `docker image prune -af --filter until=168h` | — |
| метрики | `curl` + `http://127.0.0.1:9464/metrics` (prod), `:9465` (staging) | текст Prometheus; ≠0 = не отвечает |
| health | `curl` + `-D -` (или `--dump-header`) + `https://<APP_DOMAIN>/api/health` | заголовки + тело |
| git | `rev-parse HEAD`, `fetch origin main`, `merge-base --is-ancestor <sha> origin/main`, `checkout --detach <sha>`, `config --get remote.origin.url` | можно настоящий git |
| ожидание | `sleep 60` (проверка г) | подмена — сразу 0 |
| диск | `df -P` | строка `df` |
| блокировка | `flock -w 900 <$CHEZZ_ROOT/state/lock> …` | подмена: выполнить остаток argv или вернуть 1 (занято) |
| сессия | `setsid …` | подмена: `exec "$@"` |

### П3. `deploy/remote/entry.sh <prod|staging>`
- Команда — из `$SSH_ORIGINAL_COMMAND`; секреты — stdin, строки `KEY=VALUE`, до EOF.
- Белый список (иначе код 2, `result=bad_command`): prod — `deploy <sha40> <digest> <sha40|bootstrap> [force]`, `rollback [<digest>]`, `status`; staging — `up <digest> <digest>`, `down`, `load`, `status`. SHA `^[0-9a-f]{40}$`, digest `^sha256:[0-9a-f]{64}$`; лишний аргумент, пустая команда, метасимволы — код 2.
- Копирует каталог `deploy/remote/`, в котором лежит сам, в `mktemp -d` и выполняет копию (EC-29). Журнал — `$CHEZZ_ROOT/state/last-<среда>.log` (перезаписывается), stdout entry — тот же журнал. Последняя строка — `result=<имя>`, код выхода — по таблице.

| Код | `result` |
|---|---|
| 0 | `ok` |
| 1 | `rolled_back` (prod) / `up_failed` (staging) |
| 2 | `bad_command` |
| 3 | `prod_busy` |
| 4 | `broken` |
| 5 | `backup_failed` |
| 6 | `base_mismatch` |
| 7 | `prod_missing` |
| 8 | `pull_failed` (новый) |
| 9 | `locked` (новый) |

- Дополнительные строки вывода: `backup=ok|skipped_no_db`, `restore=no_prev` (A4); у `load` — отчёт между строками `report_begin` и `report_end`.

### П4. Секреты и `deploy/env.allowlist`
- Формат: разделы `[prod]`, `[ops]`, `[staging]`; строка — `ИМЯ required|optional`; `#` — комментарий; значений нет.
- Содержимое (OPERATIONS §7 + A2): `[prod]` — `APP_ENV required`, `APP_ORIGIN required`, `DATABASE_URL required`, `POSTGRES_PASSWORD required`, `GOOGLE_CLIENT_ID optional`, `GOOGLE_CLIENT_SECRET optional`, `COOKIE_SECRET optional`, `SENTRY_DSN optional`. `[ops]` — `APP_DOMAIN required`, `ACME_EMAIL required`, `SENTRY_INGEST required`, `TELEGRAM_BOT_TOKEN optional`, `TELEGRAM_CHAT_ID optional`, `B2_KEY_ID optional`, `B2_APP_KEY optional`, `B2_BUCKET optional`, `BACKUP_REQUIRE_OFFSITE optional`. `[staging]` — `APP_ENV required`, `APP_ORIGIN required`, `DATABASE_URL required`, `POSTGRES_PASSWORD required`, `SEED_TOKEN_SECRET required`, `GOOGLE_CLIENT_ID optional`, `GOOGLE_CLIENT_SECRET optional`, `COOKIE_SECRET optional`, `SENTRY_DSN optional`, `RATE_LIMIT_IP_PER_MIN optional`.
- prod принимает ключи `[prod]` ∪ `[ops]`, staging — только `[staging]`. Код 2: ключ не из списка, ключ не `^[A-Z][A-Z0-9_]*$`, строка без `=`, повтор ключа, значение с `$`, `'`, `"`, `` ` ``, `\` (строка-продолжение после `\n` — «строка без `=`»), обязательный пуст или отсутствует, `APP_ENV` ≠ имени среды.
- Куда пишется: `[prod]` → `env/prod.env` (600); `APP_DOMAIN`, `ACME_EMAIL`, `SENTRY_INGEST` + `PROD_APP_IMAGE` → `env/compose.prod.env` (640); прочие `[ops]` → `env/ops.env` (640); `[staging]` → `env/staging.env` (600); `env/compose.staging.env` (640) — ровно 2 строки AC-25. Пустые `optional` не пишутся. Запись — временный файл в том же каталоге + `mv`.

### П5. Состояние `$CHEZZ_ROOT/state/`
| Файл | Формат |
|---|---|
| `prod.image`, `prod.image.prev` | одна строка `sha256:<64 hex>` |
| `prod.repo.prev` | одна строка, SHA 40 hex |
| `prod.history` | строки `<UTC ISO-8601 Z> <digest> <sha> deploy\|restore\|rollback` (у `restore`/`rollback` — `revision` цели) |
| `staging.started` | одна строка `<UTC ISO-8601 Z>` |
| `last-backup` | одна строка `<UTC ISO-8601 Z>` |
| `last-prod.log`, `last-staging.log` | журнал последней команды |
| `lock` | файл блокировки |

### П6. Порядок `deploy` prod (заменяет OPERATIONS §9.4 п.0–10, правка ниже)
1. Разбор и проверка секретов (2). 2. Занятость `chezz_games_active` > 10 без `force` (3; метрики нет или `curl` ≠ 0 → 0). 3. База: не `bootstrap` и `git rev-parse HEAD` ≠ base (6); `fetch`; `<sha>` не предок `origin/main` (2). 4. `docker pull` (8); метка `revision` ≠ `<sha>` (2). 5. `db` не запущен → `backup=skipped_no_db`; иначе `backup.sh --reason pre-deploy` (5). До этого шага **ничего** не изменено (state, env, клон). 6. Запись env-файлов (`PROD_APP_IMAGE` прежний). 7. `prod.repo.prev` ← HEAD; `checkout --detach <sha>`. 8. `prod.image` → `prod.image.prev`; новый → `prod.image` и `PROD_APP_IMAGE`; строка `deploy` в `prod.history`. 9. staging запущен → `rm -sfv app-staging db-staging`. 10. `up … edge db app`. 11. Проверки а–г (`sleep 60` перед г). 12. Провал 10/11: есть `prod.image.prev` → `restore_prev` (вернуть клон) → 1 / 4; нет → A4 → 4. 13. `image prune` → 0.
- `rollback`: цель (`<digest>` из `prod.history` или `prod.image.prev`, иначе 2) → pull (4 при сбое) → текущий → `prod.image.prev`, строка `rollback` → `restore_prev` без клона → 0 / 4.
- staging `up`: аргументы (2) → нет `state/prod.image` (7) → секреты (2) → pull обоих (8) → запись `staging.env`, `compose.staging.env` → `rm -sfv` → `up … app-staging db-staging` → сид `--demo` → `staging.started`; сбой после pull → 1.
- staging `load`: `app-staging` не запущен → 2; `games_active` prod > 2 → 3; иначе `run … tools-staging` (команда OPERATIONS §11 п.2), отчёт между `report_begin`/`report_end`; код ≠ 0 генератора → 1.
- `down`: `rm -sfv` → 0 (и при уже погашенном). `deploy/remote/staging-ttl.sh`: `staging.started` старше 12 ч → `down` и удаление файла; иначе 0.

### П7. `deploy/remote/backup.sh --reason daily|pre-deploy`
- Читает `env/ops.env`; переменная окружения `BACKUP_REQUIRE_OFFSITE` перекрывает файл (её передаёт `deploy.sh` из новых секретов).
- Режим: `deploy/backup.age.pub` есть и `B2_KEY_ID` не пуст → `offsite` → в E02 ошибка `offsite: not implemented (E20)`, код 1; иначе `local`. `local` + `BACKUP_REQUIRE_OFFSITE=true` → код 1, дампа нет.
- `local`: `mkdir -m 700`; дамп в `$CHEZZ_BACKUP_DIR/chezz-<YYYYMMDDTHHMMSSZ>-<reason>.dump.partial` → `mv` в `.dump`; остаются 3 новейших `chezz-*.dump` (сортировка по имени); `.partial` после сбоя удаляется (`trap`); `state/last-backup` — только при успехе. Коды: 0 / 1.

### П8. `status`
- prod — ровно ключи OPERATIONS §9.3 в этом порядке; метрик нет → `players_online=0`, `games_active=0`; бэкапов нет → `last_backup=none`; `backup_mode` — по правилу П7; `image`/`revision` без `prod.image` → `none`. staging — ключи A9. Последняя строка — `result=ok`.

### П9. Образ и compose
- Dockerfile: `FROM node:24-bookworm-slim`, цели `app`, `tools`; `WORKDIR /app`; `ARG APP_VERSION` → `ENV APP_VERSION` и `LABEL org.opencontainers.image.revision=$APP_VERSION`; у `app` — `ENV HOST=0.0.0.0 METRICS_HOST=0.0.0.0`, `EXPOSE 3000 9464`, `USER node`, `CMD ["node","--enable-source-maps","apps/server/src/main.ts"]`, статика — `/app/apps/web/dist` (с `*.map`), `/data/screenshots` (1000:1000, 700). У `tools` — `USER node`, есть `/app/apps/server/scripts/seed.ts`, `/app/node_modules/vitest`.
- compose: сервисы, сети, тома, лимиты — OPERATIONS §6.1 (имена дословно: `edge`, `app`, `db`, `app-staging`, `db-staging`, `tools-staging`; сети `edge-prod`, `edge-staging`, `prod`, `staging`; тома `pgdata`, `screenshots`, `caddy_data`, `caddy_config`). `env_file` — `${CHEZZ_ROOT:-/srv/chezz}/env/prod.env` / `staging.env`. Тест: `CHEZZ_ROOT=<tmp> docker compose -p chezz -f deploy/compose.yml --env-file <tmp>/env/compose.staging.env --env-file <tmp>/env/compose.prod.env [--profile staging] config --format json` (файлы env в tmp создаёт тест). Caddyfile монтируется `./Caddyfile:/etc/caddy/Caddyfile:ro`.
- `deploy-image`, AC-5: `app` с `--add-host host.docker.internal:host-gateway` и `DATABASE_URL` на `host.docker.internal:54329` (`db:test:up`), отдельная база теста.
- Caddy: `docker run --rm -e APP_DOMAIN=chezz.test -e ACME_EMAIL=ops@chezz.test -e SENTRY_INGEST=o0.ingest.sentry.io -v <repo>/deploy/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`.

### П10. `bootstrap.sh` и `deploy/systemd/`
- Аргументы — A7. `BOOTSTRAP_ROOT` (по умолчанию пусто) — префикс ко всем путям файлов (`/etc`, `/srv`, `/var`, `/swapfile`) для тестов.
- Внешние команды (все подменяются): `apt-get`, `curl`, `gpg`, `dpkg`, `useradd`, `usermod`, `groupadd`, `getent`, `id`, `chown`, `ufw`, `systemctl`, `fallocate`, `mkswap`, `swapon`, `sshd`, `git`. Существование пользователя или группы — по коду `getent`/`id`.
- Файлы (с префиксом): `/home/deploy/.ssh/authorized_keys` — ровно 2 строки OPERATIONS §5 п.1 (перезаписывается целиком); `/home/ops/.ssh/authorized_keys` — ключ `--ops-key`; `/etc/ssh/sshd_config.d/00-chezz.conf` — `PasswordAuthentication no`, `PermitRootLogin no`, `AllowUsers ops deploy` (перед перезапуском `sshd -t`); `/etc/docker/daemon.json`; `/etc/systemd/journald.conf.d/chezz.conf`; `/etc/apt/apt.conf.d/52chezz-unattended` (`Automatic-Reboot "false"`, только security); `/etc/fstab` — строка `/swapfile none swap sw 0 0` один раз; `/swapfile` 2G; каталоги — таблица OPERATIONS §5 п.7, у `/srv/chezz/env` и `/srv/chezz/state` setgid (2750); пустые `compose.prod.env`, `compose.staging.env` — только если их нет; юниты копируются в `/etc/systemd/system/`, `systemctl enable --now chezz-backup.timer chezz-staging-ttl.timer`.
- `ufw`: `default deny incoming`, `allow 22/tcp`, `allow 80/tcp`, `allow 443/tcp`, `allow 443/udp`, `--force enable`.
- Юниты: `chezz-backup.timer` — `OnCalendar=*-*-* 03:30:00 UTC`, `Persistent=true`; `chezz-backup.service` — `Type=oneshot`, `User=deploy`, `ExecStart=/usr/bin/flock -w 900 /srv/chezz/state/lock /srv/chezz/repo/deploy/remote/backup.sh --reason daily`; `chezz-staging-ttl.timer` — `OnCalendar=*:0/30`; `chezz-staging-ttl.service` — `Type=oneshot`, `User=deploy`, `ExecStart=/usr/bin/flock -w 60 /srv/chezz/state/lock /srv/chezz/repo/deploy/remote/staging-ttl.sh`. `chezz-watch.*` нет.

### П11. Workflow (`yaml`-разбор и запуск `run:`-блоков)
- `deploy.yml`: входы AC-51; `run-name`, `concurrency` AC-51. Job и шаги с `id`:
  - `plan` (выход `base`): `validate`, `base`, `diff`, `prs`;
  - `build` (выходы `app_digest`, `tools_digest`): `build`;
  - `prod`: `ssh`;
  - `staging`: `ssh-up`, `checkout`, `npm-ci`, `browsers`, `smoke` (при `action=deploy`), `ssh-down` (при `action=down`).
- В `run:` нет `${{ … }}`: тест выполняет блок дословно в `bash -e` с переменными:
  - `validate`: `IN_ENV`, `IN_ACTION`, `IN_IMAGE`, `IN_FORCE`, `IN_BOOTSTRAP` (`true|false`), `GIT_REF` (`github.ref`); код ≠ 0 — для каждого сочетания EC-1 и A10 (EC-2 проверяет шаг `base`); `prod` требует `GIT_REF=refs/heads/main`.
  - `base`: `IN_ENV`, `IN_ACTION`, `IN_BOOTSTRAP`, `GH_TOKEN`; вызывает `gh run list` (AC-53); пишет в `$GITHUB_OUTPUT` `base=<sha|bootstrap>` и `list_base=<sha|>`; нет успешного `prod deploy` без bootstrap → код ≠ 0 с текстом `bootstrap=true`. Для `staging` и `rollback` — `base=` пустой, без вызова `gh`.
  - `diff`: `BASE`, пишет в `$GITHUB_STEP_SUMMARY` (`git diff --stat` или при `bootstrap` — `git ls-files deploy/ .github/` и «bootstrap: проверка базы пропущена»).
  - `prs`: `LIST_BASE`, `GH_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_STEP_SUMMARY`; пустой `LIST_BASE` при bootstrap → «bootstrap: список PR не строится»; вызывает `gh api repos/<repo>/commits/<sha>/pulls -q <фильтр>` и `gh pr view <N> --json … -q <фильтр>`. Подмена `gh` применяет фильтр `-q` настоящим `jq -r` к JSON-фикстуре. Итог — таблица §9.2а и строка `PR: N, коммитов вне PR: M` или «новых коммитов нет».
- `load.yml`: `on: workflow_dispatch` без входов; `concurrency: deploy-staging` без `cancel-in-progress: true`; job `plan` (шаг `validate` без входов: проверок сочетаний нет, код 0), `build`, `load` (`environment: staging`; шаги `ssh-up`, `ssh-load`, `ssh-down` с `if: always()`; без `uses:`/`checkout`).
- `build`: метки `org.opencontainers.image.revision` (из `APP_VERSION`) и `org.opencontainers.image.source=https://github.com/<repo>` (из `GITHUB_REPOSITORY` в env), тег `sha-<sha>`, `docker buildx build --push --metadata-file`; вход в GHCR — `GITHUB_TOKEN` шага через `--password-stdin`; сторонних actions, кроме `actions/checkout`, нет.

### Сквозные e2e-сценарии
Нет. UI нет; `@smoke` уже есть (E01) и выполняется только в job `staging` после первой выкатки (Ivan). Задачи `[e2e]` нет; финальный прогон перед PR — `npx vitest run --project deploy` и `npm run test:deploy-image`.

## Изменения документов основ

Вносятся в режиме apply после утверждения этого design.

### OPERATIONS.md
1. Строка статуса: добавить в начало «Версия 0.8 от 2026-11-08 — apply E02 (design E02 утверждён Ivan): 5, 6.1, 7, 9.2, 9.3, 9.4, 9.5, 11, 14.1; решения O46, O47; ADR-0011.»
2. §3.3, в конец таблицы:
   `| O46 | Одна блокировка `flock` на VPS для команд обеих сред и таймеров (ожидание ≤ 900 с, иначе код 9 `locked`); `docker pull` не удался — код 8 `pull_failed`; `deploy`/`up` сначала выполняют все проверки, затем меняют состояние (9.4) | design E02 (A3, A5); ADR-0011 | `concurrency` GitHub — не видит таймеров и команд разных групп |`
   `| O47 | Пустой секрет environment — ключ не пишется; обязательные ключи — `required` в `env.allowlist`, без значения — код 2 (7) | design E02 (A2) | Код 2 на любой пустой — не выкатить до E04 и этапа 4 |`
3. §5, после п.8 добавить:
   «Запуск: `ssh root@<ip> 'bash -s -- --repo-url https://github.com/<owner>/chezz.git --ops-key "<ключ Ivan>" --ci-prod-key "<ключ>" --ci-staging-key "<ключ>" --ops-password-hash "<openssl passwd -6>"' < deploy/bootstrap.sh`. Ключи — открытые, в репозиторий не попадают; неверный аргумент — код 2 без изменений. Клон — `git clone --branch main`; существующий клон, `*.env` и `authorized_keys` `ops` не перезаписываются (`authorized_keys` `deploy` пересобирается ровно из двух строк). `/srv/chezz/env` и `/srv/chezz/state` — setgid (2750): файлы получают группу `ops` без `chown`. `sshd` перезапускается после `sshd -t`. `deploy/backup.age.pub` до E20 нет — бэкап в режиме `local` (14.1).»
4. §6.1: после строки «Профиль `staging` — у трёх staging-сервисов.» добавить:
   «- `env_file` — `${CHEZZ_ROOT:-/srv/chezz}/env/<файл>`. Том `screenshots` монтируется в `/data/screenshots` (в образе — `node:node`, 700); у `app-staging` там `tmpfs` с `uid=1000,gid=1000,mode=0700`.»
5. §7: в таблице строка `APP_DOMAIN, ACME_EMAIL, SENTRY_INGEST`: колонку «Раздел» заменить на «ops → `compose.prod.env`; vars `prod`». После абзаца «Файлы на VPS: …» добавить:
   «- `env.allowlist`: строка — `ИМЯ required|optional`. Пустое значение (секрет не задан) — ключ не пишется; `required` без значения или `APP_ENV` ≠ среды — код 2 (O47). `required`: `[prod]` `APP_ENV`, `APP_ORIGIN`, `DATABASE_URL`, `POSTGRES_PASSWORD`; `[ops]` `APP_DOMAIN`, `ACME_EMAIL`, `SENTRY_INGEST`; `[staging]` то же, что `[prod]`, и `SEED_TOKEN_SECRET`. `GOOGLE_*`, `COOKIE_SECRET` становятся `required` в E04.
   - Ключи `[ops]` `APP_DOMAIN`, `ACME_EMAIL`, `SENTRY_INGEST` пишутся в `compose.prod.env` (с `PROD_APP_IMAGE`), остальные `[ops]` — в `ops.env`.»
6. §9.2: в таблице, строка `plan`, после «`prod` не с `main` → ошибка;» вставить «`force=true` при `env=staging` или `action≠deploy`, `bootstrap=true` при `env=staging` или `action≠deploy`, `image` при `action≠rollback` → ошибка;». В строку `build` после «выход — digest» добавить «; метки `revision` и `org.opencontainers.image.source` (связь пакета с репозиторием, 16.1 п.7)».
7. §9.3: первый абзац дополнить: «Команды, кроме `status`, выполняются под одной блокировкой `flock -w 900 /srv/chezz/state/lock` для обеих сред (её держит процесс под `setsid`; таймеры 14.1 и 9.6 берут ту же); не дождался — код 9 (O46). Владелец образов — из `remote.origin.url` клона. Корень `/srv/chezz` и каталог бэкапов переопределяются `CHEZZ_ROOT`, `CHEZZ_BACKUP_DIR` (тесты, ADR-0011).» В таблицу кодов добавить:
   `| 8 | `pull_failed` | образ не скачан (сеть, пакет GHCR приватный), ничего не изменено | сообщить Ivan: проверить видимость пакета, повторить |`
   `| 9 | `locked` | другая команда на VPS идёт дольше 15 мин, ничего не изменено | повторить позже, сообщить Ivan |`
   После блока `status` добавить: «Для staging: `env=staging`, `image`, `tools_image`, `repo`, `health`, `restarts`, `started_at` (из `state/staging.started` или `none`), `staging=up|down`.»
8. §9.4: список п.0–10 заменить на П6 этого design (пункты 1–13 дословно, с кодами); пример и абзац после списка — без изменений.
9. §9.5: после «5. Проверки 9.4 п.8 …» добавить: «Нет `prod.image.prev` (провал первой выкатки): `restore_prev` не выполняется — `stop app`, клон ← `prod.repo.prev`, `state/prod.image` удаляется, вывод `restore=no_prev`, код 4; повтор — `bootstrap=true`. `docker pull` цели не удался — код 4.»
10. §9.6 п.1: «секреты → `staging.env`; шаблон → `compose.staging.env`;» заменить на «проверка секретов → `docker pull` обоих образов (код 8) → секреты → `staging.env`; шаблон → `compose.staging.env`;».
11. §11: после первого абзаца добавить «`concurrency: deploy-staging` (общая с `deploy.yml env=staging`), без отмены. `load` при неподнятом `app-staging` — код 2; отчёт выводится между строками `report_begin` и `report_end`.»
12. §14.1, абзац `local`: после «без выгрузки.» добавить «Файл пишется как `….dump.partial` и переименовывается после успеха; неполный удаляется. До E20 файла `deploy/backup.age.pub` нет, ветка `offsite` в `backup.sh` завершается ошибкой.»

### TESTING.md
1. Строка статуса: «Версия 0.7 от 2026-11-08: apply E02 — 1, 5, 6, решение V24; ADR-0011.»
2. §3.2, в конец таблицы:
   `| V24 | Тесты инфраструктуры выкатки — уровень `deploy` в `tests/deploy/` (tester): проекты Vitest `deploy` (разбор файлов, скрипты VPS с подменой команд через `PATH`; входит в `test:unit`) и `deploy-image` (Docker-демон, сеть; `npm run test:deploy-image`, не в CI) | design E02 (A1); ADR-0011 | Только ручные проверки devops — AC без тестов (раздел 1); bats — ещё раннер |`
3. §1, пункт про `.only`/`.skip`: «Единственное исключение — `it.skipIf` для векторов вида C в `glicko2-vectors.test.ts` (7.5).» → «Исключения — `it.skipIf` для векторов вида C в `glicko2-vectors.test.ts` (7.5) и `it.skipIf(process.platform === "win32")` для проверок прав файлов в `tests/deploy/` (V24; их выполняет CI).»
4. §1, пункт про сеть: дописать «Исключение — проект `deploy-image` (`docker build`, базовые образы; V24).»
5. §5, таблица, после строки «нагрузка»:
   `| инфраструктура выкатки | `deploy/**`, `.dockerignore`, `.github/workflows/{deploy,load}.yml`: разбор, скрипты VPS с подменой команд, сборка образа | `tests/deploy/`; утилиты — `tests/deploy/support/` | `*.test.ts` | tester | `deploy`; `deploy-image` (V24) |`
6. §6, таблица, после `npm run test:unit`: строка `| `npm run test:deploy-image` | `vitest run --project deploy-image` — сборка образа, `caddy validate`, `shellcheck` (V24) | Docker запущен, `db:test:up` |`; строку `npm run test:unit` — «`vitest run --project unit --project web --project deploy`». Под списком проектов добавить: «`deploy` — `tests/deploy/**/*.test.ts` без `*.image.test.ts`, нужны `bash` (Windows — Git Bash, путь `CHEZZ_BASH`), `git`, `jq`, Docker CLI; `deploy-image` — `tests/deploy/**/*.image.test.ts`. Изменения `*.sh`, `*.yml`, `Dockerfile` `test:affected` не видит — прогон задач зоны devops: `npx vitest run --project deploy`.»

### ARCHITECTURE.md
1. §13.2, в блок после `tests/load/`: строка `tests/deploy/                тесты выкатки (F6 V24, ADR-0011)`.
2. §13.3: `remote/ … entry.sh, watch.sh, backup.sh …` → `remote/ … entry.sh, deploy.sh, backup.sh, staging-ttl.sh; watch.sh — этап 4`; строка `env.allowlist, backup.age.pub` → `env.allowlist; backup.age.pub — с E20 (F7 §14.1)`.
3. §16, таблица ADR: `| ADR-0011 | Контракт скриптов VPS: блокировка, коды 8/9, проверки до изменений, тесты выкатки | `docs/adr/0011-vps-scripts-contract.md` |`.

### ADR — `docs/adr/0011-vps-scripts-contract.md` (новый)
```markdown
# ADR-0011. Контракт скриптов VPS: блокировка, коды, порядок шагов, тесты выкатки

Статус: предложено (architect, E02 design, 2026-11-08).

## Контекст
OPERATIONS §9 задаёт команды на VPS и коды 0–7, но не определяет: что делать при параллельных командах разных сред (`concurrency` GitHub разделяет `deploy-prod` и `deploy-staging`, а таймеры его не видят); код при неудачном `docker pull` (первая публикация GHCR создаёт приватный пакет); порядок шагов, при котором отказ не оставляет полуизменённое состояние (в 9.4 клон переключался до `pull`). TESTING §1 требует тест на каждый AC, а уровня тестов для `deploy/**` и workflow не было. Тесты идут на Windows (Git Bash) и в CI (Linux).

## Решение
1. Одна блокировка `flock -w 900 /srv/chezz/state/lock` для всех команд обеих сред, кроме `status`, и для таймеров. Её держит процесс под `setsid`, поэтому обрыв SSH её не снимает. Не дождался — код 9 `locked`.
2. Код 8 `pull_failed`: образ не скачан, ничего не изменено.
3. `deploy` prod и `up` staging сначала выполняют все проверки (аргументы, секреты, занятость, база, предок, `pull`, метка, бэкап), затем меняют env, клон и state. Отказ до изменений не меняет ничего.
4. Скрипты VPS читают корень из `CHEZZ_ROOT` (по умолчанию `/srv/chezz`), каталог бэкапов — из `CHEZZ_BACKUP_DIR`. Внешние команды вызываются по имени через `PATH`. `bootstrap.sh` — префикс путей `BOOTSTRAP_ROOT`.
5. Тесты выкатки — уровень `deploy` (`tests/deploy/`, tester). Проект Vitest `deploy` (без демона и сети, в `test:unit` → CI) и `deploy-image` (сборка образа, `caddy validate`, `shellcheck`; вручную). `run:`-блоки workflow не содержат `${{ }}`, поэтому тест выполняет их дословно.

## Последствия
- Выкатка prod ждёт идущего подъёма staging (и наоборот) до 15 мин вместо гонки за `rm -sfv`.
- `/release` различает «пакет приватный» (8) и «неверный вход» (2).
- Переменные корня — не режим «только для тестов» в `app` (TESTING §1 их запрещает именно в `app`): на VPS их нет, действуют значения по умолчанию.
- Изменения `*.sh` и workflow не видит `vitest --changed`: в задачах devops прогон — `--project deploy`. Права файлов на Windows не проверяются (`it.skipIf`), их проверяет CI.
- `docker build` не входит в CI до отдельного решения; Dockerfile проверяют `deploy-image` в задаче и job `build` при выкатке.
- Альтернативы: `flock` только внутри среды — гонка `prod deploy` и `staging up`; код 2 на неудачный `pull` — Ivan не отличит приватный пакет от ошибки входа; bats для тестов — второй раннер и нет Windows-сборки в `npm`.
```

## Решения (ADR)
| Решение | Альтернативы | Почему |
|---|---|---|
| Уровень тестов `deploy`, два проекта Vitest (ADR-0011 п.5) | bats; только ручные проверки; всё в одном проекте с Docker | один раннер (V1); AC покрыты тестами; CI не ждёт `docker build` |
| `deploy` в `test:unit` (правка `package.json`), `ci.yml` не меняется | новый шаг в `ci.yml` | AC-64; `ci.yml` пушит только Ivan |
| Одна `flock` на VPS, код 9 (A5) | `flock` на среду; без блокировки | гонка гашения staging при выкатке prod; таймеры |
| Код 8 `pull_failed` (A3) | код 2 | первая публикация GHCR приватна — нужен отдельный сигнал |
| Проверки до изменений (П6) | порядок 9.4 как есть | в 9.4 клон переключается до `pull` — отказ оставлял клон на новом SHA |
| Пустой секрет — пропуск, `required` в allowlist (A2) | код 2 на пустой; писать `KEY=` | до E04 и этапа 4 часть секретов не задана; пустое `KEY=` и пропуск для `loadConfig` равнозначны, пропуск проще проверить |
| `[ops]` содержит `APP_DOMAIN`, `ACME_EMAIL`, `SENTRY_INGEST` → `compose.prod.env` | четвёртый раздел | AC-22 требует ровно три раздела |
| Первая выкатка без prev — `stop app`, код 4 `restore=no_prev` (A4) | оставить `app` в цикле перезапусков; код 1 | prod не работает — это `broken`; повтор `bootstrap=true` возможен |
| `bootstrap.sh` — аргументы `bash -s --` (A7) | переменные окружения; ключи в репозитории | ключей в репозитории нет (§5); аргументы проверяются до изменений |
| `docker buildx` inline, без `docker/*` actions | `docker/build-push-action` | меньше сторонних SHA; digest — из `--metadata-file` |
| `load.yml` — `concurrency: deploy-staging` | своя группа | вторая линия к `flock` от одновременных `up` |

## Выкатка и откат
- Мерж E02 prod не меняет: VPS и prod ещё нет. ⛔ этапа 5 — без `deploy-staging` (O40; профиль). Перед `git push` — diff `.github/`, `deploy/` Ivan (O36); `.github/workflows/**` и `.github/dependabot.yml` в том же коммите — коммитит и пушит Ivan.
- После мержа — только Ivan, по порядку: правила 16.1, 16.3, токен 16.2 → `bootstrap.sh` (A7) → vars `VPS_HOST`, `VPS_HOST_KEY` → `gh workflow run deploy.yml --ref main -f env=prod -f bootstrap=true` → после первого `build` пакет `chezz-app` сделать Public (вопрос Ivan 1) → подтвердить `prod` → `result=ok` → staging `--ref main` (пакеты `chezz-*-staging` — Public после их первого `build`) → `action=down` → запись в `log.md`.
- Откат эпика до первой выкатки — revert-PR. После первой выкатки — `action=rollback` (9.5).

## План задач

### T-1 [backend:platform] Риск: low
Проекты Vitest `deploy` и `deploy-image`, скрипты, зависимость `yaml`, tsconfig `tests/deploy`.
- Файлы: `vitest.config.ts` (проект `deploy`: `tests/deploy/**/*.test.ts` без `**/*.image.test.ts`, `environment: node`, `testTimeout: 30_000`, `groupOrder: 0`; проект `deploy-image`: `tests/deploy/**/*.image.test.ts`, `testTimeout: 900_000`, `maxWorkers: 1`); `package.json` — `test:unit` += `--project deploy`, `test:deploy-image`, devDependency `yaml` (причина: разбор workflow в тестах выкатки); `package-lock.json`; `tsconfig.json` — ссылка `tests/deploy`; `tests/deploy/tsconfig.json` (как у `tests/e2e`, `lib: ["es2024"]`, `types: ["node"]`, `include: ["**/*.ts"]`); `eslint.config.js` — `tests/deploy/**` с правилами Vitest (как тесты сервера).
- Шаг tester — нет (каталог пуст, `passWithNoTests`).
- AC: `npm run check` зелёный; `npx vitest run --project deploy` и `--project deploy-image` — 0 тестов, код 0; `npm run test:unit` запускает три проекта.
- Проверка: `npm run check`.

### T-2 [infra] Риск: high
Образ, compose, Caddy, allowlist.
- Файлы: `deploy/Dockerfile`, `.dockerignore`, `deploy/compose.yml`, `deploy/Caddyfile`, `deploy/env.allowlist`.
- AC requirements: AC-1…AC-16, AC-22; EC-37, EC-38, EC-39 (статически: `read_only`, `tmpfs`), EC-35 (`restart`).
- Публичные интерфейсы: П4 (формат allowlist), П9.
- Тесты tester: `tests/deploy/image.static.test.ts`, `compose.test.ts`, `caddy.test.ts`, `allowlist.test.ts` (проект `deploy`); `tests/deploy/image.image.test.ts`, `caddy.image.test.ts` (проект `deploy-image`).
- Проверка: `npx vitest run --project deploy`; `npm run db:test:up && npm run test:deploy-image`; самопроверка devops — `docker build -f deploy/Dockerfile --target app --build-arg APP_VERSION=$(git rev-parse HEAD) .` и `--target tools`.

### T-3 [infra] Риск: high
Скрипты на VPS.
- Файлы: `deploy/remote/entry.sh`, `deploy/remote/deploy.sh`, `deploy/remote/backup.sh`, `deploy/remote/staging-ttl.sh`, `deploy/remote/lib.sh` (общие функции; имя внутреннее).
- AC: AC-17…AC-21, AC-23…AC-44 (кроме AC-22), AC-45 для `deploy/remote/*.sh`; EC-8, EC-9, EC-10 (A2), EC-11…EC-23, EC-25 (на VPS), EC-26…EC-29, EC-31 (A5), EC-33, EC-38 (шаблон `compose.staging.env`), плюс коды 8, 9 и A4: тесты `"A3: pull не удался → 8"`, `"A4: провал первой выкатки → 4, restore=no_prev"`, `"A5: блокировка занята → 9"`, `"A9: status staging"`.
- Публичные интерфейсы: П2…П8.
- Тесты tester: `tests/deploy/remote/*.test.ts` (проект `deploy`), `tests/deploy/shellcheck.image.test.ts`.
- Проверка: `npx vitest run --project deploy`; `npm run test:deploy-image`; `bash -n deploy/remote/*.sh`.

### T-4 [infra] Риск: high
Первичная настройка VPS.
- Файлы: `deploy/bootstrap.sh`, `deploy/systemd/chezz-backup.service`, `chezz-backup.timer`, `chezz-staging-ttl.service`, `chezz-staging-ttl.timer`.
- AC: AC-45 (`bootstrap.sh`), AC-46…AC-49; EC-35 (таймеры `enable`), EC-36; A7 (неверный аргумент → 2, без изменений).
- Публичные интерфейсы: П10.
- Тесты tester: `tests/deploy/bootstrap.test.ts`, `tests/deploy/systemd.test.ts`.
- Проверка: `npx vitest run --project deploy`; `bash -n deploy/bootstrap.sh`; `npm run check` (`check-architecture.sh` — `example.com`).

### T-5 [ci] Риск: high
Workflow выкатки и нагрузки, Dependabot.
- Файлы: `.github/workflows/deploy.yml`, `.github/workflows/load.yml`, `.github/dependabot.yml` (+ `docker-compose`, `/deploy`, weekly). `ci.yml`, `check-workflows.sh` не меняются (если `check-workflows.sh` не пропускает корректный файл — правка в этой задаче с объяснением).
- AC: AC-50…AC-63, AC-64; EC-1…EC-7, EC-24, EC-30, EC-32 (нет `cancel-in-progress`), EC-40, EC-41; A10; A6.
- Публичные интерфейсы: П11; SSH-шаг передаёт секреты `printf '%s=%s\n'` в stdin `ssh -i "$RUNNER_TEMP/…" -o StrictHostKeyChecking=yes -o UserKnownHostsFile=… deploy@"$VPS_HOST" "<команда>"`.
- Тесты tester: `tests/deploy/workflows/deploy.static.test.ts`, `deploy.plan.test.ts` (выполнение `validate`, `base`, `diff`, `prs` в temp-репозитории с подменой `gh`), `load.test.ts`, `dependabot.test.ts`.
- Проверка: `bash scripts/check-workflows.sh`; `npx vitest run --project deploy`; `npm run check`. Коммит и push `.github/**` — Ivan.

Порядок: T-1 → T-2 → T-3 → T-4 → T-5. T-3 зависит от T-2 только через `env.allowlist` (читается скриптами).

## Риски и открытые вопросы

**Открытые вопросы Ivan**
1. **GHCR: видимость пакетов при первой публикации** (вопрос Ivan 3 `requirements.md`). Первая публикация `GITHUB_TOKEN` создаёт пакет приватным; VPS тянет без токена.
   - (а) **Рекомендую.** При первом запуске каждого пакета (`chezz-app` — первая выкатка prod; `chezz-app-staging`, `chezz-tools-staging` — первый staging) Ivan после job `build` делает пакет Public (Package settings → Change visibility) и только затем подтверждает environment. Пропустил окно → `result=pull_failed` (код 8), ничего не изменено; сделать Public и повторить. Один раз на пакет, репозиторий и так публичный, секретов на VPS нет (16.1 п.7).
   - (б) pull с токеном: classic PAT `read:packages` в `ops.env` и `docker login` на VPS. Ещё секрет на VPS с ротацией, PAT даёт чтение всех пакетов учётной записи. Правка §6.2, §7, SECURITY §17.
   - (в) первую публикацию сделать вручную с машины Ivan (`docker push`) — локальный доступ к GHCR, против профиля «Выкатка».
2. **Задача T-1 `[backend:platform]` в эпике «Выкатка».** Профиль задаёт только `[infra]` → `[ci]`, но проекты Vitest и `yaml` правит зона backend (корневые конфиги). Подтвердить T-1 или указать другой путь (например, разрешить devops блок `deploy` в `vitest.config.ts`/`package.json` — правка профиля F8).
3. **Профиль F8:** в «Эпик «Выкатка»» убрать `backup.age.pub` (В1: E20) и добавить в прогон задач devops `npx vitest run --project deploy` вместо `test:affected` (ADR-0011). Профиль правит Ivan.
4. **`jq` локально.** Тесты `run:`-блоков `deploy.yml` требуют `jq` в Git Bash (`winget install jqlang.jq`); в CI он есть. Нужно один раз на машине Ivan до T-5.
5. **`docker build` в CI** (не в E02): Dependabot будет обновлять базовые образы без сборки в PR; ошибку увидит только `build` при выкатке. Предлагаю отдельной задачей `[ci]` после E02 добавить job сборки в `ci.yml` — решение Ivan.

**Риски**
- R-a (high): на VPS ни один скрипт не запускался — первая выкатка и есть интеграционный тест (§6.1 compose, `flock`/`setsid`, hairpin-запрос на свой домен в проверке б). Смягчение: проверки до изменений (П6), A4, повтор `bootstrap=true`.
- R-b: Node.js запускает TS workspace-пакетов (`packages/*`) из `node_modules` только по реальному пути (симлинки npm workspaces); `npm ci --omit=dev` в образе должен сохранить симлинки — devops проверяет запуском AC-5.
- R-c: `bootstrap.sh` отключает вход root — ошибка в `sshd_config` или ключе `ops` закрывает доступ. Смягчение: `sshd -t` до перезапуска, проверка формата ключей, консоль провайдера.
- R-d: Let's Encrypt — лимит неудачных проверок при неготовом DNS (R8 `requirements.md`).
- Отступление: `systemd-analyze verify` (AC-49) заменён статическим разбором юнитов (A1).
