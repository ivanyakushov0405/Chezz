# F7. Эксплуатация и DevOps

Статус: утверждён (Ivan, 2026-11-05), версия 0.4 от 2026-11-05 (ответы — `docs/setup/reviews/F7-response-r1.md`, `docs/setup/reviews/F7-response-r2.md`, `docs/setup/reviews/F7-response-r3.md`). Основа: `docs/TZ.md` v0.1, `docs/setup/BUSINESS.md`, утверждённые `docs/GLOSSARY.md` v0.3, `docs/ARCHITECTURE.md` v0.4 (+ `docs/adr/`), `docs/SECURITY.md` v0.3, `docs/API_CONVENTIONS.md` v0.3, `docs/DESIGN_SYSTEM.md` v0.3, `docs/TESTING.md` v0.3.
Утверждает: Ivan (BUSINESS D9).

Как читать: агент открывает только нужный раздел. 1 — правила, 2 — исходные цифры и стоимость, 3 — решения (3.1 среды и инфраструктура, 3.2 CI и поток выкатки, 3.3 проверки, откат, нагрузка, 3.4 наблюдаемость, 3.5 бэкапы и аварии, 3.6 прочее), 4 — среды, 5 — VPS и первичная настройка, 6 — контейнеры (6.1 compose, 6.2 образы, 6.3 Caddy, 6.4 тестовая БД), 7 — переменные и секреты, 8 — CI, 9 — выкатка (9.1 поток и подтверждения, 9.2 workflow, 9.3 команды на VPS и коды, 9.4 выкатка prod и проверки, 9.5 откат, 9.6 staging и его smoke, 9.7 окна и плановые работы), 10 — команды для `/release`, 11 — нагрузочный тест, 12 — наблюдаемость, 13 — алерты, 14 — бэкапы и восстановление, 15 — кто и что может в проде, 16 — настройки GitHub, учётная запись, правила Claude Code, 17 — лицензия и публичный репозиторий, 18 — чего не делаем, 19 — план роста, 20 — что нужно от Ivan и когда, 21 — открытые вопросы, 22 — закрытые пункты других документов, 23 — правки утверждённых документов (для reopen). Номера: решения `O#`, вопросы `F7-Qn`; ссылки — `ARCHITECTURE A#` / `§N`, `SECURITY S#` / `§N`, `API P#` / `§N`, `DESIGN U#`, `TESTING V#` / `§N`.

Что читать по роли:
- devops: всё; при задаче — свой раздел + 1, 7.
- developer (backend): 1, 6.2, 7, 12.2.
- tester: 9.6, 11.
- оркестратор `/release`: 1, 9.1, 9.3 (коды и `status`), 10, 16.3.

Заглушки: домен `example.com`, staging `staging.example.com` (до F7-Q2); владелец образов `<owner>`. В коде и workflow заглушек нет: адреса — `vars.APP_ORIGIN` / `APP_ORIGIN` / `APP_DOMAIN`, владелец — `github.repository_owner` в нижнем регистре (раздел 1).

## 1. Правила для агентов

- MUST: выкатка, откат, подъём и гашение staging, нагрузочный тест — только CI-workflow `deploy.yml` и `load.yml` (разделы 9, 11). MUST NOT: `docker compose up`, `docker pull`, правка `.env` на VPS руками ради выкатки; выкатка с локальной машины. Исключения на VPS из `main`: автогашение staging таймером (9.6) и гашение staging при выкатке prod (9.4).
- MUST NOT: агентам — SSH к VPS, ключи выкатки, значения секретов, запуск `scripts/ops/` (SECURITY §16). Агенты не коммитят и не пушат (хук набора); `git push`, `gh pr merge`, `gh workflow run` выполняет оркестратор только с подтверждением Ivan в Claude Code (16.3).
- MUST оркестратору: к GitHub — только командами раздела 10 (`gh workflow run`, `gh run list`, `gh run view`, `gh pr …` без `review`). MUST NOT: `gh api` (любой), `curl`/`wget` к GitHub, `gh auth`, `gh secret`, `gh variable`, `gh repo edit`, `gh run cancel`/`rerun`, `gh workflow enable|disable`, `gh pr review`, обёртки вокруг них (`env …`, `bash -c`, скрипт). Правила Claude Code — 16.3.
- MUST: сессия Claude Code работает только с fine-grained токеном GitHub из 16.2 (O43); полный `gh auth` Ivan в ней не залогинен. Коммиты с `.github/workflows/**` пушит Ivan сам: у токена нет права Workflows.
- MUST: перед `git push` коммитов, меняющих `.github/`, `deploy/`, `scripts/ops/`, и перед `gh pr merge` такого PR оркестратор показывает Ivan diff этих путей (O36).
- MUST: секреты сред — только в GitHub environments `prod` и `staging`; на VPS их пишет скрипт выкатки (раздел 7). MUST NOT: секреты в репозитории, образе, `--build-arg`, логах шагов, артефактах; `set -x` и `echo` в шагах с секретами (SECURITY §17).
- MUST: входы `workflow_dispatch` попадают в `run:` только через `env:`; `env` и `action` — тип `choice`; `image` проверяется `^sha256:[0-9a-f]{64}$` в job `plan` (9.2).
- MUST: секреты environment — на уровне шага, не job. В job с environment код ветки (`npm ci`, тесты) запускается только после всех шагов с SSH-ключом; после кода ветки SSH в том же job не вызывается (9.6).
- MUST: workflow с секретами — только `workflow_dispatch` с `environment`. MUST NOT: `pull_request_target`, `workflow_run` из PR, секреты в `ci.yml`; триггеры и `permissions` — только из 8 и 9.2 (проверяет `scripts/check-workflows.sh`).
- MUST: compose, Caddyfile и скрипты на VPS берутся из клона, который переключает только выкатка prod на SHA из `main` (9.4); команды staging клон не меняют (9.3).
- MUST: staging-сервисы с кодом веток — с ужесточением 6.1; MUST NOT: `privileged`, `docker.sock`, bind-mount каталогов хоста в любом сервисе, кроме `edge` (Caddyfile, только чтение).
- MUST NOT: публиковать порты на `0.0.0.0`, кроме `edge` 80/443: Docker обходит `ufw`. Остальные — только `127.0.0.1` (6.1).
- MUST NOT: литерал `example.com` и логин владельца в `.github/**`, `deploy/**`, `scripts/**` — проверяет `scripts/check-architecture.sh` (раздел 8).
- MUST: новый внешний сервис, контейнер, хранилище — правкой этого документа и ARCHITECTURE §14 (ARCHITECTURE §1).
- MUST NOT: запускать нагрузку и `seed` против prod (TESTING §10, V9).

## 2. Исходные цифры и стоимость

| Что | Значение | Источник |
|---|---|---|
| Доступность | 99% в месяц ≈ 7,3 ч простоя | ТЗ §5 |
| Плановые работы | объявление за 24 ч | ТЗ §5 |
| Бэкап | ежедневно, хранение 14 дней, проверка восстановления раз в месяц | ТЗ §5; по ТЗ §7 — этап 4 |
| Мониторинг | ошибки клиента и сервера, метрики (онлайн, партии, задержка), алерты в мессенджер; по ТЗ §7 — этап 4 | ТЗ §5, §7 |
| CI/CD, среды | GitHub Actions → Docker → prod и staging | ТЗ §6 |
| Нагрузка | 150 онлайн, 75 партий, p95 хода ≤ 150 мс; тест перед этапами 5 и 6 | ТЗ §5, §7; TESTING V15 |
| Хостинг | один небольшой VPS, всё в Docker, без управляемой БД (ориентир 2 vCPU / 4 ГБ) | BUSINESS D6; ARCHITECTURE §5 |
| Сопровождение | один человек (Ivan), без дежурства | BUSINESS D4 |
| Объём | БД < 1 ГБ, скриншоты — несколько ГБ за 12 мес | BUSINESS D3 |
| Репозиторий | публичный: минуты CI без лимита, у форков нет секретов | человек (TESTING V18) |

Стоимость в месяц (ориентир, по умолчанию; признак превышения — раздел 19):

| Статья | Цена | Бесплатный лимит / признак |
|---|---|---|
| VPS 2 vCPU / 4 ГБ / 40 ГБ | ≈ 5–25 USD (F7-Q1) | — |
| Домен | ≈ 1–2 USD (10–20 USD в год) | — |
| GitHub Actions, GHCR | 0 | публичный репозиторий и пакеты |
| Sentry | 0 | 5 000 ошибок/мес |
| UptimeRobot | 0 | 50 мониторов, 5 мин |
| Backblaze B2 | 0 | 10 ГБ |
| Telegram Bot API | 0 | — |

Вывод: один VPS, одна команда `docker compose`, никакого оркестратора и Prometheus. Руками Ivan: одно подтверждение staging, ручной вход на staging, одно подтверждение prod на выкатку (9.1); ежемесячная проверка восстановления; реакция на алерт. 99% без дежурства держится только для сбоев, которые лечатся сами (O31).

## 3. Таблица решений

Источники: ТЗ, бизнес, человек, по умолчанию, ревью. «Альтернатива» — более простой вариант и почему не он.

### 3.1. Среды и инфраструктура

| № | Решение | Источник | Альтернатива и почему не она |
|---|---|---|---|
| O1 | Среды: локальная, CI, staging по требованию, prod (раздел 4) | ТЗ §6; ARCHITECTURE A17, ADR-0004 | Постоянный staging — второй набор для сопровождения |
| O2 | VPS: Ubuntu 24.04 LTS, 2 vCPU / 4 ГБ / ≥ 40 ГБ SSD, swap 2 ГБ; провайдер — F7-Q1 | бизнес D6; ARCHITECTURE §5; ОС и диск — по умолчанию | 2 ГБ RAM — нет запаса на staging и нагрузку |
| O3 | IaC — `deploy/compose.yml`, `deploy/bootstrap.sh`, юниты `deploy/systemd/` | по умолчанию; бизнес D4 | Руками — не воспроизвести за часы; Terraform/Ansible — инструмент ради одной машины |
| O4 | Один compose-проект `chezz`, staging — профиль `staging`; сети БД `internal`, общих сетей у staging и prod нет (6.1) | ARCHITECTURE A16, ADR-0004; по умолчанию | Одна сеть — код ветки достаёт до `db` prod |
| O5 | staging — `staging.<домен>`, БД в `tmpfs`; гасится выкаткой prod, `action=down` или таймером через 12 ч | ARCHITECTURE A17; ревью r1 (prop-2) | Только `action=down` — лишнее подтверждение |
| O6 | Образы из `deploy/Dockerfile`, цели `app` и `tools`; выкатка по digest (6.2) | по умолчанию | Сборка на VPS — исходники и сборщик на prod |
| O32 | Пакеты GHCR: `chezz-app` — только `env=prod` на `main`; `chezz-app-staging`, `chezz-tools-staging` — staging и нагрузка | ревью r1 (sec-2) | Один пакет — образ ветки попадает в prod по digest |
| O33 | Контейнеры с кодом веток и `app` prod: не root, `cap_drop: [ALL]`, `no-new-privileges`, `read_only` + `tmpfs`, `pids_limit`, `cpus` (6.1) | SECURITY §17; ревью r1 (sec-4) | rootless Docker — перенастройка демона; если staging станет постоянным |

### 3.2. CI и поток выкатки

| № | Решение | Источник | Альтернатива и почему не она |
|---|---|---|---|
| O7 | `ci.yml`: job `check` и `e2e` по TESTING §12, без секретов (раздел 8) | TESTING V12, V19; SECURITY S27 | — |
| O8 | Выкатка — `deploy.yml`; в запуске ровно один job с `environment` → одно подтверждение Ivan на запуск (9.1) | DOCUMENTS F7; SECURITY S24; бизнес D9; ревью r1 | Автовыкатка после мержа — против D9 |
| O9 | CI входит пользователем `deploy` двумя ключами `restrict` с `command=`; клон переключает только `prod deploy` на SHA запуска (предок `origin/main`) | SECURITY §16, §17; ревью r1 (sec-1) | Обновлять клон любой командой — ключ staging запускал бы неодобренный для prod код |
| O10 | Секреты — GitHub environments → stdin SSH → файлы среды по `deploy/env.allowlist`; staging принимает только `[staging]` (раздел 7) | SECURITY S24; ревью r1 (sec-5) | `.env` руками — секреты в двух местах |
| O36 | Учётная запись одна — Ivan; агенты не пушат; push, мерж, запуск workflow — оркестратор с подтверждением; diff `.github/`, `deploy/`, `scripts/ops/` перед `git push` и `gh pr merge` | факт набора (`settings.json`, `guard.sh`); SECURITY S24; ревью r1, r2 (sec-1, sec-12) | Отдельная учётная запись агентов + обязательное ревью CODEOWNERS — лишнее при агентах без push |
| O39 | Правила Claude Code 16.3 (`ask` на весь `gh api`, `deny` на `gh auth`/`secret`/`variable`/`repo edit` и др.) — условие первой выкатки | ревью r2 (sec-10) | Список запретов по префиксам флагов — обходится (флаг после пути, неявный POST, GraphQL) |
| O37 | Job `plan` без секретов: diff `deploy/`, `scripts/ops/`, `.github/`, `apps/server/migrations/` от базы до подтверждения prod | ревью r1 (sec-1) | Подписанные теги Ivan — ещё ключ и шаг |
| O41 | База diff — `headSha` последнего успешного запуска `prod deploy`; `deploy.sh` сверяет её с SHA клона, иначе код 6 | ревью r2 (sec-11) | SHA из Deployments API — его пишет и откат, и любой вызов API |
| O40 | Первая выкатка после `bootstrap.sh` — `env=prod` с `bootstrap=true` без предшествующего staging (prod пуст, игроков нет); `up` staging без выкатки prod → код 7 | по умолчанию; ревью r2 (consistency-2) | Первый staging шагом bootstrap — ещё ветка логики ради разового случая |
| O43 | Сессия Claude Code — fine-grained токен GitHub только на этот репозиторий: Contents RW, Pull requests RW, Actions RW, Metadata R; без Administration, Environments, Secrets, Variables, Workflows. `.github/workflows/**` пушит Ivan сам (CODEOWNERS). Закрывает F7-Q9 | человек, утверждение F7, 2026-11-05; ревью r3 (sec-14) | Полный `gh auth` Ivan + правила 16.3 — код, который запускают агенты (`npm test`, `child_process`), обходит строковые правила и с правами администратора снимает environments и ruleset |
| O44 | Вход `bootstrap=true` у `deploy.yml` (только `env=prod`): `plan` не ищет базу и показывает полный diff `deploy/` и `.github/`, `deploy.sh` пропускает проверку базы O41; подтверждение environment `prod` остаётся. Для первой выкатки, повтора неудавшейся первой и нового VPS (14.3) | человек, утверждение F7, 2026-11-05; ревью r3 (consistency-8) | `base=none` по отсутствию успешных запусков — на новом VPS после аварии успешные запуски есть, выкатка невозможна |

### 3.3. Проверки, откат, нагрузка

| № | Решение | Источник | Альтернатива и почему не она |
|---|---|---|---|
| O11 | Проверки prod (health, версия, заголовки, нет перезапусков) делает `deploy.sh`; провал → `restore_prev` (образ и клон, 9.5) | ТЗ §5; ревью r1 (agent-1, prop-3) | Без автоотката prod сломан, пока Ivan разбирается |
| O12 | Откат — прошлый образ на той же схеме: `action=rollback` или `image=<digest>` из истории — только Ivan | ARCHITECTURE §5; ревью r1 | Откат миграций запрещён |
| O13 | Выкатка (простой ≤ 1 мин, ARCHITECTURE A10) — не плановая работа; плановая — простой > 5 мин, объявление за 24 ч (F7-Q5) | ТЗ §5; по умолчанию | Объявлять каждую выкатку ради секунд |
| O14 | Smoke: staging — `@smoke` в job `staging` после SSH + ручной вход (TESTING V17); prod — проверки `deploy.sh` | TESTING V17, §9; ревью r1 | e2e на prod — тестовые аккаунты в prod (S26) |
| O15 | Session сида на staging — `HMAC(SEED_TOKEN_SECRET, ник)` (§23) | человек (публичный репозиторий) | Фиксированные токены публичны |
| O16 | Нагрузка — `load.yml`, один job только с SSH-шагами (раздел 11) | TESTING V11, §10 | Запуск по SSH руками — против «только CI» |
| O38 | `prod deploy` при > 10 активных партиях — код 3; обход — `force=true` (Ivan) | ARCHITECTURE §5; ревью r1 (agent-4) | Правило без проверки — агент не видит партий |

### 3.4. Наблюдаемость

| № | Решение | Источник | Альтернатива и почему не она |
|---|---|---|---|
| O17 | Логи — `journald`, 14 дней, ≤ 1 ГБ; у Caddy нет access-лога | SECURITY §14 | `json-file` режет по размеру, не по сроку |
| O18 | `id` в путях `/challenge/<id>`, `/api/challenges/<id>…` → `:id` в логах и Sentry | API §17.2 п.15; §23 | Секрет ссылки (S9) в логах |
| O19 | С первой выкатки — Sentry и UptimeRobot; этап 4 — `watch.sh` v1 (12.3) | ТЗ §5, §7; ARCHITECTURE A22; ревью r1 (prop-1) | Prometheus — сотни МБ; всё на этапе 1 — монитор раньше нужды |
| O20 | Алерты метрик и доступности — Telegram; ошибки Sentry — e-mail (отступление от ТЗ §5) | ТЗ §5; ревью r1 (tz-4); человек, утверждение F7, 2026-11-05 (F7-Q6) | Webhook Sentry → Telegram — нужен посредник |
| O21 | Внешний пинг — UptimeRobot, 5 мин, `/api/health`, Telegram через его интеграцию | ТЗ §5 | Пинг с VPS не видит падения VPS |
| O22 | Sentry: `environment`, `release` = SHA; source maps рядом со статикой; без токена Sentry в CI | ТЗ §5 | Загрузка из CI — токен в job без секретов |
| O30 | Дежурства нет: алерты — в рабочее время Ivan | бизнес D4; человек | — |

### 3.5. Бэкапы и аварии

| № | Решение | Источник | Альтернатива и почему не она |
|---|---|---|---|
| O23 | Ежедневно 03:30 UTC `pg_dump -Fc` → `age` → 3 копии на VPS + B2 с Object Lock 14 дней; ключ VPS без удаления (14.1) | ТЗ §5; SECURITY S21, §14; человек, утверждение F7, 2026-11-05 (B2) | Только на VPS — пропадут вместе с ним |
| O35 | До этапа 4 — режим `local` (нешифрованный дамп только на VPS); с `BACKUP_REQUIRE_OFFSITE=true` — ошибка | ТЗ §7; ревью r1 (tz-1) | B2 и `age` с этапа 1 — работа этапа 4 в этапе 1 |
| O42 | Каждая выгрузка в B2 — сообщение в Telegram с именем и SHA-256; при восстановлении файл выбирается по этому сообщению и серверному `uploadTimestamp` B2 | ревью r2 (sec-6) | Время и имя из `rclone lsl` — их задаёт загружающий, т.е. и захвативший VPS |
| O24 | Скриншоты не бэкапятся | ТЗ §5; SECURITY S20 | — |
| O25 | Проверка восстановления — Ivan раз в месяц, ключ `age` по stdin (14.2) | ТЗ §5; SECURITY S35 | Автоматическая — закрытый ключ на VPS |
| O26 | Авария VPS: RPO ≤ 24 ч, RTO ≤ 4 ч рабочего времени (14.3) | бизнес D4, D6 | Реплика, WAL-архив — второй сервер |
| O31 | Принятые отступления: (1) ТЗ §5 99% — ночная авария или потеря VPS дают 8–16 ч простоя; (2) ТЗ §5 «удаление по запросу» — при потере VPS удаления за время после последнего бэкапа не восстановить (14.3) | бизнес D4; ревью r1 (tz-2), r2 (tz-5); человек, утверждение F7, 2026-11-05 | Дежурство или второй VPS — против D4, D6 |

### 3.6. Прочее

| № | Решение | Источник | Альтернатива и почему не она |
|---|---|---|---|
| O27 | `unattended-upgrades` (безопасность), без авто-перезагрузки; образы и actions — Dependabot | SECURITY S27 | Без автообновлений — уязвимости ждут Ivan |
| O28 | Лицензия — GPL-3.0-or-later (раздел 17) | DESIGN U33; человек, утверждение F7, 2026-11-05 | MIT несовместима с chessground |
| O29 | Настройки GitHub и Claude Code (раздел 16) включает Ivan до первой выкатки | SECURITY S24; TESTING V19 | — |

## 4. Среды

| Среда | Где | Адрес | Данные | Кто запускает | Секреты |
|---|---|---|---|---|---|
| локальная | машина Ivan, агенты | `http://localhost` | `deploy/compose.test.yml`, сид `--demo` | разработчик | `.env.local`, свой клиент Google (S25) |
| CI | GitHub runner `ubuntu-latest` | — | `services:` PostgreSQL | push / PR | нет |
| staging | VPS, профиль `staging` | `https://staging.<домен>` | БД в `tmpfs`: миграции + сид `--demo` | `deploy.yml` / `load.yml`, подтверждает Ivan | environment `staging` |
| prod | VPS | `https://<домен>` | `db` на томе `pgdata`, бэкап (14) | `deploy.yml` с `--ref main`, подтверждает Ivan | environment `prod` |

- Закрытое тестирование этапа 5 — на prod (ADR-0004).
- На staging только сид-данные (SECURITY S26), вход — клиент Google в режиме Testing (S33).
- Пример: фича «удаление аккаунта» (TESTING §14 п.6) — `deploy.yml` с веткой фичи на staging → `@smoke` → Ivan входит тестовым пользователем Google и удаляет аккаунт → мерж → выкатка prod (staging гаснет сам).

## 5. VPS и первичная настройка

`deploy/bootstrap.sh` — запускает Ivan один раз от root на новом VPS (`ssh root@<ip> 'bash -s' < deploy/bootstrap.sh`), идемпотентен:

1. Пользователи: `ops` (Ivan; `sudo` с паролем; группы `docker`, `ops`), ключ ed25519 с паролем на ключ (SECURITY §16); `deploy` (без `sudo`, группы `docker`, `ops`). `authorized_keys` у `deploy` — ровно две строки:
   ```
   command="/srv/chezz/repo/deploy/remote/entry.sh prod",restrict ssh-ed25519 AAAA… ci-prod
   command="/srv/chezz/repo/deploy/remote/entry.sh staging",restrict ssh-ed25519 AAAA… ci-staging
   ```
2. `sshd`: `PasswordAuthentication no`, `PermitRootLogin no`, `AllowUsers ops deploy`.
3. `ufw`: запрет входящих, кроме 22/tcp, 80/tcp, 443/tcp, 443/udp.
4. Swap 2 ГБ; `unattended-upgrades` только security, `Automatic-Reboot "false"`.
5. Docker Engine и плагин compose; `/etc/docker/daemon.json`: `{"log-driver":"journald","live-restore":true}`; journald: `MaxRetentionSec=14day`, `SystemMaxUse=1G`.
6. Пакеты: `age`, `rclone`, `curl`, `jq`, `git`.
7. Каталоги и права:

| Путь | Владелец | Права | Что |
|---|---|---|---|
| `/srv/chezz/repo` | `deploy` | 755 | клон публичного репозитория |
| `/srv/chezz/env` | `deploy:ops` | 750 | файлы раздела 7; bootstrap создаёт пустые `compose.prod.env` и `compose.staging.env` (640 `deploy:ops`), `deploy.sh` пересоздаёт пустой файл, если его нет |
| `/srv/chezz/state` | `deploy:ops` | 750 | состояние выкаток |
| `/var/lib/chezz` | `deploy:ops` | 770 | `metrics/`; `restore-check.log` (пишет `ops`, 664) |
| `/var/backups/chezz` | `deploy` | 700 в `local`; `backup.sh` при первом `offsite` удаляет нешифрованные дампы и ставит `deploy:ops` 750 | дампы |

8. Юниты: `chezz-backup.timer` (03:30 UTC), `chezz-staging-ttl.timer` (каждые 30 мин, 9.6); с этапа 4 — `chezz-watch.timer` (каждую минуту). Все от `deploy`.

- MUST: IP VPS, ключ хоста, логин GitHub — только в vars environments (раздел 7), не в репозитории.
- После bootstrap: Ivan заносит IP и строку `known_hosts` в vars обоих environments; первая выкатка — `env=prod`, `bootstrap=true` (O40, O44).

## 6. Контейнеры

### 6.1. compose

`deploy/compose.yml`, проект `chezz`; запускает только `deploy/remote/*.sh`: `docker compose -p chezz -f deploy/compose.yml --env-file /srv/chezz/env/compose.staging.env --env-file /srv/chezz/env/compose.prod.env …` — `compose.prod.env` **последним**: при совпадении ключа побеждает prod. `compose.prod.env` (не секрет; пишет только `prod deploy`): `PROD_APP_IMAGE`, `APP_DOMAIN`, `ACME_EMAIL`, `SENTRY_INGEST`. `compose.staging.env` пишут только команды staging, строго по шаблону из двух строк `STAGING_APP_IMAGE=ghcr.io/<owner>/chezz-app-staging@<digest>` и `STAGING_TOOLS_IMAGE=…chezz-tools-staging@<digest>` с проверенными digest.

| Сервис | Образ | Сети | Порты на хосте | Данные | env | Ресурсы |
|---|---|---|---|---|---|---|
| `edge` | `caddy:2` | `edge-prod`, `edge-staging` | `80`, `443`, `443/udp` | `caddy_data`, `caddy_config`; `Caddyfile` только чтение | `APP_DOMAIN`, `ACME_EMAIL`, `SENTRY_INGEST` | — |
| `app` | `${PROD_APP_IMAGE}` | `edge-prod`, `prod` | `127.0.0.1:9464` | том `screenshots` | `env_file: prod.env` | `mem_limit: 400m`, `cpus: 1.5`, `pids_limit: 512` |
| `db` | `postgres:18` | `prod` | нет | `pgdata` → `/var/lib/postgresql` | `env_file: prod.env` | `768m`; `shared_buffers=128MB`, `max_connections=50` |
| `app-staging` | `${STAGING_APP_IMAGE}` | `edge-staging`, `staging` | `127.0.0.1:9465` | `tmpfs` скриншотов | `env_file: staging.env` | `400m`, `cpus: 1.0`, `pids_limit: 256` |
| `db-staging` | `postgres:18` | `staging` | нет | `tmpfs: /var/lib/postgresql` (256 МБ) | `env_file: staging.env` | `512m`, `cpus: 0.5`, `pids_limit: 256` |
| `tools-staging` (только `run`) | `${STAGING_TOOLS_IMAGE}` | `staging`, `edge-staging` | нет | `tmpfs: /tmp` | `env_file: staging.env` | `512m`, `cpus: 1.0`, `pids_limit: 256` |

- Профиль `staging` — у трёх staging-сервисов.
- БД: `POSTGRES_USER=app`, `POSTGRES_DB=chezz` — константы в compose; `POSTGRES_PASSWORD` и `DATABASE_URL` — в одном файле `prod.env` / `staging.env`.
- Сети `prod` и `staging` — `internal: true`; `edge-*` дают выход к Google и Sentry. У staging-сервисов нет сетей prod.
- O33 для `app`, `app-staging`, `tools-staging`: `user: "1000:1000"`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `read_only: true`, `tmpfs: /tmp`. Всё, что пишут эти контейнеры, — в `/tmp` или в томе (например, отчёт нагрузки — `/tmp/report.json`, раздел 11).
- Все: `restart: unless-stopped` (кроме `tools-staging`), `logging: {driver: journald, options: {tag: "{{.Name}}"}}`.
- `app`: `depends_on: db: condition: service_healthy`; healthcheck `node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"`, раз в 10 с, `start_period: 60s`. `db`: `pg_isready -U app -d chezz`.
- PostgreSQL 18 везде: prod, staging, `compose.test.yml`, `services:` CI (TESTING §7.1).
- Память: prod ≈ 1,2 ГБ лимитов, со staging ≈ 2,6 ГБ из 4 ГБ (ARCHITECTURE §5).

### 6.2. Образы

`deploy/Dockerfile`, база `node:24-bookworm-slim`:

| Цель | Что внутри | Пакет GHCR (O32) |
|---|---|---|
| `app` | `apps/server` + собранный `apps/web` (с `.map`, O22), только prod-зависимости; `USER node`; `EXPOSE 3000 9464`; `CMD ["node","--enable-source-maps",…]` | `chezz-app` (prod), `chezz-app-staging` |
| `tools` | весь workspace с dev-зависимостями: `apps/server/scripts/seed.ts`, `tests/load/`; `USER node` | `chezz-tools-staging` |

- `ARG APP_VERSION` (git SHA, не секрет) → `ENV APP_VERSION`, метка `org.opencontainers.image.revision`; `app` отдаёт его в `app_info{version}` (API P16).
- `.dockerignore`: `.git`, `.env*`, `node_modules`, `docs`, `.claude`; в цель `app` не попадают `tests/`, `apps/server/test/`, `apps/server/scripts/`.
- Тег `sha-<sha>`; выкатывается всегда `@sha256:<digest>` из того же запуска. Пакеты публичные: VPS тянет без токена.
- Dockerfile, compose, Caddyfile, `deploy/remote/` — зона devops; первая версия — задача скелета.

### 6.3. Caddy

`deploy/Caddyfile`: два сайта, общий сниппет заголовков SECURITY §6 (значения — оттуда), `connect-src` с `wss://{host}` и `https://{$SENTRY_INGEST}`.

```
(headers) {
	header {
		Strict-Transport-Security "max-age=31536000"
		Content-Security-Policy "…SECURITY §6…"
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
		Permissions-Policy "camera=(), microphone=(), geolocation=()"
		-Server
	}
}
{$APP_DOMAIN} {
	import headers
	reverse_proxy app:3000
}
staging.{$APP_DOMAIN} {
	import headers
	reverse_proxy app-staging:3000
}
```

- HTTPS и Let's Encrypt — Caddy сам. MUST NOT: директива `log` у сайтов (O17). Порт 9464 не проксируется (SECURITY S32).

### 6.4. Тестовая БД

`deploy/compose.test.yml` (TESTING §7.1): сервис `db-test`, `postgres:18`, `127.0.0.1:54329:5432`, `POSTGRES_USER=chezz`, `POSTGRES_PASSWORD=chezz`, `tmpfs: /var/lib/postgresql`, `command: postgres -c fsync=off -c synchronous_commit=off -c full_page_writes=off`, healthcheck `pg_isready`. Пароль не секрет.

## 7. Переменные и секреты

Секреты — `secrets` environment; не секреты — `vars` environment (не репозитория). `deploy/env.allowlist` — разделы `[prod]`, `[ops]`, `[staging]`; лишний ключ или значение с `\n`, `$`, кавычкой, обратной кавычкой, `\` — код 2.

| Имя | Раздел | prod | staging | Секрет | Кто читает |
|---|---|---|---|---|---|
| `APP_ENV` | prod / staging | `prod` | `staging` | нет | `app`, сид (отказ на `prod`) |
| `APP_ORIGIN` | prod / staging; vars обоих environments | `https://<домен>` | `https://staging.<домен>` | нет | `app`; smoke и нагрузка (`E2E_BASE_URL`, `LOAD_BASE_URL`) |
| `DATABASE_URL`, `POSTGRES_PASSWORD` | prod / staging | свой | свой | да | `app`, `db` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | prod / staging | свой клиент | свой, Testing (S33) | secret — да | `app` |
| `COOKIE_SECRET` | prod / staging | свой | свой | да | `app` |
| `SENTRY_DSN` | prod / staging | общий проект | то же | нет | `app`, клиент |
| `RATE_LIMIT_IP_PER_MIN` | staging | не задан (300, SECURITY §9) | `100000` | нет | `app` |
| `SEED_TOKEN_SECRET` | staging | — | да (O15) | да | `tools-staging`, шаг smoke |
| `APP_DOMAIN`, `ACME_EMAIL`, `SENTRY_INGEST` | prod → `compose.prod.env`; vars `prod` | да | — | нет | `edge`, скрипты |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (этап 4) | ops | да | — | да | `watch.sh`, `backup.sh` |
| `B2_KEY_ID`, `B2_APP_KEY`, `B2_BUCKET` (этап 4) | ops | да | — | да | `backup.sh`, `backups.sh`, `restore-*.sh` |
| `BACKUP_REQUIRE_OFFSITE` | ops; vars `prod` | `true` с этапа 4 | — | нет | `backup.sh` (O35) |
| `SSH_DEPLOY_KEY` | — | ключ prod | ключ staging | да | шаг SSH |
| `VPS_HOST`, `VPS_HOST_KEY` | vars обоих environments | да | да | нет, но не в git | шаг SSH |

- Файлы на VPS: `prod.env`, `staging.env` — 600 `deploy`; `ops.env` — 640 `deploy:ops`; `compose.*.env` — 640 `deploy:ops`; запись атомарная (временный файл + `mv`).
- Команды staging пишут только `staging.env` и `compose.staging.env` (O10, 6.1); `prod deploy` — `prod.env`, `ops.env`, `compose.prod.env`.
- Передача: шаг получает секреты через `env:` и пишет `printf '%s=%s\n' …` прямо в stdin `ssh`, без файла и вывода.
- Имя `RATE_LIMIT_IP_PER_MIN` — по умолчанию; переименование — developer в той же задаче правит `env.allowlist` и эту таблицу.
- Смена секрета (SECURITY §17): у источника → secret environment → `deploy.yml` той же среды.

## 8. CI

`.github/workflows/ci.yml` — по TESTING §12; здесь только то, что F6 отдал F7:

- Триггеры: `pull_request` (в `main`) и `push` в `main`. `permissions: contents: read`. `concurrency: ci-${{ github.ref }}`, `cancel-in-progress: true` для PR.
- Job `check` и `e2e` — состав, порядок, таймауты 15 и 20 мин — TESTING §12; `services:` — `postgres:18`, порт 54329 (TESTING §7.1).
- `gitleaks` в `check`: `gitleaks git --log-opts="<base>..HEAD"`; находка → job красный (SECURITY S27).
- В `check`: `scripts/check-architecture.sh` — `grep -rn 'example\.com' .github deploy scripts` пусто; `scripts/check-workflows.sh` — у `ci.yml` только `pull_request` и `push: branches: [main]`, у `deploy.yml`/`load.yml` только `workflow_dispatch`; `permissions` каждого job — не шире 9.2; нет `pull_request_target`, `workflow_run`. Проверка вспомогательная (её можно поменять в той же ветке); основная защита — diff `.github/` перед `git push` (раздел 1).
- `e2e`: первый шаг — `git diff --name-only origin/main...HEAD`; всё в `docs/**` → остальные шаги `if: false`, job зелёный (TESTING V19). MUST NOT: `paths`/`paths-ignore` на workflow.
- Обязательные проверки мержа в `main`: `check`, `e2e` (16.1).
- Сторонние actions — по полному SHA; обновляет Dependabot. `actions/checkout` — `persist-credentials: false`.
- PR из форков: `pull_request` без секретов, запуск — после одобрения Ivan (16.1 п.5).

## 9. Выкатка

### 9.1. Поток и подтверждения

| Шаг | Что | Действия Ivan |
|---|---|---|
| 1 | PR смержен в `main`, CI зелёный | подтвердить `gh pr merge` (после diff чувствительных путей, O36) |
| 2 | `deploy.yml` `env=staging`, `--ref main` (или ветка фичи до мержа, TESTING §14 п.6) | подтвердить `gh workflow run` + **1** подтверждение environment `staging` |
| 3 | ручная проверка staging (9.6) | вход через Google |
| 4 | фича трогает горячий путь хода перед этапом 5 или 6 — `load.yml` (TESTING §14 п.7) | +1 подтверждение `staging` |
| 5 | `deploy.yml` `env=prod`, `--ref main`; в итоге job `plan` — изменения инфраструктуры (O37) | подтвердить `gh workflow run` + **1** подтверждение environment `prod` |
| 6 | staging гаснет сам при выкатке prod (9.4 шаг 6) | — |

- Подтверждений environment: подъём staging — 1, выкатка prod — 1, откат — 1, `action=down` — 1, нагрузка — 1.
- Первая выкатка после `bootstrap.sh` (и её повтор, и новый VPS по 14.3) — сразу шаг 5 с `-f bootstrap=true`, без staging (O40, O44); запускает Ivan.
- Изменения только `docs/**` не выкатываются.

### 9.2. Workflow `deploy.yml`

`workflow_dispatch`, входы: `env` (`choice`: `staging` | `prod`), `action` (`choice`: `deploy` | `rollback` | `down`, по умолчанию `deploy`), `image` (строка, только для `rollback`), `force` (`boolean`, по умолчанию `false`), `bootstrap` (`boolean`, по умолчанию `false`; только `env=prod`, `action=deploy`, O44). `run-name: ${{ inputs.env }} ${{ inputs.action }}`. `concurrency: deploy-${{ inputs.env }}`, без отмены. Все входы — через `env:`.

| Job | `needs` и условие | `environment` | Права | Шаги |
|---|---|---|---|---|
| `plan` | всегда | нет | `contents: read`, `actions: read` | проверка сочетаний (`prod`+`down`, `staging`+`rollback`, `prod` не с `main` → ошибка; `image` по regex). Для `prod deploy` без `bootstrap`: `BASE` = `headSha` последнего запуска с `displayTitle == "prod deploy"` и `conclusion == success` (`gh run list --workflow deploy.yml --branch main --event workflow_dispatch --json displayTitle,headSha,conclusion -L 200`); не найден → ошибка «нужен `bootstrap=true`». `git diff --stat $BASE..HEAD -- deploy/ scripts/ops/ .github/ apps/server/migrations/` → `$GITHUB_STEP_SUMMARY`. С `bootstrap=true`: `BASE=bootstrap`, в итог — полный список файлов `deploy/` и `.github/` (`git ls-files`) и пометка «bootstrap: проверка базы пропущена». Выход: `base` |
| `build` | `needs: plan`; `if: inputs.action == 'deploy'` | нет | `contents: read`, `packages: write` | `checkout` → `docker buildx build`: `env=prod` → `app` в `chezz-app`; `env=staging` → `app` в `chezz-app-staging`, `tools` в `chezz-tools-staging`; `APP_VERSION=${{ github.sha }}`; выход — digest. Скриптов репозитория на runner не запускает |
| `prod` | `needs: [plan, build]`; `if: always() && needs.plan.result == 'success' && inputs.env == 'prod' && (needs.build.result == 'success' \|\| needs.build.result == 'skipped')` | `prod` | `contents: read` | один шаг SSH: `deploy <sha> <digest> <base> [force]` или `rollback [<digest>]`; вывод `result=…` и `status` (9.3) — в итог |
| `staging` | то же условие с `inputs.env == 'staging'` | `staging` | `contents: read` | 9.6 |

- SSH-шаг: ключ из `SSH_DEPLOY_KEY` в `$RUNNER_TEMP`, `known_hosts` из `VPS_HOST_KEY`, `StrictHostKeyChecking yes`; файл ключа удаляется в том же шаге (`trap`).
- `build` из ветки запускается без подтверждения и публикует образ в `chezz-*-staging` — допустимо: образ без секретов, в prod не попадает (O32).
- Запуск, отказавший в `deploy.sh` (код 1 и выше), — `conclusion: failure` и как база O41 не учитывается.

### 9.3. Команды на VPS и коды

`deploy/remote/entry.sh <среда>` (из `command=`): копирует `deploy/remote/` во временный каталог (`mktemp -d`) и запускает копию — правка клона во время работы на неё не влияет. Разбирает `$SSH_ORIGINAL_COMMAND` по белому списку: SHA — `^[0-9a-f]{40}$`, база — SHA или `bootstrap`, digest — `^sha256:[0-9a-f]{64}$`; иначе код 2. Долгие команды идут через `setsid` с журналом в `state/last-<среда>.log`; `entry.sh` выводит журнал до конца и код выхода; обрыв SSH скрипт не останавливает.

| Среда | Команда | Действие |
|---|---|---|
| prod | `deploy <sha> <digest> <base\|bootstrap> [force]` + секреты в stdin | 9.4 |
| prod | `rollback [<digest>]` | 9.5 |
| prod | `status` | ниже |
| staging | `up <app-digest> <tools-digest>` + секреты в stdin | 9.6 |
| staging | `down` | `docker compose … --profile staging rm -sfv app-staging db-staging` |
| staging | `load` | раздел 11 |
| staging | `status` | ниже, для staging |

Коды выхода, одинаковые для обеих сред (последняя строка — `result=<имя>`):

| Код | `result` | Значит | `/release` делает |
|---|---|---|---|
| 0 | `ok` | готово | отчёт |
| 1 | `rolled_back` (prod) / `up_failed` (staging) | prod на прошлом образе / staging не поднялся | сообщить Ivan, лог |
| 2 | `bad_command` | неверный вход или проверка (digest, SHA, allowlist) | ошибка workflow — сообщить Ivan |
| 3 | `prod_busy` | на prod > 10 партий (выкатка) или > 2 (нагрузка) | повторить позже |
| 4 | `broken` | откат не прошёл | срочно Ivan |
| 5 | `backup_failed` | бэкап перед выкаткой не удался, выкатки не было | сообщить Ivan |
| 6 | `base_mismatch` | SHA клона ≠ база из `plan` (O41) | сообщить Ivan |
| 7 | `prod_missing` | staging до первой выкатки prod (O40) | выкатить prod |

`status` — строки `ключ=значение`:
```
env=prod
image=sha256:…
revision=<sha>
repo=<sha клона>
health=healthy|unhealthy|starting|absent
restarts=0
started_at=2026-11-05T10:00:00Z
players_online=12
games_active=3
backup_mode=local|offsite
last_backup=2026-11-05T03:30:12Z|none
disk_used_pct=41
staging=up|down
```

### 9.4. Выкатка prod и проверки

`deploy.sh prod deploy <sha> <digest> <base> [force]`:
0. `games_active` > 10 и нет `force` → код 3 (O38).
1. Секреты из stdin → разделы `[prod]`, `[ops]` → `prod.env`, `ops.env`, `compose.prod.env`.
2. Клон: `base` = `bootstrap` → проверка базы пропускается (O44); иначе SHA клона ≠ `base` → код 6. `git fetch origin main`; `git merge-base --is-ancestor <sha> origin/main`, иначе код 2; SHA клона → `state/prod.repo.prev`; `git checkout --detach <sha>`.
3. `docker pull ghcr.io/<owner>/chezz-app@<digest>`; метка `revision` = `<sha>`, иначе код 2.
4. `backup.sh --reason pre-deploy` (14.1); ошибка → код 5. Контейнер `db` не запущен → пропуск, `backup=skipped_no_db`.
5. `state/prod.image` → `state/prod.image.prev`; новый digest → `state/prod.image` и `PROD_APP_IMAGE`; строка в `state/prod.history` (`время digest sha deploy`).
6. staging запущен → `rm -sfv app-staging db-staging` (O5).
7. `docker compose … up -d --wait --wait-timeout 120 edge db app` (миграции — при старте `app`, ARCHITECTURE A18).
8. Проверки (smoke prod), все обязательны; `revision` — ожидаемый SHA:
   - а) `curl -fsS http://127.0.0.1:9464/metrics` содержит `app_info{version="<revision>"} 1`;
   - б) `curl -fsS https://$APP_DOMAIN/api/health` = `{"status":"ok"}`;
   - в) в ответе б) есть `Strict-Transport-Security` и `Content-Security-Policy`;
   - г) через 60 с `docker inspect -f '{{.RestartCount}}'` у `app` = 0 и б) снова `ok`.
9. Провал 7 или 8 → `restore_prev` (9.5) → успех — код 1, провал — код 4.
10. `docker image prune -af --filter until=168h`.

- Пример: миграция с ошибкой SQL → `app` не здоров 120 с → `restore_prev` возвращает клон и образ, `result=rolled_back`, job `prod` красный. Схема не изменилась: Kysely Migrator выполняет миграцию в транзакции.
- После выкатки Ivan открывает сайт и входит своим аккаунтом (не условие успеха job).

### 9.5. Откат

Функция `restore_prev` (общая для 9.4 п.9 и команды `rollback`), вход — целевой digest и признак «вернуть клон»:
1. Если «вернуть клон» — `git checkout --detach $(cat state/prod.repo.prev)`.
2. `docker pull ghcr.io/<owner>/chezz-app@<цель>`; `revision` цели — из её метки.
3. `state/prod.image` ← цель; `PROD_APP_IMAGE` в `compose.prod.env` ← цель; строка `restore` в `prod.history`.
4. `docker compose … up -d --wait --wait-timeout 120 app`.
5. Проверки 9.4 п.8 а–г с `revision` цели. Успех → 0, провал → 4.

Команда `rollback [<digest>]`:
1. Цель: `<digest>`, только если он есть в `state/prod.history`; без аргумента — `state/prod.image.prev`; нет — код 2.
2. Текущий digest → `state/prod.image.prev`; строка `rollback` в `prod.history`.
3. `restore_prev` с целью, без возврата клона (схема и compose не меняются, ARCHITECTURE §5); бэкапа нет.

- Агенты запускают только `action=rollback` без `image`. Конкретный digest — Ivan: `image=` из итога job `prod` прошлых запусков.
- Данные испорчены выкаткой — откат образа + восстановление из бэкапа `pre-deploy` по 14.3 шаги 5–7. Решает и делает Ivan.

### 9.6. staging и его smoke

Job `staging` в `deploy.yml` (`action=deploy`), шаги строго по порядку (раздел 1):
1. SSH: `up <app-digest> <tools-digest>` + секреты `[staging]` в stdin. На VPS: нет `state/prod.image` → код 7; секреты → `staging.env`; шаблон → `compose.staging.env`; клон не меняется; `rm -sfv` старых staging-сервисов → `up -d --wait app-staging db-staging` → `run --rm tools-staging node apps/server/scripts/seed.ts --demo` → `state/staging.started`. Сбой → код 1 `up_failed`.
2. `checkout` ref (`persist-credentials: false`) → `npm ci` → `npx playwright install chromium`.
3. `E2E_BASE_URL=${{ vars.APP_ORIGIN }} npm run test:e2e -- --grep @smoke --project=desktop` (TESTING §9); `SEED_TOKEN_SECRET` — env этого шага.
4. После шагов 2–3 SSH не вызывается; staging остаётся поднятым для ручной проверки.

`action=down` — job `staging` с одним SSH-шагом `down`.

Ручная проверка (Ivan, TESTING V17): вход через Google тестовым пользователем → выбор ника → лобби → выход. Фича про удаление аккаунта — удаление по SECURITY §4.1.

Гашение: выкатка prod (9.4 п.6), `action=down` или `chezz-staging-ttl.timer` — `staging.started` старше 12 ч → `down`.

- Код ветки в шагах 2–3 видит `SEED_TOKEN_SECRET` — принятый риск SECURITY §17: секрет даёт вход только на staging с сид-данными.
- Ограничение: compose и скрипты staging — из клона на SHA последней выкатки prod (O9). Изменение `deploy/**` проверяется проверками 9.4 п.8 с возвратом клона.

### 9.7. Окна и плановые работы

- Выкатка prod — не плановая работа (O13); при > 10 активных партиях — отказ (O38), `force=true` — только для исправления аварии, решает Ivan.
- Плановая работа — ожидаемый простой > 5 мин: смена мажорной версии PostgreSQL, переезд VPS, восстановление БД. Объявление за 24 ч (ТЗ §5), канал — F7-Q5.

## 10. Команды для `/release`

Только эти команды; `gh api` не нужен (раздел 1). `gh workflow run` — через `ask` (16.3); затем Ivan подтверждает environment в GitHub.

Запуск и поиск своего run (диспатч асинхронный, допуск часов 10 с):
```
START=$(date -u -d '-10 sec' +%Y-%m-%dT%H:%M:%SZ)
gh workflow run deploy.yml --ref "$REF" -f env=staging          # или: --ref main -f env=prod
for i in $(seq 1 20); do
  RUN=$(gh run list --workflow deploy.yml --event workflow_dispatch --branch "$REF" \
        --json databaseId,createdAt -q "[.[] | select(.createdAt >= \"$START\")] | first | .databaseId")
  [ -n "$RUN" ] && break; sleep 3
done
```
- `gh run list` отдаёт новые первыми; `first` — самый новый после `START`. Оркестратор не запускает два `deploy.yml` одновременно.

Ожидание (опрос раз в 30 с, всего ≤ 60 мин):
```
S=$(gh run view "$RUN" --json status -q .status)
# waiting                → «ждёт подтверждения Ivan» (environment), ждать дальше
# queued | in_progress   → идёт
# completed              → итог ниже
gh run view "$RUN" --json conclusion -q .conclusion
gh run view "$RUN" --log | grep -m1 -o 'result=[a-z_]*'
```
- Значение `result=` → действие по таблице кодов 9.3.
- 60 мин в `waiting` → отчёт «ждёт Ivan», run не отменять.
- `conclusion=failure` без строки `result=` — упал job `plan` или `build`: `gh run view "$RUN" --log-failed | tail -50`, сообщить Ivan.

Другие запуски (тот же поиск run):
```
gh workflow run deploy.yml --ref main -f env=prod -f action=rollback     # откат на прошлый
gh workflow run deploy.yml --ref main -f env=staging -f action=down
gh workflow run load.yml --ref "$REF"
```
- Откат на конкретный digest (`-f image=sha256:…`), `-f force=true` и `-f bootstrap=true` — только Ivan.

## 11. Нагрузочный тест

`.github/workflows/load.yml`, `workflow_dispatch` из ветки: `plan` → `build` (обе цели, пакеты `*-staging`) → job `load` в environment `staging`, только SSH-шаги, без кода ветки на runner:
1. `up <app> <tools>` (9.6 п.1).
2. `load`: `entry.sh` — `games_active` prod > 2 → код 3. Иначе `docker compose -p chezz run --rm -e LOAD_REPORT=/tmp/report.json tools-staging sh -c 'node apps/server/scripts/seed.ts --load 150 --tokens /tmp/tokens && LOAD_TOKENS=/tmp/tokens LOAD_BASE_URL="$APP_ORIGIN" node tests/load/run.ts; rc=$?; cat /tmp/report.json; exit $rc'` (`APP_ORIGIN` — из `staging.env`).
3. `report.json` → итог job; код ≠ 0 при нарушении порога (TESTING §10).
4. `down` — `if: always()`.

- Файл токенов и отчёт — только в `tmpfs` `/tmp` контейнера (`read_only`, 6.1); в артефакты, логи и stdout токены не попадают (TESTING §7.6). Путь отчёта задаёт `LOAD_REPORT` (правка TESTING §10 — §23).
- Память и задержку event loop `app-staging` генератор читает с `app-staging:9464/metrics` по сети `staging`.

## 12. Наблюдаемость

### 12.1. Логи

- `app` (`pino`, SECURITY §15) и `edge` (только ошибки) → journald, 14 дней (O17).
- O18: сериализатор пути `pino` и `beforeSend`/`beforeBreadcrumb` Sentry заменяют сегмент после `/challenge/` и `/api/challenges/` на `:id`. Пример: `/api/challenges/3f2c…/accept` → `/api/challenges/:id/accept`. `/game/<id>` не маскируется.
- `app` пишет строку `{"event":"account_deleted","user_id":"…"}` при удалении аккаунта (для 14.3; без ПДн).
- Чтение — Ivan: `scripts/ops/logs.sh app 1h` → `journalctl CONTAINER_TAG=chezz-app-1 --since -1h -o cat`.

### 12.2. Метрики `app`

Требование к `app` (developer, `platform`; правка ARCHITECTURE A22 — §23):

| Метрика | Тип | Что |
|---|---|---|
| `app_info{version}` | gauge = 1 | SHA образа (API P16) |
| `chezz_players_online` | gauge | User с открытым WebSocket |
| `chezz_games_active` | gauge | Game в статусе `active` |
| `chezz_move_delivery_seconds` | summary, квантили 0.5/0.95/0.99, окно 5 мин | от приёма `game.move` до отправки `game.moved` сопернику (после коммита) |
| `nodejs_eventloop_lag_p99_seconds`, `process_resident_memory_bytes`, `process_cpu_seconds_total` | стандартные `prom-client` | event loop, память, CPU |

### 12.3. `watch.sh` v1 (этап 4)

`deploy/remote/watch.sh`, таймер раз в минуту, `deploy`:
- Читает `127.0.0.1:9464/metrics` и дописывает строку в `/var/lib/chezz/metrics/<дата>.csv`: время, online, games, p95 хода (мс, квантиль summary без пересчёта), p99 event loop (мс), RSS (МБ). Файлы старше 90 дней удаляет.
- Правила AL3, AL6, AL7, AL8, AL9 (раздел 13); алерт — один раз при срабатывании и «восстановлено»; состояние — `state/alerts/<правило>`.
- 09:00 UTC — сводка за сутки в Telegram: пики online, games, p95, p99 event loop, RSS, `last_backup`. По ней Ivan видит признаки ARCHITECTURE §15 «3 дня подряд».
- Больше правил — только по разделу 19.

### 12.4. Sentry

С первой выкатки. Проект один, `environment` = `APP_ENV`, `release` = `APP_VERSION`; данные — SECURITY §15. Алерт «новая проблема в `prod`» → e-mail (O20).

### 12.5. Внешний пинг

С первой выкатки. UptimeRobot: `https://<домен>/api/health`, ключевое слово `"ok"`, раз в 5 мин, Telegram через интеграцию UptimeRobot. Месячный процент — отчёт по ТЗ §5 (с учётом O31).

## 13. Алерты

Дежурства нет (O30). Telegram — кроме отмеченных.

| # | Условие | Кто | С какого этапа | Первое действие |
|---|---|---|---|---|
| AL1 | `/api/health` не `ok` 2 проверки подряд | UptimeRobot | первая выкатка | `ssh ops@… scripts/ops/status.sh`, логи; последняя выкатка → `rollback` |
| AL3 | p95 хода > 150 мс 5 мин подряд при `games_active` ≥ 5 (порог ТЗ §5) | `watch.sh` | 4 | логи и Sentry за это время, последняя выкатка → `rollback`; повторяется в сводке 3 дня — ARCHITECTURE §15, строка 1 |
| AL6 | диск > 80% | `watch.sh` | 4 | `docker system df`, журнал, бэкапы |
| AL7 | том `screenshots` > 8 ГБ (предупреждение), > 10 ГБ (раз в сутки) | `watch.sh` | 4 | SECURITY §11, ARCHITECTURE §15 |
| AL8 | бэкап упал или последний успешный > 26 ч | `backup.sh`, `watch.sh` | 4 | `journalctl -u chezz-backup` |
| AL9 | проверка восстановления > 32 дней (напоминание 1-го числа) | `watch.sh` | 4 | раздел 14.2 |
| AL11 | новая проблема Sentry в `prod` | Sentry, e-mail | первая выкатка | Sentry |
| AL12 | job CI или выкатки упал | GitHub, e-mail | первая выкатка | `gh run view` |

## 14. Бэкапы и восстановление

### 14.1. Ежедневный бэкап

`deploy/remote/backup.sh` (таймер 03:30 UTC и 9.4 шаг 4), `set -euo pipefail`. Режим:
- `offsite` — есть `deploy/backup.age.pub` и `B2_*`:
  ```
  docker compose -p chezz exec -T db pg_dump -U app -d chezz -Fc \
    | age -R /srv/chezz/repo/deploy/backup.age.pub \
    > /var/backups/chezz/chezz-<UTC>-<daily|pre-deploy>.dump.age
  rclone copyto <файл> b2:$B2_BUCKET/<имя>
  ```
  после загрузки — сообщение в Telegram: `backup <имя> sha256=<хэш> size=<байт>` (O42).
- `local` (до этапа 4, O35) — тот же `pg_dump` в `/var/backups/chezz/…dump` (каталог 700), без выгрузки. При `BACKUP_REQUIRE_OFFSITE=true` режим `local` — ошибка (AL8, код 5 выкатки). Первый запуск `offsite` удаляет нешифрованные дампы и меняет права каталога (раздел 5 п.7).

- На VPS — 3 последних файла. В B2 — Object Lock (compliance, 14 дней), правило жизненного цикла удаляет через 15 дней. Ключ B2 на VPS — `listBuckets`, `listFiles`, `readFiles`, `writeFiles`, без `deleteFiles` и прав на блокировку (SECURITY §14).
- Успех → `state/last-backup`; в `status` — `backup_mode`, `last_backup`.
- Открытый ключ `age` — `deploy/backup.age.pub` (не секрет); закрытый — только у Ivan (S21).

### 14.2. Ежемесячная проверка восстановления

С этапа 4. Ivan со своей машины (ключ по stdin, на диск VPS не пишется, SECURITY S35):
```
ssh ops@<vps> /srv/chezz/repo/scripts/ops/restore-check.sh < ~/keys/chezz-backup.age.key
```
Скрипт: последний файл из `/var/backups/chezz` (или `--from-b2 <имя>`) → `docker run -d --name chezz-restore --network none -e POSTGRES_HOST_AUTH_METHOD=trust --tmpfs /var/lib/postgresql postgres:18` → `age -d -i - <файл> | docker exec -i chezz-restore pg_restore -U postgres --create --no-owner -d postgres` → число строк `users`, `games`, `ratings`, `rating_history`, `feedback` против prod (≤ prod и > 0) → `docker rm -f chezz-restore` (`trap`) → строка в `/var/lib/chezz/restore-check.log`: дата, файл, размер, время, счётчики, `OK`/`FAIL`. Время — фактическая оценка RTO.

### 14.3. Авария: потерян VPS или БД

RPO ≤ 24 ч, RTO ≤ 4 ч рабочего времени Ivan (O26, O31). Делает Ivan:
1. Новый VPS (тот же провайдер и регион), `deploy/bootstrap.sh`.
2. DNS `A` `@` и `staging` → новый IP (TTL заранее 300 с).
3. vars `VPS_HOST`, `VPS_HOST_KEY` в обоих environments.
4. `deploy.yml` `env=prod`, `bootstrap=true` — `edge`, `db` с пустым томом и `app` (проверка базы пропущена, O44; бэкап `skipped_no_db`).
5. Выбрать файл: `ssh ops@<vps> /srv/chezz/repo/scripts/ops/backups.sh` — список B2 через нативный API (`b2_list_file_versions`): имя, **серверный** `uploadTimestamp`, `retainUntil`, SHA-1 B2. Подходит файл, у которого `uploadTimestamp` раньше инцидента и есть сообщение Telegram `backup <имя> sha256=…`, отправленное до инцидента (O42). Время и имя из `rclone lsl` не используются: их задаёт загружающий.
6. Восстановление:
   - `offsite`: `ssh ops@<vps> /srv/chezz/repo/scripts/ops/restore-prod.sh --from-b2 <имя> --sha256 <хэш из Telegram> < ~/keys/chezz-backup.age.key`;
   - `local` (до этапа 4, VPS жив, БД испорчена): `ssh ops@<vps> /srv/chezz/repo/scripts/ops/restore-prod.sh --local <файл .dump>` — без ключа.
   - Скрипт: сверяет SHA-256 (для `offsite`), останавливает `app`, пересоздаёт базу `chezz`, `pg_restore --no-owner --no-privileges` ролью `app` (не `postgres`), выполняет `logout-everyone.sql`, печатает `user_id` из строк `account_deleted` журнала после времени бэкапа (12.1), запускает `app`.
7. Удаления после бэкапа: напечатанные `user_id` Ivan записывает в Issue (без ПДн) и повторяет их удаление, когда появится способ (F7-Q8). При потере VPS журнала нет — эти удаления не восстановить (принятое отступление O31 п.2). Smoke prod (9.4 п.8), сообщение игрокам по каналу F7-Q5.

- Потеря только БД — шаги 5–7.
- Принятый риск: дамп не подписан (подписать без ключа на VPS нельзя) — защита выбором файла в шаге 5 и сверкой SHA-256.

## 15. Кто и что может в проде

| Кто | Может | Не может |
|---|---|---|
| Ivan | SSH `ops`: `scripts/ops/` (SECURITY §16: `ro.sh`, `logout-everyone.sql`, `feedback-recent.sql`, `logs.sh`, `status.sh`, `backups.sh`, `restore-check.sh`, `restore-prod.sh`), `bootstrap.sh`; подтверждать push, мерж, запуск workflow и environments; секреты и настройки GitHub; `image=` и `force=` | произвольный `UPDATE`/`DELETE`, копия БД prod к себе или в staging |
| CI, ключ prod | только команды prod из 9.3 | staging, shell, проброс портов |
| CI, ключ staging | только команды staging из 9.3; пишет только `staging.env`, `compose.staging.env` | prod, клон, shell |
| job `build` | push в `chezz-app` (только `env=prod` на `main`) и `chezz-*-staging` | секреты сред, SSH |
| оркестратор | команды раздела 10; `git push`, `gh pr merge`, `gh workflow run` — с подтверждением Ivan | раздел 1 и 16.3 |
| агенты | писать `deploy/**`, `scripts/ops/**`, текст workflow в рабочей копии | коммит, push, SSH, секреты, запуск `scripts/ops/` |
| посторонние, форки | PR: `ci.yml` без секретов после одобрения Ivan | `workflow_dispatch`, environments |

## 16. Настройки GitHub, учётная запись, правила Claude Code

### 16.1. GitHub

Включает Ivan один раз, до первой выкатки (O29); включение SECURITY S24, §17 и TESTING V19:

1. Ruleset `main`: только через PR; обязательные проверки `check`, `e2e`; запрет force push и удаления; обхода нет.
2. `.github/CODEOWNERS`: `/.github/`, `/deploy/`, `/scripts/ops/`, `/LICENSE`, `/docs/SECURITY.md`, `/docs/OPERATIONS.md` → `@<owner>`. Обязательное ревью владельца не включается (одна учётная запись, свой PR GitHub одобрить не даёт); замена — diff по O36.
3. Environment `prod`: Deployment branches — только `main`; Required reviewers — Ivan; secrets и vars раздела 7.
4. Environment `staging`: Required reviewers — Ivan; ветки — все ветки репозитория (форки `workflow_dispatch` не запускают); secrets и vars раздела 7.
5. Actions: `GITHUB_TOKEN` по умолчанию — чтение; «Allow GitHub Actions to create and approve pull requests» — выкл.; PR из форков — «Require approval for all external contributors».
6. Security: secret scanning и push protection, Dependabot alerts и security updates; `.github/dependabot.yml`: `npm` (`/`), `github-actions` (`/`), `docker` (`/deploy`) — раз в неделю.
7. Packages `chezz-app`, `chezz-app-staging`, `chezz-tools-staging` — Public, связаны с репозиторием.

### 16.2. Учётная запись

O36, O43: учётная запись одна — Ivan. Сессия Claude Code (оркестратор и всё, что запускают агенты: `npm test`, `npx`, скрипты) работает только с fine-grained токеном (`GH_TOKEN`):
- Repository access — только этот репозиторий;
- Contents — Read and write; Pull requests — Read and write; Actions — Read and write (`gh workflow run`, `gh run`); Metadata — Read;
- нет: Administration, Environments, Secrets, Variables, Workflows и остальных.
- Полный `gh auth` Ivan в этой сессии не залогинен (`gh auth status` показывает только токен); им Ivan пользуется вне Claude Code — в том числе пушит коммиты с `.github/workflows/**` (CODEOWNERS, SECURITY S24).
- Так environments, ruleset и секреты не меняет даже код, обходящий строковые правила 16.3; мерж и dispatch упираются в подтверждение environment и diff O37/O41. Срок токена — до 1 года, продление — Ivan.

### 16.3. Правила Claude Code (`.claude/settings.json`)

Файл правит только Ivan (F8). Правила Claude Code сравнивают начало команды, поэтому запрет флагов (`gh api -X`) обходится флагом после пути, неявным POST (`-f`/`--input`) и `gh api graphql`. Закрывается только целиком по подкоманде (O39). Условие первой выкатки (раздел 20):

```
"deny": [
  "Bash(gh auth:*)",
  "Bash(gh secret:*)",
  "Bash(gh variable:*)",
  "Bash(gh repo edit:*)",
  "Bash(gh repo delete:*)",
  "Read(~/.config/gh/**)",
  "Read(~/AppData/Roaming/GitHub CLI/**)"
],
"ask": [
  "Bash(git push:*)",
  "Bash(gh workflow run:*)",
  "Bash(gh pr merge:*)",
  "Bash(gh api:*)",
  "Bash(gh pr review:*)",
  "Bash(gh run cancel:*)",
  "Bash(gh run rerun:*)",
  "Bash(gh workflow enable:*)",
  "Bash(gh workflow disable:*)",
  "Bash(gh release:*)",
  "Bash(curl:*)",
  "Bash(wget:*)"
]
```
- Существующие `deny` (`.env`, `git push --force`, `-f`) остаются.
- `gh api` нужен только CI (`plan`), не оркестратору: команды раздела 10 его не используют. Любой `gh api` у оркестратора — подтверждение Ivan с показом команды; Ivan отклоняет всё, что не GET и не понятно.
- `curl`/`wget` в `ask`: иначе тот же REST GitHub доступен с токеном. `deny` на чтение файлов `gh` — токен не читается из конфигурации (на Windows `gh` хранит его в Credential Manager; `gh auth token` — в `deny`).
- MUST NOT: переносить эти правила в `allow`; обёртки (`env X=1 gh api`, `bash -c "gh api …"`, свой скрипт) — запрещены разделом 1; Ivan отклоняет такие запросы.
- Правила 16.3 — страховка поверх прав токена 16.2 (O43), а не основная защита: исполняемый код их не проходит.

## 17. Лицензия и публичный репозиторий

- O28: `LICENSE` в корне — полный текст GPL-3.0 с gnu.org; `"license": "GPL-3.0-or-later"` в корневом `package.json` и у workspaces. Совместима с chessground (GPL-3.0-or-later) и `cburnett` (GPL-2.0-or-later). Лицензии `merida` и звуков проверяет Ivan и записывает в `LICENSE.md` их папок (DESIGN U33). Файл создаёт задача скелета; лицензию подтвердил Ivan (утверждение F7, 2026-11-05).
- Перед открытием репозитория (или сразу, если открыт): `gitleaks git .` по всей истории — 0 находок (TESTING §18.2 п.10). Найден секрет → сменить у источника.
- MUST NOT в репозитории: IP VPS, ключ хоста, имя бакета B2, ID чата Telegram, личные e-mail. Допустимы: домен, имена `ops`/`deploy`, открытый ключ `age`.

## 18. Чего не делаем и почему

| Что | Почему нет | Когда вернуться |
|---|---|---|
| Kubernetes, Swarm, Nomad | один VPS, один человек (D4, D6) | второй сервер (ARCHITECTURE §15) |
| Terraform, Ansible | одна машина, `bootstrap.sh` хватает | вторая машина |
| Prometheus, Grafana, Loki | память (A22); CSV + сводка | раздел 19 |
| Реплика БД, WAL-архив | RPO 24 ч достаточно ТЗ §5 | раздел 19 |
| Blue-green, канарейки | перезапуск `app` — секунды (A10) | > 1% прерванных партий из-за выкаток (ARCHITECTURE §15) |
| Дежурство | D4; отступление O31 | платная бета или второй сопровождающий |
| Снимки диска у провайдера | бэкап + `bootstrap.sh` | раздел 19 |
| Бэкап скриншотов | O24 | — |
| Отдельная учётная запись агентов | агенты не пушат (O36) | агенты получат право push |
| Подписанные теги для выкатки | O37, O41 + подтверждение prod | изменения `deploy/**` попадут в `main` без ведома Ivan |
| Подпись дампов | нужен ключ на VPS | — (14.3, принятый риск) |

## 19. План роста

| Признак | Шаг |
|---|---|
| Сбой, который AL1 и Sentry не поймали (зависший `app`, утечка памяти, медленный event loop, сертификат) | правило в `watch.sh` под этот случай: перезапуски `app`, RSS > 300 МБ, p99 event loop > 50 мс, срок сертификата |
| Таймер `watch.sh` или бэкапа молча умер хотя бы раз | dead-man switch Healthchecks.io (бесплатно) |
| Восстановление в 14.2 > 30 мин или БД > 5 ГБ | бэкап раз в 6 ч или WAL-архив в B2 |
| Две аварии VPS за квартал | снимки диска; запасной VPS по 14.3 |
| Нужны графики за месяцы | Prometheus с хранением 15 дней на том же VPS (≈ 200 МБ) |
| Ошибок Sentry > 5 000 в месяц | sample rate клиента 0,5 или платный тариф |
| Второй `app` (ARCHITECTURE §15) | выкатка по очереди двух `app`, health на каждом |
| staging нужен дольше 12 ч (ARCHITECTURE §15) | постоянный staging с томом и бэкапом |

## 20. Что нужно от Ivan и когда

| Когда | Что | Раздел |
|---|---|---|
| При утверждении F7 — сделано (2026-11-05) | Подтверждены O31 (оба пункта), e-mail для ошибок Sentry, B2, GPL-3.0-or-later; F7-Q9 → O43 | 3, 13, 16, 17 |
| До открытия репозитория / сразу | `gitleaks` по истории; 16.1 п.1, 2, 5, 6 | 16, 17 |
| До первой выкатки (конец этапа 1) — **условие** | Fine-grained токен 16.2 в сессии Claude Code, полный `gh auth` в ней разлогинен (O43); правила 16.3 в `.claude/settings.json` (O39); первая выкатка с `bootstrap=true` (O44); провайдер и регион VPS (F7-Q1), домен и DNS `@`, `staging` (F7-Q2); `bootstrap.sh`; клиенты Google OAuth prod и staging (redirect `https://<домен>/auth/google/callback`); environments, secrets, vars; аккаунты Sentry и UptimeRobot (+ Telegram); два ключа SSH выкатки | 5, 7, 12, 16 |
| Этап 4, до первого внешнего игрока | Бакет B2 с Object Lock и ключ без удаления; пара ключей `age`; бот Telegram для VPS; `BACKUP_REQUIRE_OFFSITE=true`; `watch.sh` v1; первая проверка восстановления | 12.3, 14 |
| До этапа 5 | Канал объявлений (F7-Q5); тестовые пользователи клиента Google staging; F7-Q8 | 9.7, 9.6, 14.3 |
| Каждый месяц (с этапа 4) | Проверка восстановления | 14.2 |
| Каждая выкатка | 1 подтверждение staging, ручной вход, 1 подтверждение prod (9.1) | 9 |

## 21. Открытые вопросы

| № | Вопрос | Владелец |
|---|---|---|
| F7-Q1 | Провайдер и регион VPS (ARCHITECTURE F2-Q5): KVM, 2 vCPU / 4 ГБ / ≥ 40 ГБ SSD, Ubuntu 24.04, IPv4, регион основной аудитории (ТЗ §5), ориентир ≤ 25 USD/мес | Ivan, до первой выкатки |
| F7-Q2 | Домен (ТЗ §8): Caddy, `APP_ORIGIN`, redirect Google, `canonical`, `sitemap.xml` | Ivan, до первой выкатки |
| F7-Q5 | Где объявлять плановые работы за 24 ч (ТЗ §5): баннер (нужны F4, F5) или внешний канал | Ivan, до этапа 5 |
| F7-Q8 | Повтор удалений после восстановления (ТЗ §5, SECURITY §13): (1) инструмент повтора `auth`-удаления по списку `user_id` (меняет SECURITY S23, §23 п.9); (2) источник списка при потере VPS — например, `account_deleted` (только `user_id`) отдельным файлом в B2 рядом с бэкапом. До решения — принятое отступление O31 п.2 | Ivan, до этапа 5 |

Закрыты: F7-Q7 → O36; решением человека (Ivan, утверждение F7, 2026-11-05): F7-Q3 → O28 (GPL-3.0-or-later), F7-Q4 → O23 (Backblaze B2), F7-Q6 → O20 (ошибки Sentry на e-mail), F7-Q9 → O43 (fine-grained токен); O31 подтверждён целиком. F7-Q8 остаётся открытым до этапа 5.

## 22. Закрытые пункты других документов

| Пункт | Где закрыт |
|---|---|
| ARCHITECTURE §5: место копий, проверка восстановления, плановая ли выкатка, выкатка только через CI; A22 сборщик и алерты; §14 мессенджер, хранилище, сборщик | O13, O19–O23, разделы 9, 12–14 |
| SECURITY S8/§6 Caddyfile; §14 ротация логов, хранилище без удаления, скрипт проверки; §16 SSH, `command=`; §17 защита GitHub, сборка без секретов, `deploy/**` из `main`; §11 алерт скриншотов; §18 CI | 6.3, 12.1, 14, 5, 9.3–9.4, 16, 13 (AL7), 8 |
| API P16 (версия в smoke), §17.2 п.15 (`/challenge/<id>` в логах) | 9.4 п.8а; O18 |
| DESIGN §18.2 п.10 (`LICENSE`) | 17, O28 |
| TESTING §18.2 п.8 (compose.test, ci.yml, обязательные проверки, нагрузка, файл токенов, smoke, версия PostgreSQL, форки), п.10 (публичный репозиторий — часть F7) | 6.4, 8, 16, 11, 9.6, 6.1, 17 |
| ADR-0004 (подробности workflow staging) | 9.2, 9.6 |

## 23. Правки утверждённых документов (для reopen)

Не правлены здесь; до reopen агенты следуют F7 в вопросах эксплуатации. Выполнять вместе с остальными (reopen F1 + F2 одним заходом, `docs/setup/log.md`).

F2 `docs/ARCHITECTURE.md`:
1. §5: staging — `staging.<домен>`, сети и ужесточение 6.1, `tools-staging`; выкатка не плановая работа (O13); бэкап — B2 (O23).
2. A22, §14: мониторинг по этапам (O19), метрики 12.2; внешние сервисы: UptimeRobot, Telegram Bot API, Backblaze B2, GHCR (публичные пакеты).
3. §13: содержимое `deploy/` (6, 9.3, 14), `scripts/ops/`, `scripts/check-workflows.sh`, `.github/workflows/{ci,deploy,load}.yml`, `.github/CODEOWNERS`, `.github/dependabot.yml`, `LICENSE`.

F3 `docs/SECURITY.md`:
4. §15: маскировка `:id` вызовов (O18); у Caddy нет access-лога; строка `account_deleted` с `user_id` (12.1).
5. §14: логи — journald `MaxRetentionSec=14day` (O17); до этапа 4 — нешифрованный локальный дамп на VPS (O35); выбор дампа по серверному времени и SHA-256 из Telegram (O42); при потере VPS удаления после бэкапа не восстановить (O31 п.2) — упомянуть в политике (§12).
6. §17: секреты — `SEED_TOKEN_SECRET`, `TELEGRAM_*`, `B2_*`; «токен GHCR» → `GITHUB_TOKEN` job `build`, пакеты публичные, раздельные (O32); один пользователь `deploy` с двумя ключами (O9); пользователь Ivan — `ops`, `sudo` с паролем; vars `VPS_HOST*` — в environments.
7. S24, §17: «токены агентов без права `workflow`» → агенты не пушат, push/мерж/запуск workflow — оркестратор с подтверждением Ivan (O36), сессия — fine-grained токен без Workflows, Environments, Administration, Secrets, Variables (O43), правила 16.3 (O39), diff `.github/` перед push; staging — все ветки этого репозитория, форки не запускают `workflow_dispatch`; публичный репозиторий — раздел 17. Вариант для Ivan (по умолчанию не принят): снять Required reviewer со `staging`.
8. §16: `/metrics` — только `127.0.0.1` хоста (6.1); `ops.env` читает группа `ops`.
9. S23, §13: инструмент повтора удалений после восстановления (F7-Q8) — если Ivan согласится.

F6 `docs/TESTING.md`:
10. §7.6: на staging токены Session сида — `HMAC(SEED_TOKEN_SECRET, ник)`; без переменной — как сейчас (O15).
11. §9: smoke staging — `--project=desktop`, `E2E_BASE_URL` = `vars.APP_ORIGIN`, в job `staging` после SSH-шагов (9.6); §10: генератор — `tools-staging` через `load.yml` (раздел 11), `LOAD_BASE_URL` = `APP_ORIGIN`, отчёт — по пути `LOAD_REPORT` (в контейнере `/tmp/report.json`), не `tests/load/report.json`; §7.1: PostgreSQL 18.

F8 (профиль конвейера):
12. `.claude/settings.json`: правила 16.3 целиком (условие первой выкатки, O39); шаблон `/release` — раздел 10 (без `gh api`; `bootstrap=true` — только Ivan).
13. Сессия Claude Code — fine-grained токен 16.2 (`GH_TOKEN`, O43): Contents RW, Pull requests RW, Actions RW, Metadata R; без Administration, Environments, Secrets, Variables, Workflows; полный `gh auth` в сессии разлогинен; коммиты с `.github/workflows/**` пушит Ivan сам. Записать в профиль и в инструкцию запуска конвейера (условие первой выкатки).

F1, F4, F5 — правок нет.
