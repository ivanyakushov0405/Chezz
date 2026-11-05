# F7 — security, раунд 2

## Прошлый раунд
- sec-1 — **закрыта частично**. O36 и O9 убрали главный путь: клон теперь переключает только `prod deploy`, а агенты не пушат (`guard.sh`, `ask` в `.claude/settings.json` — проверено). Но вся защита `main` и environments теперь держится на списке запретов 16 п.8, а он обходится (см. sec-10). Кроме того, `diff` в O37 может показать не то, что реально поедет на VPS (см. sec-11).
- sec-2 — закрыта: O32 (раздельные пакеты), входы через `env:`, regex в `plan`, откат только из `prod.history`, проверка метки `revision`.
- sec-3 — закрыта: vars перенесены в environments. Запрет `gh variable`/`gh secret` — в sec-10.
- sec-4 — закрыта: O33, 6.1, `USER node` у `tools`.
- sec-5 — закрыта: файлы разделены, у staging только `[staging]`, значения фильтруются. Остаток — sec-13.
- sec-6 — **не закрыта** по сути, подробности ниже.
- sec-7, sec-8, sec-9 — закрыты (9.6, `setsid`, раздел 5 п.1).

## 🔴 sec-10. Запреты 16 п.8 обходятся, а до F8 их нет совсем
Разделы 1, 16 п.8, 23 п.12. Оркестратор работает от `gh auth` Ivan, то есть с правами владельца репозитория. Единственный человеческий шлюз — `ask` на `gh pr merge`/`gh workflow run` и подтверждение environment. Запрет записан как «`gh api -X`/`--method`», и в правилах Claude Code по префиксу (`Bash(gh api -X:*)`) он:
- не ловит `gh api repos/{o}/{r}/environments/prod -X PUT …` (флаг после пути);
- не ловит неявный POST: `gh api … -f/-F/--input` без `-X`, в том числе `…/actions/workflows/deploy.yml/dispatches` — это обход `ask` на `gh workflow run`;
- не ловит `gh api graphql -f query='mutation{mergePullRequest…}'` — это обход `ask` на `gh pr merge` и O36. Через GraphQL доступны и `updateEnvironment`, и правка правил.

Сейчас в `.claude/settings.json` нет ни одного из этих запретов, а раздел 20 не ставит F8 условием первой выкатки.
Сценарий атаки: prompt-injection в тексте Feedback или Issue, оркестратор выполняет `gh api -X PUT repos/…/environments/prod` с пустым `reviewers`, затем `gh api …/dispatches -f ref=main -f 'inputs[env]=prod'`. Prod выкатывается без единого подтверждения Ivan. Вариант: мерж PR в `main` через GraphQL, минуя показ diff по O36.
Последствие: закрытие sec-1 и S24 («обязательное подтверждение Ivan») держится на правиле, которое не срабатывает.
Варианты: (а) 16 п.8: `ask` на **весь** `Bash(gh api:*)` (и `gh api graphql`), в `allow` — только перечисленные GET-пути (`…/actions/runs…`, `…/deployments…`). `deny` на `gh secret`, `gh variable`, `gh auth`, `gh repo edit`, `gh ruleset`, `gh run cancel`. Плюс `deny` на `curl`/`wget` с `api.github.com` и на `gh auth token`. В разделе 20 записать: запреты F8 действуют **до первой выкатки** (в той же строке, что environments). (б) Сверх (а): оркестратор работает от fine-grained токена Ivan без Administration, Environments, Secrets и Variables (Contents, Pull requests, Actions — запись). Тогда правку environments и правил даже обход `ask` не даёт; `gh auth` Ivan с полными правами — только для самого Ivan.

## 🟠 sec-11. База diff в O37 берётся из Deployments API и не совпадает с тем, что стоит на VPS
9.2, job `plan`: база — «SHA последнего успешного deployment `prod`». Но успешный job `prod` создаёт deployment и при `action=rollback` (SHA `main` на момент отката), хотя по 9.5 п.3 «клон не меняется». Сверх того, записи deployments может создать любой workflow с `deployments: write` (см. sec-12) и любой вызов `gh api` от Ivan.
Сценарий: выкачен A → в `main` попадает правка `deploy/remote/backup.sh` (B) → откат с `main`=C записывает deployment C → выкатка D показывает `diff C..D`. Изменение B Ivan не видит, а оно поедет на VPS (клон A → D).
Варианты: (а) `plan` выводит базу `BASE`, job `prod` передаёт её в `deploy <sha> <digest> <base>`, `deploy.sh` п.2 отказывает (код 2), если текущий SHA клона ≠ `BASE`. Показанный diff тогда гарантированно равен реальному. (б) База — `headSha` последнего успешного запуска с `run-name: prod deploy` (`gh run list --json displayTitle,headSha,conclusion`). Записей запусков workflow извне не подделать.

## 🟠 sec-6 (повторно). Выбор файла в 14.3 п.5 опирается на время, которое задаёт тот, кто загружает
14.3 п.5: «время загрузки» по `rclone lsl`. Для B2 rclone показывает modtime из `src_last_modified_millis`, а это поле передаёт загружающий клиент. Имя файла с `<UTC>` тоже выбирает он. При захвате VPS ключ с `writeFiles` позволяет загрузить дамп с «старой» датой.
Сценарий атаки: атакующий подкладывает `chezz-<позавчера>-daily.dump.age` с modtime позавчера, зашифрованный открытым ключом из репозитория. Ivan выбирает его как «до инцидента».
Варианты: (а) `backups.sh` показывает серверный `uploadTimestamp` (`b2 ls --long` / `b2 file info`) и `retainUntil` Object Lock (его считает сервер, а ключу без `writeFileRetentions` его не задать). Выбирать по ним. (б) Сверх (а): `backup.sh` после загрузки шлёт в Telegram имя и SHA-256 файла, тогда в 14.3 п.5 файл сверяется с сообщением, которое было отправлено до инцидента.

## 🟡 sec-12. Diff O36 показывается при мерже, но не при `git push` ветки с `.github/workflows/**`
Раздел 1, O36, 16 п.5. Подтверждая `git push`, Ivan не видит, что ветка меняет workflow. Значение «`GITHUB_TOKEN` по умолчанию — чтение» действует, только пока в workflow нет `permissions:`. Workflow ветки на `push` может запросить `contents`/`packages`/`deployments`/`actions: write`: подделать deployments для sec-11, перезаписать теги в `chezz-app`. Варианты: (а) O36 расширить: diff `.github/` показывается и перед `git push`; (б) в `check` добавить проверку: в workflow нет `on: push` вне `main` и нет `permissions` шире перечисленных в 9.2.

## 🟡 sec-13. Порядок `--env-file` в 6.1
`--env-file compose.prod.env --env-file compose.staging.env`: в compose последний файл перекрывает предыдущие. Если в `compose.staging.env` попадёт `APP_DOMAIN`/`SENTRY_INGEST`/`PROD_APP_IMAGE`, это сработает для prod. Варианты: (а) `compose.prod.env` ставить последним; (б) `entry.sh staging` пишет файл только из шаблона `STAGING_APP_IMAGE=`/`STAGING_TOOLS_IMAGE=` и проверенных digest.

## Вне линзы
- 9.4 п.2: `git checkout --detach` меняет файлы клона, пока из него исполняется `deploy.sh`. Нужно, чтобы `entry.sh` перед запуском копировал скрипты во временный каталог (agentability).
