# F7 — consistency, раунд 3 (весь документ, v0.3)

## Прошлый раунд
- consistency-1 (автооткат): исправлено, `restore_prev` в 9.5 общая. Остаток — consistency-14 ниже.
- consistency-2 (первый staging): исправлено через O40 и код 7 (9.3, 9.6), но создало consistency-8 и 9.
- consistency-3 (`APP_DOMAIN`): исправлено через `APP_ORIGIN` в vars обоих environments и `staging.env` (7, 9.6, 11).
- consistency-4 (read-only и отчёт): исправлено, отчёт в `/tmp/report.json` (6.1, 11).
- consistency-5 (коды): исправлено, таблица 0–7 в 9.3. Остаток — consistency-12.
- consistency-6 (`needs`): исправлено в 9.2 для `deploy.yml`.
- consistency-7 (права): исправлено, таблица в разделе 5 п.7. Остаток — consistency-13.

## 🔴 consistency-8. База diff (O41) делает невозможной выкатку на новый VPS (14.3 п.4) и повтор неудавшейся первой выкатки
9.2: `plan` берёт `BASE` = `headSha` последнего успешного prod-запуска, а `none` — только если успешных запусков нет совсем. 9.4 п.2: `none` допустим лишь при отсутствии `state/prod.image`, иначе SHA клона ≠ `base` → код 6. 14.3 п.4 при потере VPS требует `base=none`.
Последствие:
1. Новый VPS после аварии: в GitHub успешные prod-запуски есть, `plan` даст `BASE=<sha>`. На свежем клоне (HEAD main с bootstrap) `state/prod.image` нет, SHA клона ≠ base → код 6. Единственный путь восстановления не выполняется. `base=none` в 14.3 из `plan` получить нельзя.
2. Первая выкатка завершилась кодом 1 или 4: `state/prod.image` уже записан (9.4 п.5), а успешных запусков нет → `BASE=none`, образ есть → код 6 при каждом повторе. Prev нет, `restore_prev` без цели.
3. `gh run list -L 100` включает staging- и rollback-запуски. После 100 запусков последний успешный prod deploy выпадает из окна, `BASE=none` и код 6.
Варианты: (а) в 9.4 п.2 проверять базу только при наличии `state/prod.image`; без него — принимать любую `base` и считать diff от пустого дерева. (б) `plan` фильтрует `--json ... --workflow` по `run-name` через `-q` и запрашивает больше записей (или `gh run list` с поиском по `displayTitle`). (в) Для п.2 явно описать `restore_prev` без prev на первой выкатке: очистить `state/prod.image`, код 4.

## 🟠 consistency-9. Первая выкатка prod падает на отсутствующем `compose.staging.env`
6.1: каждая команда `docker compose` получает `--env-file compose.staging.env --env-file compose.prod.env`. Файл `compose.staging.env` пишут только команды staging (7, 6.1). Bootstrap его не создаёт (раздел 5). O40 запрещает staging до первой выкатки prod (код 7). Первая выкатка 9.4 п.7 вызывает compose без этого файла.
Последствие: `docker compose` завершается ошибкой «env file not found», первая выкатка (и 14.3 п.4) невозможна. Скрипты `backup.sh`, `status` ведут себя так же.
Варианты: (а) `bootstrap.sh` создаёт пустые `compose.staging.env` и (пустой) `compose.prod.env`, права 640 `deploy:ops`. (б) `deploy.sh` перед compose создаёт отсутствующий `compose.staging.env` пустым. (в) Подставлять `--env-file` только если файл существует.

## 🟡 consistency-10. Раздел 1 запрещает оркестратору то, что 16.3 разрешает через `ask`
Раздел 1: MUST NOT `gh api` (любой), `curl`/`wget`, `gh run cancel`/`rerun`, `gh workflow enable|disable`, `gh pr review`. 16.3: те же команды в `ask`, а текст «любой `gh api` у оркестратора — подтверждение Ivan с показом команды». Агент не знает, запрещено или можно просить подтверждение. Варианты: (а) в разделе 1 дописать «правило агента; `ask` в 16.3 — страховка, не разрешение». (б) Убрать пункт о подтверждении `gh api` из 16.3.

## 🟡 consistency-11. `restore-prod.sh` от `ops` не может читать `prod.env`
Раздел 7: `prod.env` — 600 `deploy`; `ops.env` — 640 `deploy:ops`, «читает `restore-*.sh` от `ops`». 14.3 п.6: `restore-prod.sh` (запускает `ops`) останавливает и запускает `app`. `docker compose stop/up app` разбирает `env_file: prod.env` и падает по правам. Варианты: (а) `restore-prod.sh` управляет `app` через `docker stop/start chezz-app-1`, а базу пересоздаёт `docker exec db`. (б) `prod.env` — 640 `deploy:ops` (ослабление, оговорить).

## 🟡 consistency-12. Коды для `load` не определены
9.3: общая таблица кодов 0–7. Раздел 11 п.3 говорит «код ≠ 0 при нарушении порога», но код нарушения порога не в таблице; код 1 означает `rolled_back`/`up_failed`. `/release` по таблице неверно прочтёт провал нагрузки. Также в разделе 10 для `load.yml` «тот же поиск run» ссылается на `--workflow deploy.yml` (нужен `load.yml`). Варианты: (а) добавить `8 load_failed` (порог нарушен) и использовать в 11. (б) Описать в 10 параметр `WF`.

## 🟡 consistency-13. `load.yml` ссылается на `plan`, которого в 9.2 для него нет
Раздел 11: «`plan` → `build` → job `load`». Права и шаги `plan` описаны только для `deploy.yml` (проверка `image`, BASE). `check-workflows.sh` (8) проверяет `permissions` «не шире 9.2» — для `load.yml` эталона нет. Варианты: (а) убрать `plan` из `load.yml`. (б) Описать `plan` для `load.yml` одной строкой.

## 🟡 consistency-14. После авто-отката `prod.image.prev` равен `prod.image`
9.4 п.5 пишет `image.prev` = старый, `image` = новый. `restore_prev` п.3 ставит `image` ← старый, `prev` не меняется. В итоге `rollback` без аргумента (9.5 п.1, «прошлый») возвращает тот же образ — пустая операция, а `/release` считает это откатом (раздел 10, комментарий «откат на прошлый»). Вариант: в `restore_prev` п.3 для авто-отката очищать `prod.image.prev` (тогда `rollback` без аргумента даёт код 2) или брать цель из `prod.history`.

## Вне линзы
Сверка с F2, F3, F6: новых расхождений, не вынесенных в раздел 23, нет.
