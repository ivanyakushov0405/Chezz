# F7 — agentability, раунд 1

Размеры: `token-report.sh` — максимальный раздел ≈1473 ток. (§3.3), §9 в целом 2563, но разбит на подразделы ≤940. Бюджет соблюдён. Плейсхолдеры `example.com`, `<owner>` оговорены в шапке; остальное ниже.

## 🔴 agent-1. Нет шагов команды `rollback` и job'а отката в workflow
§9.2 перечисляет три job (`build`, `deploy`, `smoke`). §9.4 говорит «провал smoke prod → `rollback` запускает тот же job (`if: failure()`)» — но такого job нет, а какой именно «тот же», неясно. §9.3 даёт пошаговый алгоритм только для `deploy`; для `rollback [<digest>]` — одна строка «раздел 9.5», а 9.5 — проза без шагов: что пишется в `state/prod.image`/`prod.history`, делается ли бэкап, как проверяется здоровье, как валидируется digest по `prod.history`, какой код выхода при отказе, нужен ли smoke после отката. Критерия успеха отката нет вообще (у деплоя — шаги 5–6).
Последствие: devops напишет откат по догадке; именно откат нельзя угадывать — он срабатывает в аварии. Авто-откат при провале smoke может оказаться недостижимым.
Варианты: (а) добавить в 9.3 нумерованные шаги `rollback.sh` (вход, проверка по history, подмена `PROD_APP_IMAGE`, `up -d --wait`, проверка `app_info{version}`, запись history, коды выхода) и в 9.2 строку job `rollback` с условием и `environment`; (б) явно: авто-откат только внутри `deploy.sh` (шаг 7), а `if: failure()` в smoke убрать — откат после smoke только ручной.

## 🔴 agent-2. Подтверждения environment: сколько их и как /release отличает «ждёт Ivan»
§9.2: job `deploy` и job `smoke` оба имеют `environment: ${{ inputs.env }}`, а у `prod`/`staging` Required reviewers (§16 п.3–4). GitHub требует одобрение на каждый job с таким environment, т.е. Ivan подтверждает дважды (и ещё раз на авто-откат, если он job). В §1/§9.1/§20 везде «подтверждает Ivan» один раз. §10: «`gh run watch` с таймаутом 60 мин» — у `gh run watch` нет флага таймаута; как отличить «ждёт подтверждения» от «упал» — не сказано (`status=waiting`).
Последствие: /release зависнет или ошибочно отчитается «ждёт Ivan» на втором подтверждении; смоук без одобрения не стартует, prod остаётся без проверки.
Варианты: (а) оставить environment только у `deploy` (smoke берёт секреты через `needs`/vars — для staging нужен `SEED_TOKEN_SECRET`, значит для smoke нужен либо environment, либо передать токен иначе) и зафиксировать число подтверждений; (б) оставить как есть, но прописать в §9.1 и §10 «подтверждений N», команду `timeout 3600 gh run watch "$RUN" --exit-status` и проверку `gh run view "$RUN" --json status -q .status` = `waiting` → отчёт «ждёт Ivan».

## 🟠 agent-3. `/release`: ненадёжное получение run id и digest для отката
§10: `gh run list --workflow deploy.yml --limit 1` сразу после `gh workflow run` может вернуть предыдущий запуск (диспатч асинхронен), при параллельных запусках — чужой. Для `rollback -f image=sha256:<digest>` агенту нужен digest, но `state/prod.history` ему недоступен (SSH запрещён, §1), а `status` — только по SSH. Откуда агент берёт digest — не сказано (из итога прошлых запусков `$GITHUB_STEP_SUMMARY`?).
Последствие: /release следит не за тем run'ом; откат на конкретный образ невозможен без Ivan.
Варианты: (а) ждать появления run: фильтр `--event workflow_dispatch --branch <ref> --created ">=<время старта>"` либо `gh run list … --json databaseId,createdAt` с циклом; digest брать из итога последнего успешного prod-запуска (указать как: `gh run view <id> --log`/артефакт `digest.txt`); (б) убрать `image` из агентских команд, оставить его ручным действием Ivan.

## 🟠 agent-4. Ограничение «>10 активных партий» не привязано к исполнителю
§9.6: MUST NOT выкатывать prod при `status` > 10 партий. Агент статус не видит (SSH запрещён); в §9.3 шагов `deploy.sh` такой проверки нет, кода выхода нет. Исключение «кроме исправления аварии» — как задаётся (вход? флаг?) — не описано. §9.2 пишет «число активных партий до выкатки» в итог — это информативно, а не блокирует.
Последствие: правило невыполнимо ни агентом, ни скриптом; либо игнорируется, либо devops реализует по-своему.
Варианты: (а) шаг 0 в `deploy.sh prod deploy`: `chezz_games_active` > 10 → код 3 «на prod играют», обход входом `force=true` в `deploy.yml`; (б) превратить в рекомендацию Ivan при подтверждении (читает число из итога/запроса) и убрать MUST NOT.

## 🟠 agent-5. Нет источника `POSTGRES_PASSWORD`/`DATABASE_URL` для `db`, `db-staging`, `tools-staging`
§6.1: `env_file` указан только у `app`. Для `db`/`db-staging` не сказано, откуда `POSTGRES_USER=app`, `POSTGRES_DB=chezz`, `POSTGRES_PASSWORD`; для `tools-staging` и `app-staging` — какой env-файл (`staging.env`?). `compose.env` не секрет, а пароль в нём быть не должен. Пользователь БД `app` и база `chezz` выводятся только из healthcheck.
Последствие: devops угадывает схему env; рассинхрон `DATABASE_URL` и пароля `db` ломает первый старт.
Вариант: добавить в таблицу 6.1 колонку «env_file / environment» для каждого сервиса и фиксированные `POSTGRES_USER=app`, `POSTGRES_DB=chezz`; пометить, что `DATABASE_URL` и `POSTGRES_PASSWORD` приходят в одном файле `prod.env`/`staging.env`.

## 🟠 agent-6. Критерии успеха smoke не проверяемы без формата `status`
§9.4 prod: «`ssh … status` — SHA = `github.sha`, `app` не перезапускался 2 мин». Формат вывода `status` (§9.3: «digest, SHA, health, …») не задан (ключи? JSON?), «2 мин» — от чего отсчёт и как измеряется (`RestartCount`/`StartedAt`). Staging: сколько ждать, что считать порогом (`@smoke` зелёный — это ок, но «вход вручную» без критерия итога в workflow).
Последствие: smoke реализуется по догадке; не воспроизводим в тесте.
Варианты: (а) задать формат `status` — `key=value` строки с именами, и шаг smoke: `sleep 120; status | grep` и условия; (б) заменить критерий «не перезапускался» на `RestartCount==0` и `app_info{version}` = SHA.

## 🟠 agent-7. Домен и адреса зашиты как `example.com` в командах, которые попадут в workflow
§9.4, §11 содержат литералы `https://example.com`, `https://staging.example.com`; в §7 есть vars `APP_DOMAIN`. Не сказано, что workflow обязан брать их из `vars.APP_DOMAIN`, а `entry.sh`/скрипты — из `compose.env`. Аналогично `<owner>` для GHCR: в workflow — `${{ github.repository_owner }}`? не сказано.
Последствие: после ответа на F7-Q2 нужно править workflow руками (а пушит их Ivan), либо агент вставит литерал.
Вариант: MUST в §1/§9.2: «домен — `vars.APP_DOMAIN`, владелец образов — `github.repository_owner` (в нижнем регистре); литералы `example.com` запрещены в `.github/**`, `deploy/**` и `scripts/**`»; проверка — `grep`-шаг в `check`.

## 🟡 agent-8. Мелочи
- §9.1/§10: «`ref=main`» — но у `deploy.yml` нет входа `ref`; это `--ref`. Унифицировать.
- AL2 «> 3 перезапуска за 10 мин» — чем измеряет `watch.sh` (`docker inspect .RestartCount` нарастающий?) не сказано; AL3 «p95» берётся из summary-квантили окна 5 мин — подтвердить, что `watch.sh` не пересчитывает.
- §5 п.1: «`authorized_keys` только из двух строк O9» — точный формат строки (`command="…entry.sh prod",restrict ssh-ed25519 …`) указан в §3, в §5 ссылки нет; devops нужен шаблон.
- §7: имя `RATE_LIMIT_IP_PER_MIN` «по умолчанию» — задача скелета фиксирует, но `env.allowlist` и таблица §7 должны меняться синхронно; указать, кто владелец (developer или devops).

## Вне линзы
Smoke staging (§9.4) запускает `npm ci` и тесты из `ref` ветки в job с `environment: staging` и `SEED_TOKEN_SECRET`, то есть код ветки видит секрет среды — противоречит принципу §1/§9.2 «ветка собирается только в job без секретов» (линза security).
