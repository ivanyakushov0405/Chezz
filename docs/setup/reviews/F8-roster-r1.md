# F8 — roster, раунд 1

## Матрица 1. Зоны × роли

| Зона (источник) | backend-dev | frontend-dev | devops | tester | Итог |
|---|---|---|---|---|---|
| `apps/server/src/<module>/**` ×12 (ARCH §7.1, §13.1) | W (`backend:<m>`) | — | — | — | ок |
| `apps/server/src/*.ts`, `migrations/`, `scripts/seed.ts`, `test/support/` | W (любой модуль) | — | — | R | ок, задачи идут по очереди |
| `packages/protocol`, `packages/chess` (без `test/`) | W (`contracts`) | R | — | R | ок |
| `packages/i18n` | — | W | — | R | ок (строки `seo` — задача `[frontend]`) |
| `apps/web/**` (вкл. `.stylelintrc.json`, `public/**`) | — | W | — | — | ок |
| Корневые конфиги, `scripts/check-architecture.sh`, `check-bundle.sh` | W | — | — | — | правила фронта в этих файлах — см. roster-2 |
| `scripts/check-api-doc.sh` | W (`contracts`) | — | — | — | ок |
| `package-lock.json` | W | W | — | — | две роли, по очереди — 🟡, принято в PIPELINE_DECISIONS §2 |
| `deploy/**` (Dockerfile, compose, Caddy, remote/) | — | — | W | — | ок |
| **`.dockerignore` (корень контекста сборки, OPERATIONS §6.2)** | — | — | — | — | **никто** — roster-1 |
| `scripts/ops/**`, `.github/**`, `check-workflows.sh` | — | — | W (`workflows/**` коммитит Ivan) | — | ок |
| Тесты tester (`test/contract`, `test/acceptance`, `packages/chess/test`, `fixtures`, `tests/e2e`, `tests/load`) | deny | deny | deny | W | ок; путь задачи для `tests/load` — roster-3 |
| Файл Figma (макеты, DESIGN §16) | — | **W (MCP не ограничен)** | — | — | designer + frontend-dev — roster-5 |
| `docs/*.md` (OPERATIONS и т. п.) | — | — | — | — | только architect-apply — 🟡 roster-9 |
| `LICENSE`, `README.md` в корне | — | — | — | — | 🟡 roster-10 |

Стеки не смешаны: backend-dev — TS-сервер и TS-пакеты, frontend-dev — React. Мобильной части нет. Лишних ролей нет: у каждой роли есть метка или этап в `/feature`, `/fix` или `/release`, и её результат кто-то читает.

## Матрица 2. Работы × исполнитель × проверяющий

| Работа (TESTING §4, §11–14; OPERATIONS) | Исполнитель | Проверяющий | Итог |
|---|---|---|---|
| Код сервера и пакетов | backend-dev (sonnet; `Риск: high` → opus) | check + tester р.2 + reviewer (opus) | ок |
| Код SPA | frontend-dev | check + tester р.2 + reviewer | ок |
| unit / int тесты | разработчик | reviewer (DoD §13 п.2) | ок |
| contract / acceptance / фикстуры | tester р.1, вслепую | reviewer (AC/EC), arbiter при споре | ок |
| e2e-сценарии фичи | tester р.1, этап 3 | **никто до коммита**; прогон — tester р.2 | 🟡 roster-8 |
| Сценарий нагрузки `tests/load` | tester (TESTING §4) | — | нет пути задачи — roster-3 |
| Миграции | backend-dev | `check-architecture.sh` + reviewer п.3 | ок |
| Контракты (API §15) | backend-dev `[contracts]` | reviewer п.5 | ок |
| Макеты и design-spec | designer | ⛔ Ivan | ок |
| Сверка с фреймом (DESIGN §16.3 п.4) | — | reviewer по design-spec.md, без Figma | 🟡 roster-11 |
| Скриншоты 360/1280 в PR (DESIGN §16.3 п.3) | **никто** (В6) | — | roster-4 |
| Доступность (DESIGN §8, §14) | frontend-dev | reviewer через «Правила по зонам» frontend | ок |
| Безопасность (SECURITY) | все | reviewer п.4, п.7, 2а | ок |
| Инфраструктура, CI | devops (opus) | reviewer п.7 + CI на PR; workflow коммитит Ivan | ок |
| Выкатка staging/prod, откат | оркестратор `/release` через CI | Ivan (environment `prod`, «да») + devops при сбое | ок |
| Smoke staging **до мержа** (TESTING §14 п.6) | — | — | нет шага — roster-6 |
| Ручные проверки Ivan: Google на staging, WebKit/Firefox, нагрузка (TESTING §4, §14 п.7) | Ivan | — | нет ⛔ в конвейере — roster-6 |
| Бэкапы, проверка восстановления | devops пишет скрипты, Ivan запускает `restore-check.sh` | reviewer | ок |
| Документация эксплуатации | architect-apply (только до задач) | reviewer («Документация») | 🟡 roster-9 |
| Спор тест/код | — | arbiter (opus) | ок |

Пути выхода: у каждой роли есть «вернуть оркестратору» или стоп; человек при ⛔ один — Ivan (BUSINESS D4, D9). Здесь замечаний нет.

## 🔴 roster-1. `.dockerignore` не попадает ни в одну зону
`.claude/zones.conf`: зона `devops` — `deploy/**`, `scripts/ops/**`, `.github/**`. Зона `backend` — свой список корневых файлов, `.dockerignore` в нём нет. При этом OPERATIONS §6.2 требует `.dockerignore`, который не пускает в образ `.git`, `.env*`, `docs`, `.claude`, а `tests/` и `apps/server/scripts/` не пускает в цель `app`. Первая версия файла — задача скелета (§6.2, последняя строка). Контекст сборки — корень workspace (цель `tools` берёт «весь workspace»), поэтому файл лежит в корне, вне `deploy/**`.
Последствие: задача `[infra]` скелета упрётся в `check-zone.sh` и будет крутиться до лимита раундов. Обойти можно, только выпустив образ без `.dockerignore`, и тогда `.env*` с локальными секретами и `.git` попадут в контекст и в цель `tools` (SECURITY §17).
Варианты: (а) `devops allow .dockerignore`, плюс строка в PIPELINE_DECISIONS §2; (б) `deploy/Dockerfile.dockerignore` (BuildKit берёт файл рядом с Dockerfile). Тогда хватает `deploy/**`, но нужна правка OPERATIONS §6.2 при reopen.

## 🟠 roster-2. Правила фронта лежат в проверках, которые фронт не может править
TESTING §11, строка 5: «проверку правит тот, кто меняет её правило, в той же задаче» (там же MUST, строка 41). Проверки правил фронта (`style={}` только с переменными, `--base-*` только в `tokens.css`, `PAGES`, бюджет бандла) живут в `scripts/check-architecture.sh` и `scripts/check-bundle.sh`. По `zones.conf` это зона только `backend`, а `frontend-dev.md` прямо запрещает «корневой `package.json`» и всё вне `apps/web`, `packages/i18n`.
Последствие: задача `[frontend]`, которая меняет такое правило, нарушает либо зону, либо MUST TESTING §11.
Варианты: (а) `frontend allow scripts/check-architecture.sh, scripts/check-bundle.sh` (пишут обе роли, но строго по очереди, как с `package-lock.json`); (б) правило architect: правка правила фронта = отдельная задача `[backend:platform]` сразу перед `[frontend]` (записать в PIPELINE_DECISIONS §6 и в architect.md); (в) вынести фронтовые проверки в `apps/web/scripts/check-*.sh`, это зона `frontend`.

## 🟠 roster-3. Сценарий нагрузки: исполнитель есть, пути задачи нет
TESTING §4: tester пишет «сценарий нагрузки» в «отдельной фиче перед этапом 5». В профиле метка tester одна — `[e2e]`, а в `feature.md` задача `[e2e]` означает только прогон (режим 2). Режим 1 tester идёт шагом 1 задачи разработчика и пропускается, если «нет публичных интерфейсов». Режим 1 в `tester.md` принимает «T-N или e2e фичи», нагрузки там нет. В фиче «нагрузка» задачи `[ci]` (`load.yml`) и `[backend:platform]` (`seed.ts --load`) не дают tester шага, где он пишет `tests/load/run.ts`.
Последствие: architect не знает, какой меткой ставить эту работу. Её сделает «кто попало» (devops или backend), а tester-путь закрыт deny, и задача зациклится на зонах.
Варианты: (а) метка `[load]` → tester, зона `tests`, режим 1 «сценарий нагрузки»: строка в «Метках задач», в `tester.md` и в architect.md; (б) в PIPELINE_DECISIONS §6 записать, что сценарий нагрузки пишет tester режимом 1 на этапе 3 вместе с «e2e фичи», и добавить вход «нагрузка» в `tester.md`.

## 🟠 roster-4. Скриншоты 360/1280 px в PR (В6) никто не делает
DESIGN §16.3 п.3 и чек-лист DESIGN §17 требуют их в каждом PR с экраном. Исполнителя нет ни в профиле, ни в агентах, вопрос В6 открыт.
Последствие: первый PR эпика с UI не выполнит DoD (TESTING §14 п.4), и reviewer этого не ловит: он работает по задачам, до PR.
Варианты: (а) tester: в `screens.spec.ts` `page.screenshot` для `desktop`/`mobile-360` в артефакт job `e2e`, ссылка в PR; оркестратор вставляет ссылку на этапе 6 (дешевле всего, исполнитель — tester, проверяющий — Ivan); (б) Ivan вручную, тогда это пункт ⛔ этапа 6 в 8.4. Решить до первого эпика с UI.

## 🟠 roster-5. frontend-dev может писать в Figma
PIPELINE_DECISIONS §1: у `frontend-dev` поле `tools:` не ограничено ради MCP Figma. Значит, ему доступны и записывающие инструменты (`use_figma`, `generate_figma_design`, `upload_assets`). Макеты утверждает Ivan (⛔ этапа 2), их автор — designer. Для Figma нет ни зоны, ни `check-zone.sh`.
Последствие: разработчик может «подогнать» утверждённый фрейм под свою вёрстку, и сверка (DESIGN §16.3 п.4) пройдёт против уже изменённого макета. Никто этого не увидит.
Варианты: (а) `tools:` у frontend-dev — явный список: базовые инструменты плюс `mcp__…figma__get_design_context`, `get_screenshot`, `get_metadata`, `get_variable_defs` (только чтение); (б) MUST NOT в `frontend-dev.md` «не вызывать записывающие инструменты Figma» (слабее, без проверки).

## 🟠 roster-6. Работы Ivan и staging до мержа без шага в конвейере
TESTING §4 (строка Ivan): вход через Google на staging, WebKit и Firefox, нагрузка — «перед этапами 5 и 6». TESTING §14 п.6: фича трогает вход, удаление аккаунта или выкатку → smoke на staging **перед мержем**. §14 п.7: горячий путь → нагрузка до prod. В `feature.md` этих ⛔ нет. В PIPELINE_DECISIONS 8.4 их тоже не предлагают, хотя профиль даёт `deploy-staging --ref "$REF"` с веткой.
Последствие: у работы есть исполнитель (Ivan), но нет точки, где конвейер его останавливает. Фича про вход уйдёт в мерж без smoke на staging.
Варианты: (а) дописать в 8.4 ⛔ этапа 5: «ручные проверки Ivan по TESTING §4 и §14 п.6–7: что и какой командой», где `deploy-staging` с `REF=feature/<slug>` запускает оркестратор; (б) хотя бы пункт в чек-лист демонстрации этапа 5 и в сводку PR.

## 🟠 roster-7. Оценка стоимости занижена, L упирается в лимит
PIPELINE_DECISIONS §7 не учитывает вызов tester на этапе 5 (приёмка, `feature.md` этап 5 п.1), вызовы arbiter, повторы после `check-zone`, а для UI ещё возможный повторный вызов designer. Пересчёт по той же модели (5,5 вызова на задачу): S ≈ 1 + 11 + 2 + 1 = 15, M ≈ 3 + 22 + 3 = 28, L ≈ 4 + 33 + 3 = 40, и это без единого арбитража. Первый эпик «Скелет» — это `[backend:platform]`, `[contracts]`, `[frontend]`, `[infra]` и несколько `[ci]` (ci.yml, deploy.yml, load.yml) плюс designer «основа дизайн-системы», то есть это L с 7+ задачами.
Последствие: ⛔ «лимит достигнут» на каждом L и уже на первом эпике. Работа не ломается, но человек получает лишние остановки, а цифра 40 ничего не ограничивает.
Варианты: (а) лимит по размеру: S 20 / M 35 / L 50 (ответ на В5); (б) оставить 40, но architect обязан резать L, если задач > 6; (в) схлопнуть шаг: см. roster-12.

## 🟡 roster-8. e2e-сценарии коммитятся без проверки
`feature.md` этап 3 п.5: tester режим 1 «e2e фичи» сразу идёт в коммит. reviewer смотрит только задачи T-N, а задача `[e2e]` — это прогон без ревью. Покрытие AC сквозными сценариями и `screens.spec.ts` (TESTING §14 п.2) никто не сверяет.
Варианты: (а) reviewer проверяет `tests/e2e/<сценарии фичи>` в задаче `[e2e]`, одна итерация; (б) в сводку этапа 5 добавить «AC → e2e-тест», и сверку делает Ivan.

## 🟡 roster-9. Документацию эксплуатации правит только architect-apply, и только до задач
В чек-листе reviewer есть пункт «новая переменная окружения… отражена в документации эксплуатации», но ни один исполнитель задач не может писать `docs/*.md`. Переменная, которую план не предусмотрел, получит блокер без исполнителя. Путь есть только через ⛔ «меняются документы основ».
Варианты: (а) в architect.md: план перечисляет все новые переменные и строки OPERATIONS, apply вносит их сразу; (б) reviewer пишет такое в «Желательно» со ссылкой «→ architect-apply», а не в блокеры.

## 🟡 roster-10. Корневые `LICENSE`, `README.md` без зоны
ARCHITECTURE §13.1 — `LICENSE` (GPL-3.0, O28). Если файла ещё нет, задача скелета его не создаст. Вариант: делает Ivan вручную (строка в 8.5) или `backend allow LICENSE README.md`.

## 🟡 roster-11. «Сверка с фреймом» без доступа к фрейму
PIPELINE_DECISIONS §6: reviewer без MCP сверяет состав и состояния по design-spec.md. DESIGN §16.3 п.4 это допускает, но расхождение «frontend-dev ↔ фрейм» (не ↔ spec) никто не видит. Вариант: дать reviewer read-only инструменты Figma (`get_screenshot`, `get_metadata`) для задач `[frontend]` с ссылкой на фрейм.

## 🟡 roster-12. Модели и число вызовов
- tester режим 2 (sonnet) на каждой задаче только запускает `test:affected` и пересказывает итог. Оркестратор может сам выполнить проверку `affected-tests` из профиля и позвать tester только при красных. Экономия ≈ 1 вызов на задачу, независимость проверки не страдает: тесты написаны tester заранее. Это правка `feature.md`, поэтому её делает человек.
- Для `Риск: high` (партия и часы, Glicko-2, Session, удаление аккаунта) opus получает разработчик, а слепые contract-тесты, которые и задают корректность, пишет sonnet. Вариант: tester режима 1 тоже на opus при `Риск: high`.

## Вопросы В1–В7: что блокирует
- **В4 — блокирует старт первого эпика**: этап 0 упадёт на `infra-up`. Нужна правка `feature.md` или явное «пропустить» Ivan до `/feature e1`.
- **В2 — блокирует первый `git push`** (этап 6 первого эпика) по O43, `/feature` до этого идёт.
- **В6** — блокирует DoD первого PR с UI (roster-4).
- **В5** — не блокирует, но см. roster-7.
- **В1, В3, В7** — не блокируют.

## Вне линзы
- Скелет: шаг tester «до кода» (TESTING §4 п.2) исходит из того, что `apps/server/test/support/**` уже есть. Для задачи скелета это не так (agentability).
- PIPELINE_DECISIONS 8.3: `release.md` п.5 пишет «наблюдение 15–30 минут», а F7 даёт 60 с в CI плюс `watch.sh`. Это учтено в 8.3, проверить при правке.

Счёт: 🔴 1 / 🟠 6 / 🟡 5
