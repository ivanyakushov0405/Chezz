# Решения конвейера (F8)

Версия 0.4 (ответ на ревью r3 и решения Ivan, раздел 12; r2 — 0.3, раздел 11; r1 — 0.2, раздел 10; первая сборка — 0.1, 2026-11-05) по F1–F7, утверждённым Ivan 2026-11-05 (коммит bab249e). Собирает `profile-builder`; меняется только при изменении документов основ (`/setup reopen`).
В колонке «Откуда» — документ и раздел; «по умолчанию» — значение набора или вывод сборщика без прямого указания в документах.

## 1. Роли и модели

| Роль | Модель | Метки | Откуда |
|---|---|---|---|
| analyst | opus | — | шаблон набора; BUSINESS §1.4 (этапы — порядок эпиков) |
| designer | opus | — | есть интерфейс (BUSINESS §1.6), Figma — BUSINESS D11, DESIGN §16 |
| architect | opus | — | шаблон набора |
| arbiter | opus | — | TESTING §4 (спор «тест неверен») |
| reviewer | opus | — | TESTING §4, §13 (DoD сверяет reviewer) |
| tester | sonnet; режим 1 у задач `Риск: high` — opus | `[e2e]`, `[load]` | TESTING §4–6, §10; модель — по умолчанию; opus при high — слепые contract-тесты задают корректность (roster-12) |
| backend-dev | sonnet | `[backend:<module>]`, `[contracts]` | ARCHITECTURE §4.1, §7.1, §13.1; модель — по умолчанию (BUSINESS D7 — минимальный бюджет), `Риск: high` → opus |
| frontend-dev | sonnet | `[frontend]` | ARCHITECTURE §4.2, §12; DESIGN; модель — как backend-dev |
| devops | opus | `[infra]`, `[ci]` | OPERATIONS §1, §15; opus — по умолчанию: правила F7 §1 и SECURITY §17 почти целиком про безопасность, вызовов мало |

- Одна роль backend-dev на все модули сервера и общие пакеты: один стек и одни правила (ARCHITECTURE §4.1, §7) — роль с параметром модуля (правило набора «не плодить роли»).
- `tools:` у frontend-dev — явный список: базовые инструменты, `Skill` и **только читающие** инструменты Figma (`create_session`, `get_design_context`, `get_screenshot`, `get_metadata`), чтобы он не мог менять утверждённые макеты (DESIGN §16.3 п.2, roster-5). Имена `mcp__plugin_figma_figma__*` — по имени сервера в этой сессии; Ivan сверяет их в `/mcp`. Если имя не совпало, агент работает по design-spec.md (написано в агенте).
- designer — `tools:` не ограничен (шаблон: ему нужна запись в Figma); запись в репозиторий держит зона `designer`.
- analyst и architect — без Bash (шаблон). Разделы они читают через Grep `^#{1,3} ` с номерами строк (оглавление) и Read `offset`/`limit`. Это то же, что `section.sh`, но без новых прав (agentability-1, вариант «Read с offset»). Оглавление у агента своё, оркестратор его не подаёт и в контексте не держит. Bash не дали: analyst и architect пишут документы, и Bash расширил бы им не только чтение.
- Мобильного приложения нет (BUSINESS §1.7) — роли mobile нет.
- sequential-thinking: off — BUSINESS не говорит о подключённом MCP (правило сборщика).

## 2. Метки и зоны

| Метка | Зона | Пути (точно — `.claude/zones.conf`) | Откуда |
|---|---|---|---|
| `[backend:<module>]` | `backend` + параметр из 12 модулей | `apps/server/src/<module>/**`, общие пути сервера, корневые конфиги | ARCHITECTURE §7.1, §13.1; скелет — TESTING §11 |
| `[contracts]` | `contracts` | `packages/protocol/**`, `packages/chess/**` (без `test/`), `scripts/check-api-doc.sh`; свой блок корневых конфигов | API §15–16, ARCHITECTURE §10 |
| `[frontend]` | `frontend` | `apps/web/**`, `packages/i18n/**`; свой блок корневых конфигов | ARCHITECTURE §12, §13.1; i18n — TESTING §11 (проверку ключей пишет frontend) |
| `[infra]`, `[ci]` | `devops` | `deploy/**`, `scripts/ops/**`, `.github/**`, `scripts/check-workflows.sh`, `.dockerignore`, `scripts/check-architecture.sh` (правило `example.com`) | OPERATIONS §15 (строка «агенты»), §6.2, §8; ARCHITECTURE §13.3 |
| `[load]` | `tests` | `tests/load/` (сценарий нагрузки, tester режим 1) | TESTING §4 («сценарий нагрузки — отдельная фича»), §10 |
| `[e2e]` | `tests` | `apps/server/test/contract/**`, `apps/server/test/acceptance/**`, `packages/chess/test/**`, `fixtures/**`, `tests/**` | TESTING §5 (зона `tests` для F8), §18.2 п.9 |

- `deny` на пути `tests` — во всех зонах разработчиков (TESTING §5, §18.2 п.9).
- `apps/server/test/support/**` — зона backend (TESTING §5): tester его только читает.
- Корневые конфиги (`package.json`, `tsconfig*.json`, `vitest.config.ts`, `eslint.config.*`, `.dependency-cruiser.cjs`, `.nvmrc`, `scripts/check-architecture.sh`, `scripts/check-bundle.sh`) — в зоне `backend` для любого модуля: скелет пишет backend-разработчик зоны `platform` (TESTING §11), а правка правила и её проверки — в одной задаче (TESTING §11 MUST, ARCHITECTURE §7.4). Выделить их только для `platform` формат зон не позволяет — по умолчанию.
- `package-lock.json`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.*` (корень) — в `backend`, `contracts` и `frontend` (r2: roster-14, roster-16, consistency-15). Lock-файл один на workspace: его меняет любая новая зависимость (SECURITY §18), в том числе пакета; ссылку `tsconfig`, проект Vitest и правила ESLint добавляет задача, которая создаёт workspace (TESTING §5, §6, §11). Задача меняет только свой блок; задачи идут по очереди — в одной задаче писатель один — по умолчанию. Остальные корневые файлы (`tsconfig.base.json` и т. п., `.dependency-cruiser.cjs`, `.nvmrc`) — только `backend`.
- `[contracts]` — отдельная задача **до** задач, которые используют схемы: contract-тесты tester импортируют `packages/protocol`, и он должен уже содержать схемы (TESTING §4 п.2). API §15 говорит «в одной задаче» про маршрут целиком — см. вопрос В3.
- Новые строки `packages/i18n` для шаблонов `seo` — задача `[frontend]` (владелец пакета — по умолчанию).
- `.github/workflows/**`: devops готовит текст, коммитит и пушит Ivan (TESTING §12, OPERATIONS §1, §16.2).
- CLAUDE.md: `apps/web/CLAUDE.md` закрыт `deny` (иначе его покрывает `apps/web/**`); `packages/CLAUDE.md` не входит ни в один `allow`; `deploy/CLAUDE.md` закрыт `deny` в devops. Меняет их только сборка конвейера (по умолчанию).
- Добавлено в r1: `.dockerignore` → devops (OPERATIONS §6.2: контекст сборки — корень); `LICENSE`, `README.md` → backend (OPERATIONS O28: «файл создаёт задача скелета»); `scripts/check-architecture.sh` → также frontend (свои правила DESIGN §17) и devops (`example.com`, OPERATIONS §1, §8); `scripts/check-bundle.sh` → также frontend. Эти файлы пишут несколько ролей, но строго по очереди. Каждая правит только проверку своего правила (TESTING §11).
- Файлы скелета и их зоны — по задачам, порядок — `.claude/profile.md`, «Скелет репозитория». Конфиг Stylelint — `apps/web/.stylelintrc.json`, зона frontend (DESIGN §17).

## 3. Правила по зонам
Разделы с MUST / MUST NOT найдены `grep MUST` по каждому документу (раздел — номер ближайшего заголовка), разнесены по зонам по путям и предмету правила. Таблица — `.claude/profile.md`, «Правила по зонам». Разделы §1 «Правила для агентов» всех документов входят во все зоны, к которым относятся.

## 4. Проверки

| Имя | Команда | Откуда |
|---|---|---|
| infra-up | `npm run db:test:up` | TESTING §6, §12 |
| check | `npm run check` | TESTING §12 «после разработчика» |
| tester-lint, tester-tsc | `npx eslint …`, `npx tsc -b … \| grep -v TS2307/2305` | TESTING §4 п.2 |
| affected-tests | `git fetch origin main && npm run test:affected` | TESTING §6 (перед ним — `git fetch`), §12 |
| e2e | `npm run test:e2e -- tests/e2e/<сценарии фичи>` | TESTING §12 «задача `[e2e]`» |
| tester-untouched | `git status --porcelain -- <пути tests>` пусто (ловит и новые файлы, agentability-7) | TESTING §1, шаблон reviewer |

Команды появятся с задачей скелета (TESTING §6: «создаёт задача скелета»). Полный набор — CI (TESTING §12).

## 5. Выкатка

| Шаг профиля | Команда | Откуда |
|---|---|---|
| deploy-staging | `gh workflow run deploy.yml --ref "$REF" -f env=staging` | OPERATIONS §10, §9.1 шаг 2 |
| smoke-staging | `conclusion` того же run (шаг `@smoke` в job `staging`) | OPERATIONS §9.6 п.3 |
| rollback-staging | `… -f env=staging -f action=down` | OPERATIONS §10, §9.6 (staging не откатывают — гасят) |
| deploy-prod | `gh workflow run deploy.yml --ref main -f env=prod` | OPERATIONS §10, §9.1 шаг 5 |
| smoke-prod | `result=` того же run | OPERATIONS §9.4 п.8, §9.3 |
| post-deploy-check | `conclusion` того же run (проверка 60 с, 9.4 п.8 г); дальше — алерты `watch.sh` | OPERATIONS §9.4, §12.3, §13 |
| rollback-prod | `… -f env=prod -f action=rollback` | OPERATIONS §10, §9.5 |
| load-staging | `gh workflow run load.yml --ref "$REF"` | OPERATIONS §10, §11 |

- Отдельных workflow smoke и наблюдения в F7 нет — шаги профиля ссылаются на тот же run (`gh run view`). Версия — `--ref`, входа `version` нет. `bootstrap=true`, `image=`, `force=` — только Ivan (OPERATIONS §10, §23 п.12).
- Трекер — `files`: BUSINESS D10 называет GitHub Issues, формат набора знает только `files | jira` (вопрос В1).

## 6. Прочее

| Решение | Откуда |
|---|---|
| Префикс ссылок на ТЗ — «ТЗ §» | BUSINESS, все документы |
| Лимит вызовов на фичу — S 20 / M 35 / L 50, размеры S/M/L — как в наборе; L с задачами > 7 делится (r2, roster-19) | по умолчанию по пересчёту §7 (roster-7); BUSINESS D7; утверждает Ivan (В5) |
| Первый эпик — «Скелет репозитория», 7 задач в порядке профиля: `[infra]` compose.test.yml → `[backend:platform]` корень и сервер → `[contracts]` → `[backend:platform]` маршруты → `[frontend]` (+ основа e2e у tester) → `[ci]` ci.yml → `[e2e]`. У каждой — своя «проверка» шага 3 (r2, roster-13) | TESTING §6, §7.1, §9, §11, §18.2 п.4; OPERATIONS §6.4, §8, O28; ARCHITECTURE §13, §17 (F2-Q10, F2-Q12). `compose.test.yml` первым — `db:test:up` нужен с первой задачи (consistency-2) |
| Второй эпик — «Выкатка» (`[infra]` Dockerfile и VPS, `[ci]` deploy.yml, load.yml), всегда отдельно; без staging из ветки; после мержа Ivan: `bootstrap.sh` → `env=prod`, `bootstrap=true` → staging | OPERATIONS O40, O44, §9.1; r2, roster-17 |
| Ручные проверки Ivan и staging до мержа — профиль, «Ручные проверки Ivan» | TESTING §4, §14 п.6–7; OPERATIONS §9.6 |
| Сверка с Figma (DESIGN §16.3 п.4, «кто — F8») — reviewer: состав (§9) и состояния (§10.4) по design-spec.md; пиксели — нет | DESIGN §16.3; reviewer без MCP Figma — по умолчанию |
| Риск high: партия и часы, Glicko-2, вход и Session, удаление аккаунта, `deploy`, `.github` | ARCHITECTURE §9, §11; SECURITY §4, §5, §13; OPERATIONS §1 |
| Порядок задач фичи: contracts → backend по слоям → frontend → infra/ci → e2e; `[infra]`, нужный коду, — перед ним | TESTING §4 п.2; ARCHITECTURE §7.1 (слои — в профиле) |

## 7. Оценка стоимости (пересчёт r1, roster-7)
Задача: tester (sonnet) → разработчик → прогон tester (sonnet) → reviewer (opus) = 4 вызова, с доработкой в среднем ≈ 5,5. Сверху: запись и прогон e2e, приёмка (tester, этап 5), арбитраж и повторы после `check-zone` — запас ≈ 10–15 %.

| Размер | Состав | Вызовов | Из них opus |
|---|---|---|---|
| S | architect + 2 задачи + e2e + приёмка | ≈ 15–17 | ≈ 3–4 |
| M | analyst + architect + apply + 4 задачи + e2e + приёмка | ≈ 28–32 | ≈ 8–9 |
| L | analyst + designer + architect + apply + 6 задач + e2e + приёмка | ≈ 40–46 | ≈ 12–14 |
| Скелет | architect + 7 задач (шаг tester — у 4 и 5; 7 — прогон `[e2e]`) + designer (основа библиотеки) + приёмка | ≈ 35–40 | ≈ 10 |
| Выкатка | architect + 2 задачи devops + приёмка | ≈ 12–14 | ≈ 6 |

Сверх таблицы — вызов reviewer на e2e (8.4) ≈ +1. L при 8 задачах: 4 + 8 × 5,5 + 4 ≈ 52 > 50, поэтому L делится при > 7 задачах (roster-19). Отсюда лимит S 20 / M 35 / L 50 (В5). Экономия ≈ 1 вызов на задачу — если оркестратор сам запускает `affected-tests` и зовёт tester только при красных (8.4, правка `feature.md`). Задачи `[infra]`/`[ci]` и `Риск: high` добавляют opus.

## 8. Сделать человеку

`.claude/settings.json`, `.claude/commands/**`, `.claude/kit/**` правит только Ivan. Агенту чтение `settings.json` заблокировано хуком — сверьте вставку с текущим файлом сами.

### 8.1. `.claude/settings.json` — правила OPERATIONS §16.3 (условие первой выкатки, O39)
Добавить в `permissions.deny` и `permissions.ask` (существующие `deny` для `.env`, `git push --force`, `-f` остаются):
```json
"deny": [
  "Bash(gh auth:*)",
  "Bash(gh secret:*)",
  "Bash(gh variable:*)",
  "Bash(gh repo edit:*)",
  "Bash(gh repo delete:*)",
  "Read(~/.config/gh/**)",
  "Read(~/AppData/Roaming/GitHub CLI/**)"
],
"ask": [
  "Bash(git push:*)",
  "Bash(gh workflow run:*)",
  "Bash(gh pr merge:*)",
  "Bash(gh api:*)",
  "Bash(gh pr review:*)",
  "Bash(gh run cancel:*)",
  "Bash(gh run rerun:*)",
  "Bash(gh workflow enable:*)",
  "Bash(gh workflow disable:*)",
  "Bash(gh release:*)",
  "Bash(curl:*)",
  "Bash(wget:*)"
]
```
Не переносить эти правила в `allow` (OPERATIONS §16.3). При подтверждении: `gh pr merge` без `--match-head-commit <SHA>` — отклонить; любой `gh api` не-GET или непонятный — отклонить; обёртки (`env … gh api`, `bash -c "…"`) — отклонить.

### 8.2. Запуск сессии с fine-grained токеном (OPERATIONS §16.2, O43; условие первой выкатки)
1. GitHub → Settings → Developer settings → Fine-grained tokens → новый токен: Repository access — только этот репозиторий; Contents — RW, Pull requests — RW, Actions — RW, Metadata — R; **нет** Administration, Environments, Secrets, Variables, Workflows. Срок — до 1 года.
2. Запуск Claude Code из Git Bash в корне репозитория:
```bash
export GH_TOKEN='<fine-grained токен>'
export GH_CONFIG_DIR="$HOME/.config/gh-chezz-session"; mkdir -p "$GH_CONFIG_DIR"   # пустой: gh не видит вашего полного входа
export GIT_CONFIG_COUNT=2
export GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0=                       # сбросить Git Credential Manager
export GIT_CONFIG_KEY_1=credential.helper GIT_CONFIG_VALUE_1='!gh auth git-credential'  # git push — тем же токеном
gh auth status                    # должен быть только вход через GH_TOKEN
git config --get-all credential.helper   # пустая строка и !gh auth git-credential
claude
```
Строки `GH_CONFIG_DIR` и `GIT_CONFIG_*` — по умолчанию (в F7 способа нет): без них `git push` идёт через Git Credential Manager с вашим полным входом (вопрос В2).
3. Коммиты с `.github/workflows/**` пушите сами, вне сессии (у токена нет Workflows).
4. Несовпадение списка PR (O45) при выкатке prod → Reject, отзыв токена, новый по п.1 (OPERATIONS §9.2а п.3).

### 8.3. `.claude/commands/release.md` — под OPERATIONS §10 (§23 п.12)
- Шаг 3: smoke staging — не отдельный workflow, а шаг того же run `deploy.yml`; итог — `conclusion` и `result=` (коды OPERATIONS §9.3); статус `waiting` — ждать подтверждения environment Ivan, 60 мин → «ждёт Ivan», run не отменять.
- Шаг 5: `smoke-prod` и `post-deploy-check` — тот же run (`result=ok`, `conclusion=success`); наблюдение дальше — алерты `watch.sh`, не CI. Перед подтверждением environment `prod` Ivan сверяет список PR в итоге job `plan` (O45); оркестратор свой список не составляет.
- Убрать `-f version=…`: версия — `--ref`. Без `gh api`. Поиск своего run — по OPERATIONS §10.
- Первая выкатка (после `bootstrap.sh`, новый VPS) — `-f bootstrap=true` запускает Ivan, не `/release` (OPERATIONS §9.1).

### 8.4. `.claude/commands/feature.md`, этап 4 шаг 6 и этап 6
- Задача `[ci]` с изменением `.github/workflows/**`: оркестратор эти файлы **не** коммитит — ⛔ Ivan коммитит и пушит сам (TESTING §12, OPERATIONS §1).
- Перед `git push` с изменениями `.github/`, `deploy/`, `scripts/ops/` — показать Ivan diff этих путей (O36).
- Мерж (если его делает оркестратор) — только `gh pr merge <N> --match-head-commit <SHA своего push>`; голова сменилась → сообщить Ivan, не повторять (OPERATIONS §16.3).
- Этап 0, проверка `infra-up`: в первом эпике (скелет) пропускать — `compose.test.yml` создаёт задача 1, `npm run db:test:up` — задача 2 (В4).
- Этап 4 шаг 3 в скелете: вместо `check` — «проверка» задачи из профиля («Скелет репозитория»); задача 1 — `docker compose … up -d --wait`, задача 2 — `npm run check` без `check-api-doc.sh`, с задачи 3 — полный `check` (В4, roster-13). Шаг 4 «Прогон» в задаче 1 пропускать — его заменяет её проверка; в задачах 2–6 — `affected-tests` как обычно (roster-21). `check` красный только в `tests/**` → tester, режим 1, правка (roster-22). Шаг tester — только у задач 4 и 5; этап 3 п.5 в скелете пропускать — основа e2e у tester задачи 5 (roster-15).
- Этап 5: ⛔ **ручные проверки Ivan** по профилю, раздел «Ручные проверки Ivan». Staging с веткой фичи: ⛔ «да» на `git push -u origin feature/<slug>` (diff по O36), затем `deploy-staging` с `REF=feature/<slug>` (TESTING §14 п.6–7, roster-6, roster-17). До первой выкатки prod — не запускать (O40).
- Этап 3 п.5: после записи e2e-сценариев — `reviewer`, одна итерация: сверка «AC → e2e-тест» и `screens.spec.ts` для нового экрана (TESTING §14 п.2, roster-8).
- Этап 4 шаг 4 (по желанию, экономия ≈ 1 вызов на задачу): оркестратор сам запускает `affected-tests` из профиля, `tester` режим 2 — только при красных (roster-12).
- Метка `[load]` → `tester`, режим 1, вход «нагрузка»; прогон — `load-staging` по «да» Ivan (roster-3).
- `Риск: high` → tester режима 1 тоже на opus (профиль, «Модели»).
- Лимит вызовов — по размеру из профиля (S 20 / M 35 / L 50).

### 8.5. Прочее
- Ссылка на файл Figma — вписать в `.claude/profile.md`, раздел «Макеты», после первого эпика с UI (DESIGN §16.4).
- Имена инструментов Figma у `frontend-dev` (`mcp__plugin_figma_figma__…`) — сверить с `/mcp` и поправить через `profile-builder`, если отличаются.
- Настройки GitHub OPERATIONS §16.1 (ruleset, environments, CODEOWNERS) — до первой выкатки.

## 9. Открытые вопросы
| № | Вопрос | Блокирует | Решение по умолчанию (решает Ivan) |
|---|---|---|---|
| В1 | Трекер: BUSINESS D10 — GitHub Issues; набор поддерживает `files \| jira`. Сейчас `files` | нет | `files` до доработки набора |
| В2 | O43: сессия только с токеном, но `git push` по умолчанию идёт через Git Credential Manager с полным входом Ivan | **первый `git push`** — этап 6 первого эпика или этап 5 фичи со staging из ветки (roster-17) | способ из 8.2 (`GH_CONFIG_DIR` + `credential.helper` → `gh auth git-credential`); проверить `git config --get-all credential.helper` до первого push; вписать в OPERATIONS §16.2 при reopen |
| В3 | API §15 «в одной задаче» против TESTING §4 п.2 | нет | отдельная `[contracts]` перед `[backend:*]`; правка API §15 при reopen F4 |
| В4 | Этап 0 `/feature` требует `infra-up`, а до скелета его нет | **старт первого эпика** | правка `feature.md` (8.4): этап 0 — пропуск `infra-up`; этап 4 шаг 3 задач скелета — «проверка» задачи из профиля вместо `check` (задача 1 — `docker compose … up -d --wait`, задача 2 — `check` без `check-api-doc.sh`); шаг 4 задачи 1 — пропуск, его заменяет её проверка (roster-21). До правки — Ivan на ⛔ этапа 0 отвечает «пропустить», а оркестратор берёт проверку задачи скелета из профиля |
| В5 | Лимит вызовов при пересчёте §7 | **закрыт: утверждён Ivan 2026-11-05** | S 20 / M 35 / L 50; L с задачами > 7 делится |
| В6 | Скриншоты 360/1280 px в PR с экраном (DESIGN §16.3 п.3) | **закрыт решением Ivan 2026-11-05** (§12) | tester в `screens.spec.ts` пишет `page.screenshot` (`desktop`, `mobile-360`, сид-данные, без cookie) в `tests/e2e/screens/`; задача 6 скелета: job `e2e` — `actions/upload-artifact` `screens` (только эти файлы, без trace); в тело PR — строка «скриншоты: артефакт `screens` job `e2e` этого PR», без ссылки; Ivan сверяет |
| В7 | Неделимые разделы > ≈1500 токенов: GLOSSARY §2, SECURITY §17, OPERATIONS §3.2, §9.2а, §1, ARCHITECTURE §9.1; по agentability-4 ещё API §12, SECURITY §4, TESTING §11, §4, §7.6, GLOSSARY §8, ARCHITECTURE §12 | нет | разбить при ближайшем reopen (F1–F7); до тех пор tester и arbiter берут из API §12 строку операции через grep |

## 10. Ответ на ревью r1

Отчёты: `docs/setup/reviews/F8-roster-r1.md`, `F8-agentability-r1.md`, `F8-consistency-r1.md`.

### 10.1. roster и consistency-1

| Находка | Решение | Что сделано |
|---|---|---|
| 🔴 roster-1 `.dockerignore` без зоны | принято (а) | `devops allow .dockerignore`; §2; `deploy/CLAUDE.md` |
| 🔴 consistency-1 файлы скелета без зоны | принято (а) | скелет — 7 задач с метками и порядком (профиль «Скелет репозитория», §6); Stylelint — `apps/web/.stylelintrc.json` в задаче `[frontend]` (DESIGN §17), до неё `--allow-empty-input`; `LICENSE`, `README.md` → backend (O28); `check-architecture.sh` → также frontend и devops; `check-api-doc.sh` и тесты `packages/protocol` — задача `[contracts]`; `compose.test.yml` — задача `[infra]` первой; architect ссылается на порядок в профиле; backend-dev: «файл вне зоны — блокер» |
| 🟠 roster-2 проверки фронта вне зоны фронта | принято (а) | `frontend allow scripts/check-architecture.sh, scripts/check-bundle.sh`; frontend-dev — в зоне |
| 🟠 roster-3 нагрузка без пути | принято (а) | метка `[load]` → tester, зона `tests`; профиль, architect, tester (вход «нагрузка»), 8.4 |
| 🟠 roster-4 скриншоты | человеку | В6 — блокирующий, решение по умолчанию в §9 |
| 🟠 roster-5 frontend-dev пишет в Figma | принято (а) | явный `tools:` с читающими инструментами Figma; §1, 8.5 (сверить имена) |
| 🟠 roster-6 ручные проверки Ivan без ⛔ | принято (а) | профиль «Ручные проверки Ivan»; 8.4 — ⛔ этапа 5 (правка `feature.md` — Ivan) |
| 🟠 roster-7 стоимость занижена | принято (а) | пересчёт §7, лимит по размеру в профиле (В5) |
| 🟡 roster-8 e2e без проверки | человеку | 8.4: reviewer после записи e2e (правка `feature.md`) |
| 🟡 roster-9 документация эксплуатации | принято (б) | reviewer: нет в плане → «Желательно», «→ architect-apply» |
| 🟡 roster-10 `LICENSE`, `README.md` | принято | backend (OPERATIONS O28: «создаёт задача скелета») |
| 🟡 roster-11 reviewer без Figma | отклонено | у reviewer список `tools:` шаблонный, бюджет на пределе. DESIGN §16.3 п.4 допускает сверку состава и состояний; фрейм читает frontend-dev, после мержа фреймы обновляет designer (DESIGN §16.4, U24) |
| 🟡 roster-12 модели, лишний вызов | принято / человеку | tester режима 1 при `Риск: high` — opus (профиль); пропуск tester режима 2 при зелёных — 8.4 |

### 10.2. agentability

| Находка | Решение | Что сделано |
|---|---|---|
| 🟠 agentability-1 analyst/architect без Bash | принято (б, своим способом) | Grep `^#{1,3} ` с номерами строк + Read `offset`/`limit` в обоих агентах; обоснование — §1 |
| 🟠 agentability-2 devops и `scripts/ops/**` | принято (а) | devops: скрипты на VPS пишет, не запускает (OPERATIONS §5, §9.3, §15) |
| 🟠 agentability-3 скелет не создаёт Stylelint и compose.test.yml | принято (а) | порядок скелета в профиле; стоп-условие backend-dev |
| 🟠 agentability-4 стоимость чтения | частично | reviewer читает не разделы целиком, а вывод `section.sh … \| grep MUST` (шаблон) — в контекст попадают только строки правил; tester и arbiter: строка операции API §12 через grep; список В7 дополнен; разбиение разделов — reopen F1–F7 |
| 🟠 agentability-5 `[contracts]`: CLAUDE.md и тесты | принято (а) | backend-dev: `packages/CLAUDE.md`, тесты пакета, `--project unit packages` |
| 🟡 agentability-6 architect, tester на пределе | принято | architect 1489, tester 1416 (`token-report.sh`) |
| 🟡 agentability-7 новые файлы в путях tester | принято | `git status --porcelain` в профиле, backend-dev, frontend-dev, reviewer |
| 🟡 agentability-8 диапазоны разделов | принято | в профиле — по номеру, без диапазонов |
| 🟡 agentability-9 `\|` в таблице | принято | команда `tester-tsc` — в блоке кода под таблицей |
| 🟡 agentability-10 пути в analyst | принято | полные пути |
| 🟡 agentability-11 `tools:` не ограничен | частично | frontend-dev — явный список (roster-5); designer — без ограничения: нужна запись в Figma |
| вне линзы: `gh run view --log-failed` у devops | отклонено | команда есть в OPERATIONS §10 (`gh run view "$RUN" --log-failed \| tail -50`) |

### 10.3. consistency (2–6)

| Находка | Решение | Что сделано |
|---|---|---|
| 🟠 consistency-2 `db:test:up` с первой задачи | принято (а) | `[infra]` compose.test.yml — задача 1 скелета; в фичах `[infra]`, нужный коду, — перед ним |
| 🟠 consistency-3 `maskChallengeIds` | принято (а)+(б) | SECURITY §15 в зоне `contracts`; `packages/CLAUDE.md`, `apps/server/CLAUDE.md`, `apps/web/CLAUDE.md`, frontend-dev |
| 🟡 consistency-4 `deny` на CLAUDE.md пакетов | принято | лишние `deny` убраны; агенты называют `packages/CLAUDE.md` |
| 🟡 consistency-5 команда `[e2e]` | принято | tester, режим 2: `npm run test:e2e -- tests/e2e/<сценарии>` |
| 🟡 consistency-6 reviewer п.7 | принято | `.github/workflows/**` — «коммитит и пушит Ivan» |

## 11. Ответ на ревью r2

Отчёты: `docs/setup/reviews/F8-roster-r2.md` (🔴2 🟠3 🟡3), `docs/setup/reviews/F8-consistency-r2.md` (🔴0 🟠4 🟡5).

### 11.1. Скелет: выполнимость задач и корневые конфиги

| Находка | Решение | Что сделано |
|---|---|---|
| 🔴 roster-13 / 🟠 consistency-7 проверки задач 1–2 | принято (а), своим способом | профиль «Скелет»: у каждой задачи — «проверка» шага 3 вместо `check`. Задача 1 — `docker compose … config -q && … up -d --wait`; задача 2 — `npm run check` по TESTING §6 **без** `check-api-doc.sh`, `tsconfig` только на `apps/server`; задача 3 сама подключает `check-api-doc.sh` в `check` (корневой `package.json` теперь в её зоне) — с неё `check` полный. Заглушка `exit 0` (вариант б) отклонена: зелёная проверка-пустышка между задачами 2 и 3 хуже, чем честно отсутствующая. В4 расширен (этап 0 и шаг 3 задач скелета), 8.4; architect — «задачи, порядок и проверки из профиля»; backend-dev — «в скелете — проверка задачи» |
| 🔴 roster-14 / 🟡→🟠 consistency-15 (lockfile) | принято (а) | `contracts allow package-lock.json`; §2 |
| 🟠 roster-16 корневые конфиги | принято, вариант между (а) и (б) | `contracts` и `frontend` получили корневые `package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.*` — только свой блок. Задача 2 не ссылается на несуществующие workspace (TS6053), задачи 3 и 5 добавляют свои ссылки, проект Vitest с jsdom, ESLint React; задача 2 сразу ставит плагины React и Playwright и `@playwright/test`. Отдельная задача (б) отклонена: +1 задача и вызовы ради того же блока. Писатель в задаче один — задачи идут по очереди (§2) |
| 🟡 consistency-15 «7 задач, по меткам 8» | принято | выкатка вынесена (roster-17); в скелете ровно 7 задач, 7-я — прогон `[e2e]` |

### 11.2. e2e, выкатка, агенты

| Находка | Решение | Что сделано |
|---|---|---|
| 🟠 roster-15 / consistency-8 `playwright.config.ts` | принято (а) | владелец — tester (зона `tests`); основа e2e (`playwright.config.ts` с `webServer` и MUST TESTING §9, `tests/e2e/tsconfig.json`, `@smoke`, `screens.spec.ts`) — шаг tester задачи 5 скелета; этап 3 п.5 в скелете пропускается (8.4). `@playwright/test` и `test:e2e` — задача 2. В `tester.md` конфиг добавлен в «Где лежат» |
| 🟠 roster-17 smoke staging в скелете | принято (а)+(б) | выкатка — обязательный второй эпик «Выкатка» без staging из ветки; после мержа Ivan: `bootstrap.sh` → `env=prod bootstrap=true` → staging (O40, O44; профиль, §6, `deploy/CLAUDE.md`). Для обычных фич: ⛔ «да» на `git push -u origin feature/<slug>` перед `deploy-staging` (O36); В2 — «этап 5 или 6» |
| 🟠 consistency-9 / 🟡 roster-18 devops-зона | принято | `devops.md`, «Твоя зона»: `.dockerignore`, `scripts/check-architecture.sh` (только `example.com`); `deploy/CLAUDE.md` |
| 🟠 consistency-10 Figma у frontend-dev | принято | «только чтение выданными инструментами, навык перед `get_design_context`; нет инструментов — по design-spec.md и сказать в ответе» |
| 🟡 roster-19 L 50 и > 8 задач | принято (а) | L делится при > 7 задачах (профиль, §6); §7 — вызов reviewer на e2e и расчёт |
| 🟡 roster-20 Firefox | принято | `--project=webkit --project=firefox` (имена — TESTING §9) |
| 🟡 consistency-11 `db:test:up` с задачи 1 | принято | «`npm run db:test:up` — с задачи 2», проверка задачи 1 — `docker compose` |
| 🟡 consistency-12 самопроверка задачи 1 | принято | `devops.md`, «Самопроверка»: `compose.test.yml` → `up -d --wait` |
| 🟡 consistency-13 `[infra]` перед кодом | принято | `architect.md`, «Декомпозиция» |
| 🟡 consistency-14 `--toc` у analyst | принято | «оглавление ТЗ (Grep по заголовкам)» |
| вне линзы: `<…>` в «Моделях» | принято | обычный текст: «при `Риск: high` — backend-dev, frontend-dev и tester режима 1» |
| вне линзы: файлы задачи 7 | принято | в эпике «Выкатка» — `systemd/`, `env.allowlist`, `backup.age.pub` (ARCHITECTURE §13.3) |
| В6 — до старта первого эпика | человеку | §9: блокирует старт первого эпика (задача 5 скелета создаёт экран) |
| В2, В4 — уточнения | принято | §9 |

Бюджет: architect сокращён (абзац «Рассуждения», «Декомпозиция»), остальные агенты — в пределах ≈ 1500 (`token-report.sh`).

## 12. Ответ на ревью r3 (решения Ivan)

Отчёт: `docs/setup/reviews/F8-roster-r3.md` (🔴1 🟠2 🟡2). Варианты выбрал Ivan 2026-11-05.

| Находка | Решение | Что сделано |
|---|---|---|
| 🔴 roster-21 шаг 4 задачи 1 скелета | принято (а), Ivan | профиль «Скелет»: шаг 4 в задаче 1 пропускается, его заменяет её проверка; в задачах 2–6 — `affected-tests` как обычно; 8.4, В4 |
| 🟠 roster-22 типы основы e2e | принято (б), Ivan | профиль «Скелет»: `check` красный только в `tests/**` → tester (режим 1, правка), не разработчику; 8.4. Агенты не менялись (бюджет) |
| 🟠 roster-25 артефакт скриншотов | принято (а), Ivan | задача 6: job `e2e` — `actions/upload-artifact` `screens`, `tests/e2e/screens/**`, только `screens.spec.ts`, без trace; в тело PR — фиксированная строка без ссылки (профиль, «Ручные проверки Ivan»); `tester.md` — `screens.spec.ts` и путь вывода. В6 закрыт |
| 🟡 roster-23 правило `example.com` | принято (б) | задача 2 сразу включает правило `example.com` в `check-architecture.sh` (OPERATIONS §8); правит его потом devops |
| 🟡 roster-24 Dockerfile до мержа | принято | `docker build -f deploy/Dockerfile .` — в профиле (эпик «Выкатка») и `deploy/CLAUDE.md`; в `devops.md` не добавлено — бюджет 1500 |
| вне линзы: `check-architecture.sh` по несуществующим путям | принято | задача 2: несуществующие пути скрипт пропускает |
| вне линзы: файл Figma в скелете | человеку | `Макеты: file: —`; ссылку на файл, который designer создаёт в скелете, Ivan вписывает в профиль до задачи 5 (8.5). До этого frontend-dev работает по design-spec.md |
| В5 | утверждён Ivan | S 20 / M 35 / L 50, L > 7 задач делится; §9 |
