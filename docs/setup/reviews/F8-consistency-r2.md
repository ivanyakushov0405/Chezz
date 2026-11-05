# F8 — consistency, раунд 2 (весь конвейер)

## Прошлый раунд
- consistency-1 (скелет без зон): закрыто по сути. Stylelint — `apps/web/.stylelintrc.json` (frontend), `LICENSE`/`README.md` — backend, `check-api-doc.sh` — contracts, `compose.test.yml` — devops, `check-architecture.sh` — три зоны, `.dockerignore` — devops. Остались следы в агентах и порядке, см. consistency-7, 8, 9.
- consistency-2 (`db:test:up`): закрыто по порядку (`[infra]` первым в профиле, §6, architect «скелет — по профилю»). В architect.md нет правила «`[infra]`, нужный коду, — перед ним» для фичевых задач, см. consistency-13.
- consistency-3 (`maskChallengeIds`): закрыто. SECURITY §15 в зоне `contracts`, `packages/CLAUDE.md`, `apps/server/CLAUDE.md`, `apps/web/CLAUDE.md`, frontend-dev.
- consistency-4 (`deny` на CLAUDE.md): закрыто. В `zones.conf` остался `frontend deny apps/web/CLAUDE.md`; агенты называют `packages/CLAUDE.md`.
- consistency-5 (`[e2e]`): закрыто, tester.md «Режим 2».
- consistency-6 (reviewer п.7): закрыто.
- Сверка, как раньше: 19 правил `deny`/`ask` в `PIPELINE_DECISIONS` §8.1 совпадают с F7 16.3 (сравнено программно). Лимиты S 20 / M 35 / L 50 одинаковы в профиле, §6, §7, §8.4. Зона `tests`, метка `[load]` и пути `tests/load/` согласованы в профиле, zones.conf, tester.md, §2 и §8.4. `tools:` у frontend-dev совпадает с §1 и серверным именем Figma MCP.

## 🟠 consistency-7. `npm run check` в задаче 2 скелета не может быть зелёным, а самопроверка его требует
`profile.md`, «Скелет репозитория» п.2–3 и `backend-dev.md`, «Самопроверка» против TESTING §6 (`check` = `tsc -b` + ESLint + Stylelint + dependency-cruiser + `check-architecture.sh` + `scripts/check-api-doc.sh`).
`check-api-doc.sh` и `packages/*` создаёт задача 3. Для Stylelint в п.2 есть `--allow-empty-input`, для `check-api-doc.sh` и `tsc -b` по несуществующим пакетам ничего нет.
Последствие: backend-dev в задаче 2 по своей инструкции обязан дать зелёный `npm run check`. Он либо не сдаст задачу, либо создаст `check-api-doc.sh` (зона `contracts`, блокер по его же правилам).
Варианты: (а) в п.2 написать, что `check` в задаче 2 включает только то, что уже существует (`check-api-doc.sh` подключается в задаче 3, `tsc -b` — без `packages`); (б) перенести `scripts/check-api-doc.sh` и подключение в `package.json` в задачу 2 (тогда `contracts` теряет файл); (в) для задач 2–3 заменить «`npm run check` зелёный» на выборочные команды.

## 🟠 consistency-8. Конфиг Playwright `tests/e2e/playwright.config.ts` не принадлежит ни одной задаче
TESTING §6 (`test:e2e` = `playwright test -c tests/e2e/playwright.config.ts`), §9 (MUST про `trace: "off"` и `reporter: "list"`), §18 п.4 (файл создаёт скелет) против `profile.md` (скелет без него), `zones.conf` (`backend deny tests/**`, `frontend deny tests/**`, `devops deny tests/**`), `tester.md`, «Где лежат твои тесты» (перечислен `tests/e2e/support/`, самого конфига нет).
Файл лежит в `tests/**`, то есть пишет его только tester. В профиле для tester это не названо, а скрипт `test:e2e` из задачи 2 на него ссылается.
Последствие: первая задача `[e2e]` не знает, кто делает конфиг с `webServer` и сидом. Пункт MUST про `trace`/`reporter` не попадёт ни в чей чек-лист, а reviewer проверяет только затронутые зоны.
Варианты: (а) дописать в tester.md «Где лежат» `tests/e2e/playwright.config.ts` (webServer, TESTING §9 MUST) и в профиль «Скелет» — шаг tester перед `[e2e]` первого эпика; (б) вынести конфиг в зону `backend` и в задачу 2, убрав из `tests`.

## 🟠 consistency-9. `devops.md` не знает `.dockerignore` и `check-architecture.sh`
`zones.conf` (`devops allow .dockerignore`, `devops allow scripts/check-architecture.sh`), `profile.md` п.7 скелета и `deploy/CLAUDE.md` против `devops.md`, «Твоя зона»: `deploy/**`, `scripts/ops/**`, `.github/**`, `scripts/check-workflows.sh`.
В §10.1 («roster-1») указано «`deploy/CLAUDE.md`», но `devops.md` не правился.
Последствие: на задаче 7 devops по своему тексту считает `.dockerignore` чужим файлом и возвращает блокер. Правка `example.com` в `check-architecture.sh` (OPERATIONS §8) делается в обход или не делается.
Вариант: добавить в «Твоя зона» `.dockerignore` (корень) и `scripts/check-architecture.sh` («только правило `example.com`, OPERATIONS §1, §8»).

## 🟠 consistency-10. `frontend-dev.md`: «Инструментов Figma нет» при явном списке Figma в `tools:`
`frontend-dev.md` строка 10 («Инструментов Figma нет — работай по design-spec.md») и «Перед началом» («фрейм из задачи») против его же `tools:` (`create_session`, `get_design_context`, `get_screenshot`, `get_metadata`) и `PIPELINE_DECISIONS` §1 («если имя не совпало — по design-spec.md»).
Фраза безусловная: агент вообще не обращается к макетам, хотя инструменты выданы и ради этого ограничивался список.
Последствие: реализация идёт по тексту design-spec, а не по фрейму. Сверка состава и состояний (DESIGN §16.3 п.4) теряет источник.
Вариант: заменить на «Figma — только чтение (DESIGN §16.3), через выданные инструменты (перед `get_design_context` загрузи навык). Нет инструментов в сессии (имена не совпали) — работай по design-spec.md и скажи об этом в ответе».

## 🟡 consistency-11. Профиль: «с этой задачи доступен `db:test:up`» неверно
`profile.md`, скелет п.1 («С этой задачи доступен `db:test:up`») против того же файла («Проверки»: «До задачи 2 скелета команд `npm run …` нет») и §8.4 («`npm run db:test:up` — задача 2»). Скрипт `db:test:up` лежит в корневом `package.json`, его создаёт задача 2.
Вариант: «С этой задачи можно поднять БД командой `docker compose -f deploy/compose.test.yml up -d --wait`; `npm run db:test:up` — после задачи 2».

## 🟡 consistency-12. Самопроверка задачи 1 нигде, кроме профиля
`profile.md` п.1 («самопроверка — `docker compose -f deploy/compose.test.yml up -d --wait`») против `devops.md`, «Самопроверка»: только `compose.yml config -q`. Агент читает свой файл, а не профиль.
Вариант: добавить в «Самопроверка» devops: «менялся `compose.test.yml` — `docker compose -f deploy/compose.test.yml up -d --wait`».

## 🟡 consistency-13. architect.md не говорит «`[infra]`, нужный коду, — перед ним»
`profile.md`, «Метки задач» и §6 (последняя строка) против `architect.md`, «Декомпозиция»: «обычно: contracts → backend → frontend → infra/ci → e2e». Этот пункт был вариантом (а) consistency-2.
Последствие: переменная или сервис compose, нужные backend-задаче, окажутся в плане после неё. Backend-dev остановится как на «файл вне зоны».
Вариант: дописать «`[infra]`, нужный коду задач, — перед ними».

## 🟡 consistency-14. `analyst.md` п.1 режима roadmap: `--toc … 2` при отсутствии Bash
`analyst.md` строка 21 против строки 11 («Bash нет: оглавление — Grep `^#{1,3} `») и §1 PIPELINE_DECISIONS. В агенте остался вызов `section.sh --toc`, который он выполнить не может.
Вариант: заменить на «начни с оглавления ТЗ (Grep по заголовкам)».

## 🟡 consistency-15. Скелет: «7 задач», по меткам — 8; `package-lock.json` у `contracts`
- `profile.md`, п.7 содержит `[infra]` и затем `[ci]` (две задачи в одном пункте). `PIPELINE_DECISIONS` §6/§7 говорит «7 задач». Правило «L с задачами > 8 делится» на границе. Вариант: развести п.7 на 7 и 8 или явно назвать «7 пунктов».
- `zones.conf`: `package-lock.json` есть в `backend` и `frontend`, в `contracts` нет (§2: «любая новая зависимость»). Задача 3 ставит `zod` и `chess.js` в `packages/*` и меняет корневой `package-lock.json`, `check-zone` его отклонит. Это уже 🟠, если lockfile один на workspace: вариант — `contracts allow package-lock.json` (и строка в §2 «в `backend`, `frontend` и `contracts`»). Оценка 🟠 условная: зависит от того, обновляется ли корневой lockfile при добавлении зависимостей в workspace `packages/*` (по умолчанию npm — да).

## Вне линзы
Открытые В1–В7 остаются у Ivan; блокируют первый `/feature` В4 (правка `feature.md`) и В2 (первый `git push`). В `CLAUDE.md` и профиле для analyst/architect остаётся общая фраза про `section.sh` (без Bash они читают через Grep+Read) — только справочно.

## Счёт
🔴 0 · 🟠 4 (consistency-7, 8, 9, 10) · 🟡 5 (consistency-11, 12, 13, 14, 15); в consistency-15 вторая часть (lockfile у `contracts`) при подтверждении поднимается до 🟠.
