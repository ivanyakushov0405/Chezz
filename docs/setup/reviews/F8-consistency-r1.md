# F8 — consistency, раунд 1

Сверено без находок (проверено grep и `section.sh`): блок `deny`/`ask` в `PIPELINE_DECISIONS.md` §8.1 совпадает с OPERATIONS §16.3 дословно (проверено программно); 12 модулей и слои профиля совпадают с ARCHITECTURE §7.1; права токена в §8.2 совпадают с OPERATIONS §16.2; правила GitHub (O36, O43, O45, `--match-head-commit`, workflows пушит Ivan) одинаковы в profile.md, корневом CLAUDE.md, deploy/CLAUDE.md, devops.md, PIPELINE_DECISIONS §8; зона `tests` и `deny` у backend/frontend/devops совпадают с TESTING §5; проверки совпадают с TESTING §6, §12; ссылки на разделы F7 (9.2а, 9.6, 14.3, 23 п.12) существуют.

## 🔴 consistency-1. У файлов скелета нет владельца-зоны, а профиль отдаёт скелет одной задаче `[backend:platform]`
`profile.md`, «Метки задач» («Скелет репозитория (корневые конфиги, `scripts/check-*.sh`) — `[backend:platform]`»), `zones.conf` (backend/contracts/devops/frontend), `PIPELINE_DECISIONS.md` §2 (строка про корневые конфиги) против TESTING §6, §11, ARCHITECTURE §13.
- Конфиг Stylelint (`npm run check` включает Stylelint, TESTING §6, §11 «Литералы цвета…») не разрешён ни в одной зоне: в `backend` перечислены `eslint.config.*`, `.dependency-cruiser.cjs`, `vitest.config.ts`, но нет `.stylelintrc*` / `stylelint.config.*`. `grep -i stylelint` по профилю и зонам — пусто.
- `LICENSE` (ARCHITECTURE §13.1, F7 O28) тоже без зоны.
- Часть строк «пишет: скелет» из TESTING §11 лежит в чужих зонах: `scripts/check-api-doc.sh`, `packages/protocol/src/schemas.test.ts`, `snapshot.test.ts` — `contracts`; `deploy/compose.test.yml` (нужен `db:test:up`) — `devops`; `check-architecture.sh` при правке правил F7 §1 (`example.com`) — `backend`, а правит его devops-задача.
Последствие: `check-zone.sh` не пропустит ни одну задачу, которая пишет эти файлы. Первый эпик («Скелет», PIPELINE_DECISIONS §6) нельзя закрыть без ручной правки зон; `npm run check` не соберётся.
Варианты: (а) добавить в зону `backend` `.stylelintrc*`/`stylelint.config.*` (и `LICENSE` — Ivan руками, записать в §8.5), а в профиле и §2 переписать «скелет» как набор задач: `[contracts]` + `[backend:platform]` + `[infra]` (compose.test.yml) в фиксированном порядке; (б) выделить зону `skeleton` с широким allow (корень, `scripts/check-*.sh`, `deploy/compose.test.yml`, `packages/*/src`) только на первый эпик — формат `zones.conf` это допускает; (в) отдать скелет Ivan вручную и убрать «скелет — `[backend:platform]`» из профиля.

## 🟠 consistency-2. Порядок «contracts → backend → frontend → infra/ci → e2e» ломает `db:test:up` первой же задачи
`profile.md`, «Проверки» (`infra-up` — «перед тестами»), `PIPELINE_DECISIONS.md` §6 (порядок задач), `architect.md` («Декомпозиция») против TESTING §6 (`db:test:up` = `deploy/compose.test.yml`) и `zones.conf` (`deploy/**` — только `devops`).
`compose.test.yml` пишет только `[infra]`, который в порядке стоит после backend, а tester и backend-dev запускают `npm run db:test:up` с первой задачи. В В4 описана только нехватка самой команды, а не зависимость от зоны devops.
Последствие: на втором и дальнейших эпиках не выходит, пока `[infra]` не прошёл; на первом — тупик вместе с consistency-1.
Варианты: (а) в порядок задач скелета поставить `[infra]` (compose.test.yml) вторым, сразу после `[contracts]`; зафиксировать в профиле и architect.md; (б) разрешить `deploy/compose.test.yml` в зоне `backend` (скелет); (в) дописать к В4.

## 🟠 consistency-3. Функция маскировки `maskChallengeIds` (SECURITY §15, S37) живёт в `packages/protocol`, а зона `contracts` не читает §15
`profile.md`, «Правила по зонам» (строка `contracts`: SECURITY только §1, §12), агенты и CLAUDE.md.
SECURITY §15 требует одну функцию `maskChallengeIds(text)` в `packages/protocol`, её импортируют `apps/server` и `apps/web`, плюс unit-тест на каждое поле Sentry. `grep maskChallengeIds|beforeSend` по профилю, агентам и CLAUDE.md — пусто. Задача `[contracts]` (backend-dev) §15 не получает, reviewer по зоне `contracts` его MUST не проверяет (reviewer берёт только разделы зоны).
Последствие: правило S37 остаётся на «Выжимку правил» архитектора — возможна вторая реализация в web или отсутствие маскировки, утечка id вызова в публичный Sentry/логи.
Варианты: (а) добавить SECURITY §15 в зону `contracts`, а в `packages/CLAUDE.md` — строку «`maskChallengeIds` — единственная реализация, SECURITY §15»; (б) добавить в строки «Правила» `apps/server/CLAUDE.md` и `apps/web/CLAUDE.md` ссылку на эту функцию; в frontend-dev — пункт про клиентский Sentry `beforeSend` / `beforeBreadcrumb`.

## 🟡 consistency-4. Запрет на `CLAUDE.md` пакетов не совпадает с реальным файлом
`zones.conf` (`contracts deny packages/*/CLAUDE.md`, `frontend deny packages/i18n/CLAUDE.md`), `PIPELINE_DECISIONS.md` §2 («CLAUDE.md в … `packages/*`») против фактического `packages/CLAUDE.md`. Формат: `*` — внутри одной папки (PROFILE_FORMAT), поэтому `packages/*/CLAUDE.md` не покрывает `packages/CLAUDE.md`. Защита сейчас держится лишь тем, что файл не входит ни в один `allow`. Также `backend-dev.md`/`frontend-dev.md` велят читать «CLAUDE.md своего приложения», а для `[contracts]` и `packages/i18n` это `packages/CLAUDE.md`, не упомянутый.
Варианты: заменить на `deny packages/CLAUDE.md` в `contracts` и `frontend`, убрать строки про несуществующие файлы; в агентах написать «`apps/server/CLAUDE.md`; для `[contracts]` — `packages/CLAUDE.md`».

## 🟡 consistency-5. Команда `[e2e]` в профиле и в tester.md расходится
`profile.md`, «Проверки» (`e2e`: `npm run test:e2e -- tests/e2e/<сценарии фичи>`, TESTING §12) против `tester.md`, «Режим 2»: только `npx playwright test -c … --project=desktop`. Для задачи `[e2e]` tester.md команды из профиля не называет, и TESTING §12 (`desktop` + `mobile-360`) не выполняется — один проект.
Варианты: добавить в «Режим 2» «задача `[e2e]` — `npm run test:e2e -- tests/e2e/<сценарии>`»; `--project=desktop` оставить для одного теста.

## 🟡 consistency-6. reviewer.md п.7 не различает пути, которые пушит Ivan
`reviewer.md`, чек-лист п.7 «изменены `.github/`, `deploy/`, `scripts/ops/` — … diff — Ivan до push (O36)» против OPERATIONS §1 и профиля: `.github/workflows/**` вообще не пушит оркестратор — пушит Ivan. Ревьюер не проверяет, что такие файлы не попали в коммит оркестратора (пункт «отдельный коммит Ivan» не в чек-листе).
Вариант: дополнить п.7: «`.github/workflows/**` — в «Желательно»: коммитит и пушит Ivan, не оркестратор».

## Вне линзы
Решение В3 (API §15 «в одной задаче» ↔ отдельный `[contracts]`) и В1 (трекер `files`) оставлены автором открытыми; к consistency конвейера не относятся, но требуют ответа Ivan до первого `/feature`.

## Счёт
🔴 1 · 🟠 2 · 🟡 3
