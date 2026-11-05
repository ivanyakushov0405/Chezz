# F7 — security, раунд 3

## Прошлый раунд
- sec-10 — **закрыта частично**. 16.3 (O39): `ask` на весь `gh api`, `deny` на `gh auth`/`secret`/`variable`/`repo edit`, правила стали условием первой выкатки (раздел 20). Обход префиксами флагов, неявным POST и GraphQL больше не работает. Остались обходы, которых строковые правила не видят в принципе, — sec-14.
- sec-11 — закрыта. O41 берёт `headSha` успешного запуска `prod deploy`; `deploy.sh` п.2 сверяет базу с клоном (код 6). Подделка `run-name` в ветке приводит только к отказу: база ≠ клон. Откат и неудачные выкатки базу не сдвигают (9.2, 9.5).
- sec-6 — закрыта. O42: серверный `uploadTimestamp` и `retainUntil`, SHA-256 из Telegram до инцидента, `restore-prod.sh --sha256`. Остаток — атакующий, который был на VPS ещё до известного времени инцидента, — принят в 14.3, это честно.
- sec-12, sec-13 — закрыты (раздел 1, O36 перед `git push`; порядок `--env-file` и шаблон `compose.staging.env`).

## 🔴 sec-14. По умолчанию F7-Q9 код, который запускают агенты, получает полный `gh auth` Ivan, а правила 16.3 видят только строку команды
16.2, 16.3, F7-Q9 (по умолчанию «`gh auth` Ivan с полными правами»). Правила Claude Code проверяют текст Bash-команды. Агенты постоянно исполняют код: `npm test`, `npx playwright`, скрипты репозитория. Он работает от пользователя ОС Ivan и вызывает `gh` (токен из Credential Manager) или `gh auth token` через `child_process`, и ни `deny`, ни `ask` этого не замечают. Внутри самого `gh` то же самое делается без `gh api` в строке: `gh alias set x 'api -X PUT …'` + `gh x`, `gh extension install <repo>` + `gh <ext>`. Ни то, ни другое в 16.3 не запрещено.
Сценарий атаки: prompt-injection в Issue или тексте Feedback. Агент-разработчик пишет тест, где `execSync('gh api -X PUT repos/…/environments/prod --input empty.json')` снимает reviewers, а следующий вызов `…/rulesets` открывает `main`. Затем идёт обычный `npm test`. После этого выкатка prod из подменённого `main` проходит без единого подтверждения Ivan. С полными правами снимаются и environments, и ruleset.
Последствие: человеческий шлюз S24 (подтверждение environments, защита `main`) держится на правах токена, а не на правилах. При умолчании F7-Q9 токен — администратор.
Варианты: (а) Поменять умолчание F7-Q9: сессия Claude Code работает с `GH_TOKEN` = fine-grained токен только этого репозитория. Права — Contents, Pull requests, Actions на запись; без Administration, Environments, Secrets, Variables, Workflows. Полный `gh auth` Ivan в окружении агентов не залогинен (`gh auth logout` или отдельный профиль ОС). Тогда даже исполняемый код не меняет environments и ruleset, а мерж и dispatch упираются в подтверждение prod и diff O41. Добавить это в условие первой выкатки (раздел 20). (б) Минимум, если Ivan оставит полный токен: добавить в `deny` `gh alias`, `gh extension` и записать в 16.3 принятый риск «код агентов = права Ivan в GitHub». Но это не закрывает обход через `child_process`.

## 🟡 sec-15. `plan` ищет базу без фильтра по ветке
9.2: `gh run list --workflow deploy.yml` без `--branch main`. Запуск ветки с изменённым `deploy.yml` и `run-name: prod deploy` подменит базу. Безопасно (код 6 `base_mismatch`), но позволяет заблокировать выкатку. Варианты: (а) `--branch main --event workflow_dispatch`; (б) дополнительно проверять, что `headSha` — предок `main`.

## Вне линзы
- нет.
