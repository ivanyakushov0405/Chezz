# F7 — ответ на ревью r2

Документ: `docs/OPERATIONS.md` v0.3. Новые решения: O39–O42 (источник «ревью»); изменены O31, O36. Раздел 3 разбит на 3.1–3.6, раздел 16 — на 16.1–16.3.

## security

| ID | Решение | Что сделано или почему нет |
|---|---|---|
| 🔴 sec-10 | принято | O39, 16.3: правила целиком по подкоманде, без префиксов флагов: `ask` на весь `Bash(gh api:*)` (покрывает `-X` после пути, неявный POST через `-f`/`--input`, `gh api graphql`), `gh pr review`, `gh run cancel`/`rerun`, `gh workflow enable`/`disable`, `gh release`, `curl`, `wget`; `deny` на `gh auth` (в т.ч. `gh auth token`), `gh secret`, `gh variable`, `gh repo edit`/`delete`, чтение файлов конфигурации `gh`. Эти команды оркестратору не нужны, поэтому `deny`, а не `ask`. Правила — **условие первой выкатки** (раздел 20), правка settings.json — Ivan (§23 п.12). Раздел 1: оркестратор обращается к GitHub только командами раздела 10, обёртки запрещены. Проверено: раздел 10 не использует `gh api` (`gh run list`/`view` — чтение, `gh workflow run` — `ask`); `gh api` вызывает только job `plan` в CI. Вариант (б) с fine-grained токеном — F7-Q9, решает Ivan |
| 🟠 sec-11 | принято | O41: база — `headSha` последнего успешного запуска с `run-name` `prod deploy` (`gh run list`, записи запусков извне не подделать; откат и неудачные выкатки не считаются). `plan` передаёт `base` в `deploy <sha> <digest> <base>`; `deploy.sh` п.2 сверяет базу с SHA клона, иначе код 6 `base_mismatch`. `base=none` — только без `state/prod.image` |
| 🟠 sec-6 | принято | O42, 14.1, 14.3 п.5–6: после каждой выгрузки в Telegram уходит имя файла с SHA-256; `backups.sh` показывает серверный `uploadTimestamp` и `retainUntil` через нативный API B2; файл выбирается по этим данным и сообщению до инцидента; `restore-prod.sh --sha256` сверяет хэш. `rclone lsl` больше не используется |
| 🟡 sec-12 | принято | Раздел 1 и O36: diff `.github/`, `deploy/`, `scripts/ops/` показывается и перед `git push`. Раздел 8: `scripts/check-workflows.sh` проверяет триггеры и `permissions` по 9.2 (вспомогательная проверка, это оговорено) |
| 🟡 sec-13 | принято | 6.1: `compose.prod.env` — последний `--env-file`; `compose.staging.env` пишется только по шаблону из двух строк `STAGING_*` с проверенными digest |
| вне линзы (`checkout` во время работы скрипта) | принято | 9.3: `entry.sh` копирует `deploy/remote/` в `mktemp -d` и запускает копию |

## consistency

| ID | Решение | Что сделано или почему нет |
|---|---|---|
| 🟠 consistency-1 | принято | 9.5: общая функция `restore_prev` (клон по признаку, `state/prod.image`, `PROD_APP_IMAGE` в `compose.prod.env`, `up`, проверки, коды 0/4); 9.4 п.9 и `rollback` вызывают её; коды согласованы (выкатка: 1 или 4; откат: 0 или 4) |
| 🟠 consistency-2 | принято | O40: первая выкатка после `bootstrap.sh` — `env=prod` без staging (prod пуст); `up` staging без `state/prod.image` → код 7 `prod_missing` (5, 9.1, 9.6) |
| 🟠 consistency-3 | принято | Раздел 7: `APP_ORIGIN` — в vars обоих environments и в `staging.env`; smoke — `E2E_BASE_URL=${{ vars.APP_ORIGIN }}`, нагрузка — `LOAD_BASE_URL="$APP_ORIGIN"` из `staging.env` (9.6, 11) |
| 🟠 consistency-4 | принято | Раздел 11 и 6.1: отчёт — `/tmp/report.json` через `LOAD_REPORT`; правка TESTING §10 — §23 п.11 |
| 🟡 consistency-5 | принято | 9.3: таблица кодов 0–7 с действием `/release`; 10 ссылается на неё |
| 🟡 consistency-6 | принято | 9.2: колонка `needs` и условий; `prod`/`staging` — `always()` + `plan` success + `build` success или skipped |
| 🟡 consistency-7 | принято | 5 п.7: таблица владельцев и прав; `backup.sh` при первом `offsite` удаляет нешифрованные дампы и меняет права; `/var/lib/chezz` 770 `deploy:ops`, `restore-check.log` 664 |
| вне линзы (AL3 и §15) | принято | 13: у AL3 первое действие — логи, Sentry, откат; ARCHITECTURE §15 — если повторяется в сводке 3 дня |

## agentability

| ID | Решение | Что сделано или почему нет |
|---|---|---|
| 🟠 agent-9 | принято | 3.2 и 3.3 разбиты на 3.1–3.6 по ≤ 8 строк, альтернативы сокращены; оглавление в шапке обновлено |
| 🟡 agent-10 | принято | 9.3: коды общие для обеих сред: `up_failed` = 1 у staging, `prod_busy` = 3 и для нагрузки |
| 🟡 agent-11 | принято | O40 (см. consistency-2) |
| 🟡 agent-12 | принято | 10: `START` минус 10 с; `first` (самый новый после `START`), параллельные `deploy.yml` не запускаются; успех — `gh run view --log \| grep -m1 -o 'result=…'`; 9.2: без прошлой выкатки `BASE=none`, diff от пустого дерева |

## tz

| ID | Решение | Что сделано или почему нет |
|---|---|---|
| 🟡 tz-5 | принято | O31 п.2: при потере VPS удаления после последнего бэкапа не восстановить — принятое отступление, подтверждает Ivan; 14.3 п.7; F7-Q8 дополнен источником списка (файл `account_deleted` в B2 как вариант); правка политики SECURITY §12 — §23 п.5 |
| вне линзы (восстановление `local`-дампа) | принято | 14.3 п.6: `restore-prod.sh --local <файл>` без ключа, до этапа 4 |

Итого: 20 находок — принято 20, отклонено 0, передано человеку 0. Ivan решает F7-Q9 (fine-grained токен) и подтверждает O31 п.2.
