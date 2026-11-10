# E02: Выкатка — VPS, образ, `deploy.yml`, `load.yml`

Версия 0.1 · 2026-11-08 · analyst (режим feature). Эпик — ROADMAP E02 (KAN-5), размер M, UI нет, риск high (deploy/ci).
Основа: ТЗ §5 («Доступность», «Резервные копии», «Безопасность» — HTTPS), ТЗ §6 («CI/CD», «Хостинг»); OPERATIONS §1, §4–§11, §14.1, §15–§17, §20; ARCHITECTURE §5, §13.3; SECURITY §6, §14, §16, §17; TESTING §9, §10, §12–§14; ADR-0004, ADR-0010; профиль `.claude/profile.md`, «Эпик «Выкатка»».

## Цель

Дать проекту воспроизводимую выкатку на один VPS только через CI: образ `app`/`tools` из `deploy/Dockerfile`, compose-проект `chezz` (prod + профиль `staging`), Caddy с HTTPS и заголовками SECURITY §6, скрипты на VPS с белым списком команд и кодами выхода, первичную настройку VPS (`bootstrap.sh`, юниты systemd), ежедневный локальный бэкап (режим `local`, O35) и два workflow — `deploy.yml` (staging, prod, откат, гашение) и `load.yml` (нагрузка на staging). Пользователи эпика — Ivan (подтверждает выкатки, запускает `bootstrap.sh` и первую выкатку) и оркестратор `/release` (запускает workflow командами OPERATIONS §10). Игрок результат видит косвенно: сайт `https://<домен>` доступен, обновляется без ручной работы на сервере (ТЗ §5 «Доступность», ТЗ §6 «CI/CD»).

## Ограничения (от человека)

- Состав и порядок задач — профиль, «Эпик «Выкатка»»; analyst их не переопределяет: сначала `[infra]` — `deploy/Dockerfile`, `.dockerignore`, `deploy/compose.yml`, `deploy/Caddyfile`, `deploy/remote/`, `deploy/bootstrap.sh`, `deploy/systemd/`, `deploy/env.allowlist`, `deploy/backup.age.pub` (ARCHITECTURE §13.3; OPERATIONS §5, §6, §9.3); затем `[ci]` — `.github/workflows/deploy.yml`, `.github/workflows/load.yml` (OPERATIONS §9, §11).
- ⛔ этапа 5 `/feature` — **без** `deploy-staging` из ветки: staging до первой выкатки prod даёт код 7 (O40). Smoke на staging (TESTING §14 п.6) для этого эпика не выполняется; замена — проверки файлов и скриптов в задачах и самопроверка devops `docker build -f deploy/Dockerfile .`.
- После мержа первая выкатка — только Ivan: `bootstrap.sh` → `deploy.yml -f env=prod -f bootstrap=true` → затем staging (OPERATIONS §9.1, O40, O44). Агенты и оркестратор её не запускают; `bootstrap=true`, `image=`, `force=` — только Ivan.
- `.github/workflows/**` агент готовит, коммитит и пушит Ivan сам (O43, TESTING §12). Перед `git push` и `gh pr merge` — diff `.github/`, `deploy/`, `scripts/ops/` Ivan (O36).
- Срок не задан; лимит вызовов агентов — 35 (журнал `log.md`).

## Зависимости (эпики, статус)

| Эпик | Что даёт E02 | Статус |
|---|---|---|
| E01 Скелет | `deploy/compose.test.yml`, `ci.yml`, `scripts/check-workflows.sh` (уже знает права job `plan`/`build` для `deploy`/`load`), правило `example.com` в `check-architecture.sh`, `CODEOWNERS`, `dependabot.yml` (`docker` в `/deploy`), `apps/server` (`main.ts` применяет миграции при старте, `loadConfig`), `apps/web`, `tests/e2e/smoke.spec.ts` с `@smoke`, `E2E_BASE_URL` в `playwright.config.ts`, `seed.ts --demo` (отказ на `APP_ENV=prod`) | сделан (PR #3; в ROADMAP статус ещё «в работе» — обновить) |
| E03 Наблюдаемость | `/metrics` на `METRICS_PORT` (9464) с `app_info{version}` — проверка 9.4 п.8а; `APP_VERSION` обязателен при `APP_ENV` = `prod`/`staging`; `<meta name="chezz-release">`; Sentry сервера и клиента; source maps рядом со статикой | сделан (PR #9; в ROADMAP — «не начат», обновить) |

Блокеров по зависимостям нет. Работа Ivan вне эпика (OPERATIONS §20) — условие **первой выкатки**, не мержа E02: VPS (F7-Q1), домен и DNS (F7-Q2), environments/secrets/vars, ключи SSH выкатки, Sentry, UptimeRobot, настройки GitHub 16.1, правила 16.3, токен 16.2.

## Scope

### Входит

1. **Образ** (`deploy/Dockerfile`, корневой `.dockerignore`) — OPERATIONS §6.2: база `node:24-bookworm-slim`; цель `app` (сервер + собранный `apps/web` с `.map`, только prod-зависимости, `USER node`, `EXPOSE 3000 9464`, `CMD ["node","--enable-source-maps",…]`, `ENV HOST=0.0.0.0 METRICS_HOST=0.0.0.0`); цель `tools` (весь workspace с dev-зависимостями, `USER node`); `ARG APP_VERSION` → `ENV APP_VERSION` и метка `org.opencontainers.image.revision`.
2. **compose** (`deploy/compose.yml`) — OPERATIONS §6.1: сервисы `edge`, `app`, `db`, `app-staging`, `db-staging`, `tools-staging`; сети, порты, тома, лимиты, ужесточение O33, healthcheck, journald.
3. **Caddy** (`deploy/Caddyfile`) — OPERATIONS §6.3, SECURITY §6: два сайта, общий сниппет заголовков, без `log`.
4. **Скрипты на VPS** (`deploy/remote/`): `entry.sh` (разбор `$SSH_ORIGINAL_COMMAND`, копия в `mktemp -d`, `setsid` и журнал), `deploy.sh` (prod `deploy`/`rollback`/`status`, staging `up`/`down`/`load`/`status`, `restore_prev`), `backup.sh` только в режиме `local` и проверка `BACKUP_REQUIRE_OFFSITE` (O35, 14.1). Коды 0–7 и строка `result=` — OPERATIONS §9.3.
5. **Первичная настройка** (`deploy/bootstrap.sh`, `deploy/systemd/`): OPERATIONS §5 п.1–8; юниты `chezz-backup.timer` (03:30 UTC) и `chezz-staging-ttl.timer` (каждые 30 мин) с их сервисами.
6. **Переменные** (`deploy/env.allowlist`): разделы `[prod]`, `[ops]`, `[staging]` по таблице OPERATIONS §7.
7. **`deploy/backup.age.pub`** — по ответу Ivan на вопрос 1 («Открытые вопросы»).
8. **`deploy.yml`** — OPERATIONS §9.2, §9.2а, §9.4–§9.6: входы, `run-name`, `concurrency`, job `plan`/`build`/`prod`/`staging`, список PR O45 inline.
9. **`load.yml`** — OPERATIONS §11: `plan` → `build` (обе цели в `*-staging`) → `load` (environment `staging`, только SSH-шаги, `down` при `if: always()`).

### Не входит / позже

- Режим бэкапа `offsite` (B2, `age`, сообщение Telegram O42), `watch.sh` и `chezz-watch.timer`, проверка восстановления 14.2 — E20 (этап 4).
- `scripts/ops/*` (`status.sh`, `logs.sh`, `ro.sh`, `restore-*.sh`, `backups.sh`, `logout-everyone.sql`, `feedback-recent.sql`) — профиль не включает их в E02; см. вопрос 4.
- `tests/load/run.ts`, `seed.ts --load` — E21. До E21 `load.yml` собирается и проходит `plan`/`build`, но шаг `load` завершается ошибкой (EC-24).
- Метрики `chezz_games_active` (E06), `chezz_players_online` (E22) — до них проверки «занятости» prod считают 0.
- Сид `--demo` с данными — эпики с таблицами (E04…); сейчас пишет «no tables yet».
- Настройки GitHub 16.1, правила 16.3, environments, secrets, vars, пакеты GHCR Public, VPS, домен, UptimeRobot — работа Ivan (OPERATIONS §20), не код.
- Первая выкатка и первый staging — Ivan после мержа.
- Баннер плановых работ (F7-Q5), повтор удалений (F7-Q8).

## Сценарии

Нумерация — для ссылок из `design.md` и тестов. «VPS-скрипт» — `deploy/remote/*.sh`, вызванный через `entry.sh`.

**С1. Первая выкатка (Ivan, после мержа; OPERATIONS §5, §9.1, O40, O44).**
1. Ivan: `ssh root@<ip> 'bash -s' < deploy/bootstrap.sh` — пользователи `ops`/`deploy`, `sshd`, `ufw`, swap, Docker с journald и `live-restore`, пакеты, каталоги и права §5 п.7, клон `/srv/chezz/repo`, пустые `compose.*.env`, таймеры.
2. Ivan заносит `VPS_HOST`, `VPS_HOST_KEY` в vars обоих environments.
3. Ivan: `gh workflow run deploy.yml --ref main -f env=prod -f bootstrap=true`. `plan`: `BASE=bootstrap`, в итоге — полный `git ls-files deploy/ .github/`, пометка «bootstrap: проверка базы пропущена» и «bootstrap: список PR не строится» (успешного `prod deploy` нет). `build` публикует `chezz-app@sha256:…`.
4. Ivan подтверждает environment `prod`. SSH: `deploy <sha> <digest> bootstrap` + секреты в stdin → шаги 9.4 п.0–10: `app` не отвечает → занятость 0; база не проверяется; `db` не запущен → `backup=skipped_no_db`; `up -d --wait edge db app`; проверки п.8 а–г; `result=ok`, код 0.

**С2. Выкатка prod (OPERATIONS §9.1 шаг 5, §9.2, §9.2а, §9.4).** `--ref main -f env=prod` → `plan` находит `BASE` (последний успешный `prod deploy`), пишет diff `deploy/ scripts/ops/ .github/ apps/server/migrations/` и таблицу PR O45 с итоговой строкой «PR: N, коммитов вне PR: M» → `build` → Ivan сверяет список и подтверждает → `deploy.sh`: проверка партий, секреты, клон (база = SHA клона, `<sha>` — предок `origin/main`), `docker pull`, метка `revision`, бэкап `pre-deploy`, запись состояния, гашение staging, `up`, проверки п.8, `image prune` → код 0.

**С3. Провал выкатки prod с автооткатом (9.4 п.9, 9.5, O11).** `app` не здоров 120 с или не прошла любая проверка п.8 → `restore_prev` (клон из `prod.repo.prev`, образ из `prod.image.prev`) → проверки п.8 с `revision` прошлого образа → успех: код 1 `rolled_back`, job `prod` красный; провал: код 4 `broken`.

**С4. Откат (9.5, O12).** `action=rollback` без `image` (агенты) → цель `prod.image.prev`; с `image=sha256:…` (Ivan) → цель только из `prod.history`. Клон не меняется, бэкапа нет, проверки п.8 → 0 / 4.

**С5. Подъём staging и smoke (9.6; после первой выкатки prod).** `--ref <ветка|main> -f env=staging` → `build` публикует `chezz-app-staging` и `chezz-tools-staging` → Ivan подтверждает `staging` → шаг SSH `up <app-digest> <tools-digest>` + секреты `[staging]` → `staging.env`, `compose.staging.env` по шаблону, клон не меняется, пересоздание staging-сервисов, `seed.ts --demo`, `state/staging.started` → затем (без SSH) `checkout` → `npm ci` → `playwright install chromium` → `@smoke --project=desktop` с `E2E_BASE_URL=vars.APP_ORIGIN` и `SEED_TOKEN_SECRET` в env шага. Ivan входит вручную (V17).

**С6. Гашение staging (9.6, O5).** Три пути: `action=down`; выкатка prod (9.4 п.6); `chezz-staging-ttl.timer` при `staging.started` старше 12 ч.

**С7. Нагрузка (§11, O16; полноценно — с E21).** `gh workflow run load.yml --ref <ветка>` → `plan` → `build` → job `load` (`staging`): `up` → `load` (`games_active` prod > 2 → код 3; иначе `seed --load` + `tests/load/run.ts` в `tools-staging`, отчёт `/tmp/report.json` в итог job) → `down` при `if: always()`.

**С8. Ежедневный бэкап (14.1, режим `local`).** `chezz-backup.timer` 03:30 UTC → `backup.sh` → `pg_dump -Fc` в `/var/backups/chezz/chezz-<UTC>-daily.dump` (каталог 700 `deploy`), на VPS — 3 последних файла, `state/last-backup`; `status` показывает `backup_mode=local`, `last_backup`.

**С9. `status` (9.3).** Команда `status` каждой среды печатает строки `ключ=значение` из 9.3 (prod — все; staging — своё подмножество по решению architect).

## Edge cases

| # | Ситуация | Ожидаемое поведение | ТЗ / документ |
|---|---|---|---|
| EC-1 | Сочетания входов: `prod`+`down`, `staging`+`rollback`, `prod` не с `main`, `bootstrap=true` при `staging` или `action≠deploy`, `image` не по `^sha256:[0-9a-f]{64}$`, `image` при `action≠rollback` | job `plan` падает с понятной ошибкой; `build`, `prod`, `staging` не стартуют; подтверждение environment не запрашивается | OPERATIONS §9.2, O44 |
| EC-2 | `prod deploy` без `bootstrap`, успешного `prod deploy` в истории нет | `plan` падает: «нужен `bootstrap=true`» | §9.2 |
| EC-3 | `bootstrap=true` на новом VPS, успешный `prod deploy` в истории есть (авария 14.3) | список O45 строится от его `headSha`; база в `deploy.sh` не проверяется | O44, §9.2а |
| EC-4 | Заголовок PR или тема коммита содержит `|`, `<`, `>`, `` ` `` (в т.ч. `<!--`) | символы заменены на `_`; таблица не ломается, строки ниже не скрыты | §9.2а |
| EC-5 | Пустой диапазон (база = HEAD) | строка «новых коммитов нет» | §9.2а |
| EC-6 | Коммит в `main` вне PR | строка «**коммит вне PR**» в таблице; учитывается в итоговой строке | §9.2а, O45 |
| EC-7 | Rebase-мерж: несколько коммитов одного PR | одна строка на PR | §9.2а |
| EC-8 | `$SSH_ORIGINAL_COMMAND` не из белого списка: чужая команда, SHA не 40 hex, digest не по regex, база не SHA и не `bootstrap`, лишние аргументы, метасимволы shell, ключ staging с командой prod и наоборот | код 2 `bad_command`, ничего не изменено | §9.3, O9, SECURITY §16 |
| EC-9 | Секреты в stdin: ключ не из раздела среды (у staging — любой не `[staging]`), значение с `\n`, `$`, кавычкой, обратной кавычкой, `\` | код 2, файлы env не изменены | §7, O10 |
| EC-10 | Секрет environment не задан (пустое значение) — в т.ч. `GOOGLE_*`/`COOKIE_SECRET` до E04, `TELEGRAM_*`/`B2_*` до этапа 4 | **пробел** — см. вопрос architect A2 | §7 |
| EC-11 | `deploy` prod: `chezz_games_active` > 10, `force` нет | код 3 `prod_busy`, ничего не изменено; с `force` — выкатка идёт | O38, §9.4 п.0 |
| EC-12 | Метрики `chezz_games_active` нет (до E06) или `app` не отвечает (первая выкатка) | значение 0, выкатка идёт | §9.4 п.0 |
| EC-13 | SHA клона ≠ `base` из `plan` (кто-то/что-то переключил клон, или между `plan` и SSH прошла другая выкатка) | код 6 `base_mismatch`, ничего не изменено | O41, §9.4 п.2 |
| EC-14 | `<sha>` не предок `origin/main` | код 2 | §9.4 п.2 |
| EC-15 | Метка `revision` образа ≠ `<sha>` | код 2 | §9.4 п.3 |
| EC-16 | `docker pull` не удался (сеть, пакет GHCR ещё приватный после первой публикации) | **пробел**: код не назначен — см. A3 | §9.4 п.3, §16.1 п.7 |
| EC-17 | `backup.sh --reason pre-deploy` упал | код 5 `backup_failed`, выкатки не было (образ, клон, `prod.image` не изменены) | §9.4 п.4 |
| EC-18 | `db` не запущен (первая выкатка) | бэкап пропущен, `backup=skipped_no_db`, выкатка идёт | §9.4 п.4 |
| EC-19 | `BACKUP_REQUIRE_OFFSITE=true`, режим `local` | `backup.sh` — ошибка; при выкатке — код 5 | O35, §14.1 |
| EC-20 | Миграция падает при старте `app` | `app` не здоров 120 с → `restore_prev` → код 1; схема не изменилась (миграция в транзакции) | §9.4 пример, ARCHITECTURE §5 |
| EC-21 | Провал проверок при **первой** выкатке: `prod.image.prev` и `prod.repo.prev` нет | **пробел** — см. A4 | §9.4 п.9, §9.5 |
| EC-22 | `rollback` без аргумента, `prod.image.prev` нет; или `rollback <digest>`, которого нет в `prod.history` | код 2 | §9.5 |
| EC-23 | `app` перезапустился за 60 с наблюдения (`RestartCount` > 0) | проверка г) провалена → `restore_prev` | §9.4 п.8г |
| EC-24 | `load.yml` до E21 (`seed.ts --load` отвечает «not available yet», `tests/load/run.ts` нет) | шаг `load` завершается кодом ≠ 0, job красный, `down` всё равно выполняется | §11, этот эпик «Не входит» |
| EC-25 | `load` при `games_active` prod > 2 | код 3, генератор не запускается, `down` выполняется | §11 п.2 |
| EC-26 | staging `up` до первой выкатки prod (`state/prod.image` нет) | код 7 `prod_missing`, staging не поднят | O40, §9.6 п.1 |
| EC-27 | staging `up` упал (не поднялся, сид упал) | код 1 `up_failed`; шаги smoke не выполняются | §9.3, §9.6 |
| EC-28 | Обрыв SSH во время долгой команды | скрипт на VPS доходит до конца (`setsid`), журнал — `state/last-<среда>.log` | §9.3 |
| EC-29 | Правка клона во время работы скрипта | выполняется копия `remote/` из `mktemp -d`, правка не влияет | §9.3 |
| EC-30 | Два `deploy.yml` одной среды одновременно | второй ждёт (`concurrency: deploy-<env>`, без отмены) | §9.2, §10 |
| EC-31 | `prod deploy` и `staging up`/`load` одновременно (разные группы concurrency): гашение staging в 9.4 п.6 против подъёма staging | **пробел** — см. A5 | §9.2, §9.4 п.6 |
| EC-32 | Ожидание подтверждения environment 60 мин | run не отменяется, отчёт «ждёт Ivan» (поведение `/release`, не workflow) | §10 |
| EC-33 | Таймер TTL, staging не запущен или `staging.started` моложе 12 ч | ничего не делает, код 0 | §9.6 |
| EC-34 | Перезапуск `app` при выкатке (ARCHITECTURE §9.3) | простой — секунды; клиенты переподключаются за 60 с (ТЗ §4.6); восстановление партий — E07, в E02 только `restart: unless-stopped`, `live-restore`, `depends_on: db healthy` | ARCHITECTURE §5, §9.3 |
| EC-35 | Перезагрузка VPS | все сервисы, кроме `tools-staging`, поднимаются сами (`restart: unless-stopped`); таймеры — `enabled` | §6.1, §5 п.8 |
| EC-36 | `bootstrap.sh` запущен повторно | идемпотентен: пользователи, ключи, правила, каталоги не дублируются; существующие `*.env` не затираются | §5 |
| EC-37 | `APP_ENV=prod`/`staging` без `APP_VERSION` в образе | `app` не стартует (уже в `loadConfig`), выкатка → автооткат | §6.2, `config.ts` |
| EC-38 | Ключ присутствует и в `compose.staging.env`, и в `compose.prod.env` | побеждает prod (передаётся последним); staging-команды пишут `compose.staging.env` только по шаблону из двух строк | §6.1 |
| EC-39 | `tools-staging`/`app-staging` пытаются писать вне `/tmp` и тома | ошибка записи (`read_only: true`) | §6.1, O33 |
| EC-40 | Код ветки в job `staging` (шаги после SSH) | SSH в том же job больше не вызывается; секрет SSH — на уровне шага | §1, §9.6 п.4 |
| EC-41 | Вызов `deploy.yml` из форка / событием не `workflow_dispatch` | невозможен: только `workflow_dispatch`, environments с reviewers | §1, SECURITY §17 |
| EC-42 | Гость, удалённый игрок, вызовы, флаг против хода, 1 open вызов / 1 active партия | к E02 не относятся: эпик не меняет логику `app`; занятость prod учитывается только через `chezz_games_active` (EC-11) | — |

## Данные и владельцы

Сущностей БД эпик не вводит, миграций нет. Термины выкатки в GLOSSARY отсутствуют — имена из OPERATIONS.

| Данные | Где | Владелец / кто пишет | Кто читает |
|---|---|---|---|
| Образы `chezz-app` (prod), `chezz-app-staging`, `chezz-tools-staging` | GHCR, публичные, тег `sha-<sha>`, выкатка по digest | job `build` (O32) | VPS (`docker pull` без токена) |
| `prod.env`, `staging.env` (600 `deploy`) | `/srv/chezz/env` | `prod deploy` / `staging up` из stdin (§7) | `app`, `db`, staging-сервисы |
| `ops.env`, `compose.prod.env`, `compose.staging.env` (640 `deploy:ops`) | `/srv/chezz/env` | `prod deploy`; `compose.staging.env` — только команды staging | compose, скрипты, Ivan |
| `state/prod.image`, `prod.image.prev`, `prod.repo.prev`, `prod.history`, `staging.started`, `last-<среда>.log`, `last-backup` | `/srv/chezz/state` (750 `deploy:ops`) | `deploy.sh`, `backup.sh` | `deploy.sh`, `status`, таймер TTL, Ivan |
| Клон репозитория | `/srv/chezz/repo` (755 `deploy`) | `bootstrap.sh` (создаёт), только `prod deploy`/`restore_prev` (переключают) | `entry.sh`, compose, Caddy |
| Дампы БД (режим `local`, нешифрованные, содержат ПДн) | `/var/backups/chezz` (700 `deploy`) | `backup.sh` | Ivan (восстановление, E20) |
| Тома `pgdata`, `screenshots`, `caddy_data`, `caddy_config` | Docker | compose | `db`, `app`, `edge` |
| Секреты и vars | GitHub environments `prod`, `staging` | Ivan | шаги SSH (через `env:` шага) |

## Комплаенс и риски

Решения — Ivan; здесь только подсветка (SECURITY §12–§17).

| # | Риск | Где | Что подсвечиваю |
|---|---|---|---|
| R1 | Нешифрованные дампы с ПДн (e-mail, `google_name` после E04) на VPS до этапа 4 | O35, SECURITY §14 (S38) | Принято в документах; права 700 `deploy` обязательны (AC). Захват VPS = утечка дампа вместе с живой БД — ничего нового. |
| R2 | Срок хранения бэкапа в режиме `local`: на VPS хранятся **3 последних файла**, а ТЗ §5 требует 14 дней; `pre-deploy` занимает те же 3 места — несколько выкаток подряд вытесняют все `daily` | §14.1, ТЗ §5 | Вопрос Ivan 2. |
| R3 | Секреты в логах CI (публичный репозиторий): `set -x`, `echo`, печать env, ошибка `printf`, вывод `ssh -v` | SECURITY §17, OPERATIONS §1 | AC на статические запреты; ревью diff `.github/` Ivan. |
| R4 | Секреты на runner в job с кодом ветки (staging): `SEED_TOKEN_SECRET` виден коду ветки | §9.6 | Принятый риск SECURITY §17; секрет только на уровне шага smoke. |
| R5 | Первая публикация в GHCR создаёт пакет **приватным** (поведение GitHub по умолчанию); VPS тянет без токена → первая выкатка падает на `docker pull` | §6.2, §16.1 п.7 | Ivan делает пакеты Public между `build` и подтверждением `prod`, или повторяет запуск; см. A3, вопрос Ivan 3. |
| R6 | Логи: у Caddy нет access-лога, путь `/challenge/<id>` и IP не пишутся; journald 14 дней / 1 ГБ | O17, SECURITY §14, §15 | AC на отсутствие `log` в Caddyfile и настройки journald в `bootstrap.sh`. |
| R7 | Репозиторий публичный: в `deploy/**`, `.github/**` нет IP, ключа хоста, бакета, ID чата, личных e-mail, литерала `example.com`, логина владельца | §1, §17 | Проверяет `check-architecture.sh` (example.com) и gitleaks; остальное — ревью. `ACME_EMAIL` — только в vars. |
| R8 | Лимит Let's Encrypt на неудачные проверки при многократных неудачных первых выкатках (DNS ещё не указывает на VPS) | §6.3 | Ivan проверяет DNS `@` и `staging` до первой выкатки. |
| R9 | Удаление аккаунта и восстановление (S39, F7-Q8) | §14.3 | Не в E02; инструмент — E20 или позже. |
| R10 | Токен сессии может смержить PR без Ivan; сверка O45 ловит лишний PR, но не закладку внутри подтверждённого | O45, SECURITY §17 | Принятый риск; E02 реализует сверку (таблица PR), не меняет его. |

## Критерии приёмки

Способ проверки каждого AC (статический разбор файла, запуск скрипта с подменёнными `docker`/`git`/`curl`/`systemctl`, `docker build`, `docker compose config`, `caddy validate`) выбирает architect (вопрос A1). AC без запуска на настоящем VPS.

**Образ (`deploy/Dockerfile`, `.dockerignore`)**
- [ ] AC-1: `docker build -f deploy/Dockerfile --target app --build-arg APP_VERSION=<sha> .` и `--target tools` завершаются успешно из чистого клона.
- [ ] AC-2: образ `app`: пользователь не root (`node`, uid 1000), `EXPOSE 3000 9464`, `ENV HOST=0.0.0.0`, `METRICS_HOST=0.0.0.0`, `APP_VERSION=<sha>`, метка `org.opencontainers.image.revision=<sha>`; `CMD` начинается с `node --enable-source-maps`.
- [ ] AC-3: в образе `app` есть собранный `apps/web` с файлами `.map`; нет `tests/`, `apps/server/test/`, `apps/server/scripts/`, dev-зависимостей (например `vitest`, `@playwright/test`), `.git`, `.env*`, `docs`, `.claude`.
- [ ] AC-4: в образе `tools` есть `apps/server/scripts/seed.ts` и dev-зависимости; пользователь `node`.
- [ ] AC-5: контейнер из образа `app` с `APP_ENV=prod`, `APP_ORIGIN`, `DATABASE_URL` к тестовой БД и без `APP_VERSION` в окружении запуска (образ собран без `--build-arg`) не стартует (код ≠ 0); с `APP_VERSION` — `GET /api/health` = `{"status":"ok"}`, `GET :9464/metrics` содержит `app_info{version="<sha>"} 1`.
- [ ] AC-6: в Dockerfile нет `ARG`/`ENV` с именами секретов OPERATIONS §7 (`*_SECRET`, `*PASSWORD*`, `DATABASE_URL`, `*_KEY`, `*TOKEN*`).

**compose (`deploy/compose.yml`)**
- [ ] AC-7: `docker compose -p chezz -f deploy/compose.yml --env-file <staging> --env-file <prod> config -q` проходит с тестовыми env-файлами; без профиля в конфиге нет staging-сервисов, с `--profile staging` — есть `app-staging`, `db-staging`, `tools-staging`.
- [ ] AC-8: порты на хосте: у `edge` — `80`, `443`, `443/udp`; у `app` — только `127.0.0.1:9464`; у `app-staging` — только `127.0.0.1:9465`; у `db`, `db-staging`, `tools-staging` — нет.
- [ ] AC-9: сети `prod` и `staging` — `internal: true`; ни один staging-сервис не подключён к `prod` или `edge-prod`; `db` — только в `prod`.
- [ ] AC-10: `app`, `app-staging`, `tools-staging`: `user: "1000:1000"`, `cap_drop: [ALL]`, `no-new-privileges:true`, `read_only: true`, `tmpfs` на `/tmp`; лимиты памяти, CPU, `pids_limit` — по таблице OPERATIONS §6.1.
- [ ] AC-11: ни у одного сервиса нет `privileged`, `/var/run/docker.sock`, bind-mount каталога хоста; исключение — `edge`: `Caddyfile` только для чтения.
- [ ] AC-12: `app` — `depends_on: db: condition: service_healthy`, healthcheck по OPERATIONS §6.1 (10 с, `start_period: 60s`); `db` — `pg_isready -U app -d chezz`; все сервисы, кроме `tools-staging`, — `restart: unless-stopped`; у всех — `logging.driver: journald` с `tag`.
- [ ] AC-13: `db` и `db-staging` — `postgres:18`, `POSTGRES_USER=app`, `POSTGRES_DB=chezz`; `db` — том `pgdata` → `/var/lib/postgresql`; `db-staging` — `tmpfs` `/var/lib/postgresql`; пароли — только из `env_file`, не литералом.

**Caddy (`deploy/Caddyfile`)**
- [ ] AC-14: `caddy validate` (образ `caddy:2`) проходит при заданных `APP_DOMAIN`, `ACME_EMAIL`, `SENTRY_INGEST`.
- [ ] AC-15: оба сайта импортируют сниппет с пятью заголовками SECURITY §6 (значения дословно; `connect-src` содержит `wss://{host}` и `https://{$SENTRY_INGEST}`) и удалением `Server`; `{$APP_DOMAIN}` → `app:3000`, `staging.{$APP_DOMAIN}` → `app-staging:3000`.
- [ ] AC-16: в Caddyfile нет директивы `log` и проксирования порта 9464.

**`entry.sh`, коды, `status`**
- [ ] AC-17: каждая строка EC-8 → код 2 и последняя строка вывода `result=bad_command`; файлы `state/`, `env/` не изменены.
- [ ] AC-18: ключ среды `staging` с командой `deploy`/`rollback` → код 2; ключ `prod` с `up`/`down`/`load` → код 2.
- [ ] AC-19: `entry.sh` выполняет копию `deploy/remote/` во временном каталоге: изменение файла в клоне после старта команды не меняет её поведение (EC-29).
- [ ] AC-20: при любом исходе последняя строка вывода — `result=<имя>` из таблицы OPERATIONS §9.3, код выхода соответствует имени.
- [ ] AC-21: `status` prod печатает ровно ключи OPERATIONS §9.3 (`env`, `image`, `revision`, `repo`, `health`, `restarts`, `started_at`, `players_online`, `games_active`, `backup_mode`, `last_backup`, `disk_used_pct`, `staging`) в формате `ключ=значение`; при отсутствии метрик — `players_online=0`, `games_active=0`; без бэкапов — `last_backup=none`.

**Секреты и `env.allowlist`**
- [ ] AC-22: `deploy/env.allowlist` содержит разделы `[prod]`, `[ops]`, `[staging]` с ключами по таблице OPERATIONS §7 и не содержит значений.
- [ ] AC-23: каждая строка EC-9 → код 2; файлы env не изменены.
- [ ] AC-24: корректный набор секретов → `prod.env`, `staging.env` с правами 600 `deploy`; `ops.env`, `compose.*.env` — 640 `deploy:ops`; запись атомарная (временный файл + `mv`): при сбое посередине прежний файл цел.
- [ ] AC-25: команды staging пишут только `staging.env` и `compose.staging.env`; `compose.staging.env` после `up` — ровно две строки `STAGING_APP_IMAGE=ghcr.io/<owner>/chezz-app-staging@<digest>`, `STAGING_TOOLS_IMAGE=ghcr.io/<owner>/chezz-tools-staging@<digest>`.

**`deploy` prod (9.4)**
- [ ] AC-26: `chezz_games_active 11` в `/metrics`, без `force` → код 3 `prod_busy`; состояние, клон, env не изменены; с `force` — шаги продолжаются.
- [ ] AC-27: нет метрики `chezz_games_active` или `app` не отвечает → проверка занятости считает 0 (EC-12).
- [ ] AC-28: `base` ≠ SHA клона и ≠ `bootstrap` → код 6 `base_mismatch`; `base=bootstrap` → проверка пропущена.
- [ ] AC-29: `<sha>` не предок `origin/main` → код 2; метка `revision` образа ≠ `<sha>` → код 2.
- [ ] AC-30: бэкап `pre-deploy` упал → код 5, `state/prod.image`, `prod.history`, клон, `PROD_APP_IMAGE` не изменены; `db` не запущен → бэкап пропущен, в выводе `backup=skipped_no_db`.
- [ ] AC-31: успешная выкатка: `prod.image.prev` = прежний `prod.image`, `prod.image` = новый digest, `prod.repo.prev` = прежний SHA клона, клон на `<sha>` (detached), в `prod.history` — строка `время digest sha deploy`, `PROD_APP_IMAGE` в `compose.prod.env` = новый образ по digest.
- [ ] AC-32: если staging запущен — до `up` prod выполнено `rm -sfv app-staging db-staging`.
- [ ] AC-33: успех требует все проверки 9.4 п.8: а) `app_info{version="<sha>"} 1` на `127.0.0.1:9464/metrics`; б) `https://$APP_DOMAIN/api/health` = `{"status":"ok"}`; в) в ответе б) есть `Strict-Transport-Security` и `Content-Security-Policy`; г) через 60 с `RestartCount` = 0 и б) снова `ok`. Провал любой → `restore_prev`.
- [ ] AC-34: провал `up --wait` (120 с) или п.8 и успешный `restore_prev` → код 1 `rolled_back`, клон на `prod.repo.prev`, `prod.image` = прежний digest, в `prod.history` строка `restore`; провал `restore_prev` → код 4 `broken`.
- [ ] AC-35: после успешной выкатки выполнен `docker image prune -af --filter until=168h`.

**Откат (9.5)**
- [ ] AC-36: `rollback` без аргумента → цель `prod.image.prev`; текущий digest → `prod.image.prev`; строка `rollback` в `prod.history`; клон не меняется; бэкап не делается; проверки п.8 с `revision` цели → код 0 / 4.
- [ ] AC-37: `rollback <digest>`, которого нет в `prod.history`, или `rollback` без `prod.image.prev` → код 2, ничего не изменено.

**staging (9.6)**
- [ ] AC-38: `up` при отсутствии `state/prod.image` → код 7 `prod_missing`, сервисы staging не запускались.
- [ ] AC-39: `up`: клон не меняется (SHA до и после равны); старые staging-сервисы удалены до подъёма; выполнен `run --rm tools-staging node apps/server/scripts/seed.ts --demo`; записан `state/staging.started`; сбой любого шага → код 1 `up_failed`.
- [ ] AC-40: `down` → `rm -sfv app-staging db-staging`, код 0, также при уже остановленном staging.
- [ ] AC-41: юнит TTL: `staging.started` старше 12 ч → `down`; моложе или файла нет → ничего, код 0.

**Бэкап (14.1, `local`)**
- [ ] AC-42: `backup.sh` без `deploy/backup.age.pub` или без `B2_*` → режим `local`: файл `/var/backups/chezz/chezz-<UTC>-<daily|pre-deploy>.dump` (формат `pg_dump -Fc`), каталог 700 `deploy`, на VPS остаются 3 последних файла, обновлён `state/last-backup`.
- [ ] AC-43: `BACKUP_REQUIRE_OFFSITE=true` и режим `local` → `backup.sh` завершается ошибкой, дамп не создаётся.
- [ ] AC-44: сбой `pg_dump` посередине → код ≠ 0 (`set -euo pipefail`), `state/last-backup` не обновлён, неполный файл не остаётся среди «3 последних».

**`bootstrap.sh`, systemd**
- [ ] AC-45: `bash -n deploy/bootstrap.sh` и всех `deploy/remote/*.sh` — без ошибок; `shellcheck` — без ошибок уровня error (если architect включает shellcheck).
- [ ] AC-46: `bootstrap.sh` задаёт: `authorized_keys` у `deploy` — ровно две строки с `command="/srv/chezz/repo/deploy/remote/entry.sh prod|staging",restrict`; `PasswordAuthentication no`, `PermitRootLogin no`, `AllowUsers ops deploy`; `ufw` — только 22/tcp, 80/tcp, 443/tcp, 443/udp; swap 2 ГБ; `unattended-upgrades` только security, `Automatic-Reboot "false"`; `daemon.json` `{"log-driver":"journald","live-restore":true}`; journald `MaxRetentionSec=14day`, `SystemMaxUse=1G`; пакеты `age`, `rclone`, `curl`, `jq`, `git`; каталоги и права — таблица OPERATIONS §5 п.7.
- [ ] AC-47: в `bootstrap.sh`, юнитах и `deploy/**` нет IP, ключа хоста, логина владельца, e-mail, `example.com` (`scripts/check-architecture.sh` и `gitleaks` зелёные).
- [ ] AC-48: повторный запуск `bootstrap.sh` (на подменённом окружении или по разбору, способ — A1) не дублирует строки `authorized_keys`, `sshd_config`, `fstab`, правила `ufw` и не перезаписывает существующие файлы в `/srv/chezz/env`.
- [ ] AC-49: `deploy/systemd/` содержит `chezz-backup.timer` (`OnCalendar` 03:30 UTC) и `chezz-staging-ttl.timer` (каждые 30 мин) с сервисами, `User=deploy`; `systemd-analyze verify` без ошибок; `chezz-watch.*` в E02 нет.

**`deploy.yml` (9.2, 9.2а)**
- [ ] AC-50: `bash scripts/check-workflows.sh` зелёный: только `workflow_dispatch`; права `plan` — `contents: read`, `actions: read`, `pull-requests: read`; `build` — `contents: read`, `packages: write`; `prod`, `staging` — `contents: read`.
- [ ] AC-51: входы: `env` (`choice`: `staging`, `prod`), `action` (`choice`: `deploy`, `rollback`, `down`, по умолчанию `deploy`), `image` (строка), `force` и `bootstrap` (`boolean`, по умолчанию `false`); `run-name: ${{ inputs.env }} ${{ inputs.action }}`; `concurrency: deploy-${{ inputs.env }}` без `cancel-in-progress: true`.
- [ ] AC-52: в блоках `run:` нет выражений `${{ inputs.* }}`, `${{ github.event.inputs.* }}`, `${{ secrets.* }}` — только через `env:`; `secrets.*` встречаются только в `env:` шагов (не job, не workflow); нет `set -x`, `echo`/`printenv`/`env` с секретами.
- [ ] AC-53: job `plan` проверяет сочетания EC-1 (каждое — отказ до `build`), `image` по `^sha256:[0-9a-f]{64}$`; ищет `BASE` командой `gh run list --workflow deploy.yml --branch main --event workflow_dispatch --json displayTitle,headSha,conclusion -L 200` с `displayTitle == "prod deploy"` и `conclusion == success`; не найден без `bootstrap` → отказ; `checkout` с `fetch-depth: 0`.
- [ ] AC-54: `plan` пишет в `$GITHUB_STEP_SUMMARY` `git diff --stat $BASE..HEAD -- deploy/ scripts/ops/ .github/ apps/server/migrations/` и таблицу O45 `| PR | Заголовок | Автор | Смержил | Когда (UTC) | Коммит |` с последней строкой «PR: N, коммитов вне PR: M»; цикл — inline в `deploy.yml`, `plan` не запускает файлов репозитория.
- [ ] AC-55: цикл O45 на тестовой истории даёт: один PR при rebase-мерже (EC-7), строку «коммит вне PR» (EC-6), «новых коммитов нет» при пустом диапазоне (EC-5), замену `|<>`` ` `` на `_` (EC-4).
- [ ] AC-56: при `bootstrap=true`: `base=bootstrap`, в итоге — `git ls-files deploy/ .github/` и «bootstrap: проверка базы пропущена»; без успешного `prod deploy` — «bootstrap: список PR не строится»; с ним — список от его `headSha` (EC-3).
- [ ] AC-57: `build` только при `action == 'deploy'`; `env=prod` → `app` в `ghcr.io/<owner в нижнем регистре>/chezz-app`; `env=staging` → `app` в `chezz-app-staging` и `tools` в `chezz-tools-staging`; `APP_VERSION=${{ github.sha }}`; тег `sha-<sha>`; выход — digest; без секретов environment и SSH; файлов репозитория на runner не запускает.
- [ ] AC-58: job `prod` и `staging` — условия `needs`/`if` дословно по OPERATIONS §9.2; `environment` — `prod` / `staging`; в `prod` — один шаг SSH (`deploy <sha> <digest> <base> [force]` или `rollback [<digest>]`), вывод `result=` и `status` в итог.
- [ ] AC-59: шаг SSH: ключ из `SSH_DEPLOY_KEY` в файл под `$RUNNER_TEMP`, удаление в `trap` того же шага; `known_hosts` из `VPS_HOST_KEY`; `StrictHostKeyChecking yes`; секреты передаются `printf '%s=%s\n'` в stdin `ssh`, без временного файла.
- [ ] AC-60: job `staging` (`action=deploy`): шаг SSH `up` — первым; после него `checkout` (`persist-credentials: false`) → `npm ci` → `npx playwright install chromium` → `npm run test:e2e -- --grep @smoke --project=desktop` с `E2E_BASE_URL=${{ vars.APP_ORIGIN }}` и `SEED_TOKEN_SECRET` в env этого шага; после кода ветки шагов SSH нет; артефактов нет. `action=down` — один шаг SSH `down`.
- [ ] AC-61: все `uses:` — по полному SHA; у `actions/checkout` — `persist-credentials: false`; нет `pull_request_target`, `workflow_run`, `paths`.

**`load.yml` (§11)**
- [ ] AC-62: `check-workflows.sh` зелёный для `load.yml`; цепочка `plan` → `build` (обе цели в пакеты `*-staging`) → `load` (`environment: staging`); в `load` только шаги SSH (`up`, `load`, `down`), без `checkout` и кода ветки на runner; `down` — `if: always()`.
- [ ] AC-63: `load` на VPS: `games_active` prod > 2 → код 3 без запуска генератора; иначе команда OPERATIONS §11 п.2 в `tools-staging` с `LOAD_REPORT=/tmp/report.json`; содержимое отчёта — в итог job; файл токенов не выводится в stdout и артефакты; код ≠ 0 генератора → job красный.

**Прочее**
- [ ] AC-64: `npm run check` зелёный (в т.ч. `check-architecture.sh` — нет `example.com` в `.github`, `deploy`, `scripts`); `ci.yml` не изменён эпиком, кроме решения по вопросу A6.

### Проверка Ivan после мержа (не AC конвейера, не тест)
С1 целиком (`result=ok`), открыть `https://<домен>` (заголовки SECURITY §6, редирект HTTP → HTTPS), затем С5 с `--ref main` (smoke зелёный), С6 `action=down`, ручная проверка `status`. Результат — запись в `log.md` эпика.

## Открытые вопросы

**Ivan**
1. `deploy/backup.age.pub` в составе E02 (профиль), а пара ключей `age` по OPERATIONS §20 и ROADMAP — этап 4 (E20). Сгенерировать пару сейчас и закоммитить открытый ключ (режим всё равно `local`, пока нет `B2_*`) или в E02 файла нет, он появляется в E20?
2. Режим `local`: 3 последних дампа на VPS, включая `pre-deploy`, — меньше 14 дней ТЗ §5; несколько выкаток за день вытесняют все ежедневные копии. Принять до этапа 4 как есть или в `local` хранить, например, 14 `daily` + 3 `pre-deploy` отдельно (диск: БД < 1 ГБ, D3)?
3. Первая публикация пакетов GHCR создаёт их приватными; VPS тянет без токена. Готовы сделать `chezz-app`, `chezz-app-staging`, `chezz-tools-staging` Public вручную в окне между `build` и подтверждением `prod` при первой выкатке (или отклонить первую попытку и повторить)?
4. `scripts/ops/` (`status.sh`, `logs.sh` — первое действие по AL1 «с первой выкатки») в профиле эпика нет. Нужны к первой выкатке (тогда — задача `[infra]` в E02, правка профиля) или ждут E20, а до того — `deploy.yml -f action=…` и `journalctl` вручную?
5. ROADMAP: статусы E01 и E03 устарели («в работе» / «не начат» при смерженных PR #3, #9) — обновить при закрытии E02?

**architect**
- A1. Чем проверять AC инфраструктуры (TESTING §13 п.1 требует тест с `AC-n`/`EC-n` в имени): vitest-тесты в `tests/` с разбором YAML/Caddyfile и запуском `bash`-скриптов с подменой `docker`/`git`/`curl`/`systemctl` через `PATH`; где лежат (`tests/deploy/`?), проект Vitest, работа на Windows (Git Bash) и в CI; нужен ли `shellcheck`, `docker build` и `caddy validate` в CI (`ci.yml` — Ivan).
- A2. Пустое значение секрета (не задан в environment): `GOOGLE_*`, `COOKIE_SECRET` до E04, `TELEGRAM_*`, `B2_*` до этапа 4 — пропустить ключ, записать пустым или код 2? Обязательные ключи на среду?
- A3. `docker pull` не удался (сеть, приватный пакет, нет digest) — какой код и `result=` (в таблице 9.3 нет); то же для `staging up`.
- A4. Провал проверок при первой выкатке, когда `prod.image.prev`/`prod.repo.prev` нет: код 4 `broken`, отдельное поведение (оставить как есть, `result=` ?) — нужно для AC-34 и повтора `bootstrap=true`.
- A5. Блокировка на VPS между средами: `prod deploy` (гасит staging) параллельно со `staging up`/`load` (разные `concurrency`), и повторный запуск, пока прошлый `setsid` ещё идёт после обрыва SSH (EC-28) — `flock` в `entry.sh`? Какой код при занятости?
- A6. `dependabot.yml`: OPERATIONS 16.1 п.6 требует `docker-compose` (`/deploy`), в файле его нет — добавить в задачу `[ci]` E02?
- A7. Ключи для `bootstrap.sh`: как он получает открытые ключи `ci-prod`, `ci-staging` и ключ Ivan для `ops` (аргументы, stdin, переменные) без попадания в репозиторий; на какой ref клонирует репозиторий.
- A8. Том `screenshots` при `user: 1000:1000` и `read_only`: каталог монтирования должен принадлежать uid 1000 в образе (иначе именованный том создаётся root) — зафиксировать в `design.md`, хотя запись в том начнётся в E18.
- A9. Состав `status` для staging (9.3: «для staging» без списка ключей).
- A10. `force=true` при `env=staging` или `action≠deploy` — отказ в `plan` или игнор?
