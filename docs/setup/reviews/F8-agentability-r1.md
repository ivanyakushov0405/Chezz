# F8 — agentability, раунд 1

Проверено: `check-zone.sh --validate` — OK; `{{` в агентах и CLAUDE.md нет; все номера разделов из «Правил по зонам» профиля существуют (`section.sh` находит каждый). Зоны покрывают пути, которые агентам велено писать, кроме пробелов ниже (agentability-3, -5).

## 🔴
Нет.

## 🟠 agentability-1. analyst и architect не могут выполнить `section.sh`
`.claude/agents/analyst.md`, `architect.md`: `tools: Read, Grep, Glob, Write[, Edit]` — без Bash, а оба предписывают `.claude/kit/scripts/section.sh` (TZ `--toc`, `docs/TZ.md 3.4`, документы основ). Агент не получит оглавление и разделы; останется читать `docs/ARCHITECTURE.md` (≈19 тыс. токенов), `docs/TZ.md` целиком или гадать. Это шаблон набора, но в проекте это ломает правило «только разделами».
Варианты: (а) добавить `Bash` в `tools` обоим (запреты на коммит и `gh` держит хук набора и `settings.json`); (б) убрать из агентов предписание `section.sh` и ограничить чтение `Read` с `offset`/`limit` по номерам строк, которые оркестратор берёт из `--toc`; (в) зафиксировать в `PIPELINE_DECISIONS` «оркестратор подаёт аналитику и архитектору готовые разделы» и написать это в агентах.

## 🟠 agentability-2. devops: противоречие «не пиши скриптов с локальной машины» и зона `scripts/ops/**`
`devops.md`, «Правила»: «Не пиши скриптов и команд, которые … ходят в staging и прод с локальной машины». При этом зона `devops` включает `scripts/ops/**` (OPERATIONS §15: «агенты пишут `scripts/ops/`», Ivan запускает по SSH: `logs.sh`, `status.sh`, `restore-prod.sh`, …) и `deploy/bootstrap.sh`. Агент либо откажется от `[infra]`-задач на эти скрипты, либо нарушит свой запрет.
Варианты: (а) переписать правило: «выкатка, откат, smoke — только workflow; `scripts/ops/**` и `bootstrap.sh` пишешь, но не запускаешь, их запускает Ivan по SSH (OPERATIONS §15)»; (б) выделить в запрете «выкатывающие» скрипты, а `scripts/ops/` разрешить явно.

## 🟠 agentability-3. Скелет (`backend:platform`) не может создать то, что от него требует TESTING §11
`npm run check` включает Stylelint, пишет «скелет» (TESTING §11, строка «Литералы цвета…»), но конфиг по DESIGN §17 лежит в `apps/web/.stylelintrc.json` — зона `frontend`, у `backend` нет ни `apps/web/**`. Одновременно `npm run db:test:up` (корневой `package.json`, backend) зовёт `deploy/compose.test.yml`, а файл — зона `devops` (`deploy/**`, TESTING §7.1). `backend-dev` в самопроверке требует обе вещи, а своей зоной их создать не может; в агенте об этом ни слова — упрётся и придумает обход. Первый эпик «Скелет репозитория» не стартует без этого.
Варианты: (а) в `PIPELINE_DECISIONS` и roadmap-правиле analyst закрепить: эпик скелета = `[backend:platform]` + `[infra]` (compose.test.yml) + `[frontend]` (`apps/web` с Stylelint) в порядке infra → backend → frontend; (б) добавить в зону `backend` `apps/web/.stylelintrc.json` и `deploy/compose.test.yml` (shared allow, deny в devops убрать); (в) в «Когда остановиться» backend-dev добавить «нет файла вне зоны — вернуть как блокер».

## 🟠 agentability-4. Стоимость чтения: разделы «Правил по зонам» и «всегда читать»
Профиль «Правила по зонам», размер по `section.sh` (≈ симв./3, подразделы частично пересекаются):
- backend ≈ 44 тыс. токенов, frontend ≈ 28 тыс., tests ≈ 21 тыс., devops ≈ 19 тыс., contracts ≈ 15 тыс.; reviewer (opus) читает всё это на каждую задачу, да ещё с `--with-refs`.
- Отдельные неделимые разделы: SECURITY §17 ≈ 3,8 тыс. (в «всегда читать» devops и в зонах backend/devops), API §12 ≈ 3,5 тыс. (зона tests; tester и arbiter ссылаются на «API §12» целиком), SECURITY §4 ≈ 1,9, TESTING §11 ≈ 1,9 (во всех зонах), TESTING §7.6, §4 ≈ 1,7, GLOSSARY §8 ≈ 1,7, OPERATIONS §1 ≈ 1,6, ARCHITECTURE §12 ≈ 1,6. Это В7 из `PIPELINE_DECISIONS`, но он перечисляет другие разделы (GLOSSARY §2, ARCHITECTURE §9.1, OPERATIONS §3.2) и не включает перечисленные здесь.
Варианты: (а) разбить SECURITY §17, API §12, TESTING §11, SECURITY §4 на подразделы (reopen F3/F4/F6) и обновить В7; (б) в профиле заменить «целые» разделы на подразделы с MUST (§1 «Правила для агентов» уже есть в каждом документе); (в) в tester и arbiter вместо «API §12» писать «строку нужного маршрута из API §12 (`grep`)»; reviewer — читает зоны только затронутых путей, а не все разделы зоны.

## 🟠 agentability-5. backend-dev на `[contracts]`: не прочтёт `packages/CLAUDE.md`, не знает, какие тесты писать
`backend-dev.md`, «Перед началом»: «CLAUDE.md своего приложения» — для `[contracts]` это `packages/CLAUDE.md` (правила `PROTOCOL_VERSION`, «новый баг правил — сначала фикстура», проверка `--project unit packages`), но агент называет только `apps/server`. «Тесты своего уровня» описаны для `domain/` и `service+repo`; для `packages/protocol` (`schemas.test.ts`, `snapshot.test.ts`, `pages.test.ts` — TESTING §11) уровня нет, самопроверка `--project unit packages` отсутствует.
Варианты: (а) дописать «для `[contracts]` — `packages/CLAUDE.md` вместо `apps/server/CLAUDE.md`; тесты — `*.test.ts` рядом с кодом пакета, `npx vitest run --project unit packages`»; (б) вынести `[contracts]` в отдельного агента (нарушает «не плодить роли» — не рекомендую).

## 🟡 agentability-6. architect (1495) и tester (1498) — на пределе ≈1500
Любая правка при `/setup reopen` превысит бюджет. Варианты: (а) вынести в tester список «Что ты тестируешь» (дубль TESTING §5, §9, §10) ссылкой на разделы; (б) в architect сократить блок «Выход» (шаблон design.md) в `docs/…` шаблон, а в агенте оставить заголовки.

## 🟡 agentability-7. `tester-untouched` не ловит новые файлы
Профиль «Проверки», а также `backend-dev`, `frontend-dev`, `reviewer`: `git diff --stat -- <пути tests>` не показывает неотслеживаемые файлы, новые файлы разработчика в `fixtures/` или `tests/` пройдут. Зоны их запрещают (check-zone), но проверка заявлена как защита. Вариант: `git status --porcelain -- apps/server/test/contract apps/server/test/acceptance packages/chess/test fixtures tests` (пусто) — в профиле и во всех трёх агентах.

## 🟡 agentability-8. Диапазоны разделов в профиле
В «Правилах по зонам» диапазоны («§5–7», «§7.1–7.2», «§9.2–9.2а», «§10.1–10.2») `section.sh` не понимает — это одно число за раз. Агент или reviewer должен развернуть руками; «§9.2а» (кириллица) легко потерять. Вариант: перечислить номера через пробел (`section.sh … 5 6 7`) или добавить строку «диапазон = каждый номер отдельно».

## 🟡 agentability-9. Экранирование `\|` в командах профиля
`tester-tsc`: `grep -v -E "error TS(2307\|2305):"` в таблице Markdown. Оркестратор, скопировавший ячейку как есть, получит литеральный `|` в ERE и фильтр не сработает (в `tester.md` записано правильно). Вариант: вынести команду из таблицы в блок кода или указать «`\|` снять».

## 🟡 agentability-10. Пути документов в analyst и designer
`analyst.md`: «BUSINESS §1.4, §1.7; GLOSSARY; ARCHITECTURE §7.1» — без путей (BUSINESS — `docs/setup/BUSINESS.md`, не `docs/`). Агент пойдёт искать. Вариант: один раз указать «пути — `.claude/profile.md`, «Документы»» либо дописать `docs/setup/BUSINESS.md`.

## 🟡 agentability-11. frontend-dev и designer — `tools:` не ограничен
Решение обосновано (Figma MCP), но кроме MCP агентам доступны Bash, `git`, `gh`; запрет коммита и `gh` держится на тексте и хуке. Вариант: перечислить `tools: Read, Grep, Glob, Edit, Write, Bash, mcp__figma__*` (когда имена известны), записать в `PIPELINE_DECISIONS` §1.

## Вне линзы
- security: `devops` в «Режиме сбой выкатки» использует `gh run view <id> --log-failed`, этой команды нет в перечне «только команды OPERATIONS §10» профиля, раздел «GitHub и подтверждения» (проверить на согласованность).

## Счёт
🔴 0 / 🟠 5 / 🟡 6
