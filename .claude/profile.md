# Профиль проекта: Chezz

Источник каждого решения — `docs/PIPELINE_DECISIONS.md`. Большие документы — только разделами: `.claude/kit/scripts/section.sh <файл> <номер>`.

## Документы
| # | Документ | Файл | Раздел |
|---|---|---|---|
| TZ | ТЗ | docs/TZ.md | — |
| B | Ограничения бизнеса | docs/setup/BUSINESS.md | — |
| F1 | Глоссарий | docs/GLOSSARY.md | — |
| F2 | Архитектура | docs/ARCHITECTURE.md | — |
| F3 | Безопасность и данные | docs/SECURITY.md | — |
| F4 | API-конвенции | docs/API_CONVENTIONS.md | — |
| F5 | Дизайн-система | docs/DESIGN_SYSTEM.md | — |
| F6 | Тестирование и DoD | docs/TESTING.md | — |
| F7 | Эксплуатация | docs/OPERATIONS.md | — |

## Префикс ссылок на ТЗ
ТЗ §

## Приложения и модули
| Имя | Тип | Путь | Группа или слой |
|---|---|---|---|
| server | backend | apps/server | процесс `app` (ARCHITECTURE §5) |
| web | frontend | apps/web | SPA (ARCHITECTURE §12) |
| protocol | package | packages/protocol | контракты REST и WS (API §15) |
| chess | package | packages/chess | правила шахмат (ARCHITECTURE §10) |
| i18n | package | packages/i18n | переводы RU/EN (DESIGN §15) |
| platform | module | apps/server/src/platform | L0 |
| analytics | module | apps/server/src/analytics | L0 |
| users | module | apps/server/src/users | L1 |
| feedback | module | apps/server/src/feedback | L1 |
| rating | module | apps/server/src/rating | L2 |
| games | module | apps/server/src/games | L3 |
| challenges | module | apps/server/src/challenges | L4 |
| matchmaking | module | apps/server/src/matchmaking | L4 |
| profile | module | apps/server/src/profile | L4 |
| auth | module | apps/server/src/auth | L5 |
| seo | module | apps/server/src/seo | L5 |
| realtime | module | apps/server/src/realtime | L6 |
| deploy | infra | deploy, scripts/ops | VPS, compose (OPERATIONS §5–7) |
| ci | infra | .github | workflow (OPERATIONS §8–9) |

Слой — глубина по таблице зависимостей ARCHITECTURE §7.1: модуль зависит только от модулей меньшего слоя и только по таблице.

## Метки задач
| Метка | Агент | Зона | Параметр |
|---|---|---|---|
| `[contracts]` | backend-dev | contracts | — |
| `[backend:<module>]` | backend-dev | backend | module |
| `[frontend]` | frontend-dev | frontend | — |
| `[infra]`, `[ci]` | devops | devops | — |
| `[e2e]` | tester | tests | — |
| `[load]` | tester | tests | — |

- `[contracts]` — `packages/protocol`, `packages/chess` и `scripts/check-api-doc.sh`; идёт отдельной задачей **до** задач `[backend:*]` и `[frontend]`, которые его используют (TESTING §4 п.2).
- `[e2e]` — прогон сквозных сценариев фичи (tester, режим 2). `[load]` — tester пишет сценарий нагрузки `tests/load/` (режим 1, вход «нагрузка»; TESTING §4, §10); запуск — `load-staging`, Ivan.
- `[infra]`, нужный коду задач (переменная, сервис compose), ставится **перед** ними.
- `[ci]`: файлы `.github/workflows/**` агент готовит, коммитит и пушит **Ivan** (TESTING §12, OPERATIONS §1).
- Корневые `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.*` есть в зонах backend, contracts и frontend: задача меняет только свой блок (ссылку, проект, правило, зависимость); задачи идут по очереди — писатель один.

### Скелет репозитория (первый эпик) — 7 задач строго в этом порядке
Шаг 3 «Проверки» задачи скелета — её «проверка», а не `check`: частей `check` ещё нет (В4). `tester-untouched` — всегда. Шаг 4 «Прогон» в задаче 1 пропускается — его заменяет её проверка; в задачах 2–6 — `affected-tests` как обычно. `check` красный только в `tests/**` → tester (режим 1, правка), не разработчику. Корневой конфиг в каждой задаче правит одна роль — та, чей workspace появляется; ссылок на несуществующие workspace нет (`tsc -b` падает, TS6053).
1. `[infra]` — `deploy/compose.test.yml` (TESTING §7.1, OPERATIONS §6.4). Проверка: `docker compose -f deploy/compose.test.yml config -q && docker compose -f deploy/compose.test.yml up -d --wait`. `npm run db:test:up` — с задачи 2.
2. `[backend:platform]` — корень: `package.json` (`workspaces`, скрипты TESTING §6, `license`, `engines`, devDependency `@playwright/test`), `package-lock.json`, `tsconfig*.json` (только `apps/server`), `vitest.config.ts` (проекты TESTING §6), `eslint.config.*` (с плагинами React и Playwright), `.dependency-cruiser.cjs`, `.nvmrc`, `.gitignore`, `.env.example`, `LICENSE` (O28), `README.md`, `scripts/check-architecture.sh` (сразу и правило `example.com`, OPERATIONS §8; несуществующие пути пропускает), `scripts/check-bundle.sh`; `apps/server` (`main.ts`, `app.ts`, `platform/`, `test/support/`, `migrations/`, `scripts/seed.ts`). `check` — TESTING §6 **без** `check-api-doc.sh`; Stylelint — `--allow-empty-input`. Проверка: `npm run check`.
3. `[contracts]` — `packages/protocol` (API §15, тесты TESTING §11, `maskChallengeIds` SECURITY §15), `packages/chess`, `scripts/check-api-doc.sh`; в корне — ссылки `tsconfig.json` на пакеты, `check-api-doc.sh` в `check`, `package-lock.json`. Проверка: `npm run check` (с этой задачи — полный).
4. `[backend:platform]` — `registerRoute`, `/api/health`, `routes.int.test.ts`, `cors.int.test.ts` (API §16). Проверка: `check`.
5. `[frontend]` — `apps/web` (Vite, `.stylelintrc.json` DESIGN §17, `tokens.css`, `contrast.test.ts`), `packages/i18n`; в корне — ссылки `tsconfig.json` на `apps/web`, `packages/i18n`, `tests/e2e`; проект Vitest с jsdom для `apps/web/**` (TESTING §5); ESLint React (`react/no-danger`, TESTING §11); Stylelint без `--allow-empty-input`. Проверка: `check`.
   Шаг tester (режим 1, T-5) — основа e2e: `tests/e2e/playwright.config.ts` (`webServer`, проекты `desktop`, `mobile-360`, `webkit`, `firefox`, MUST TESTING §9 при `E2E_BASE_URL`), `tests/e2e/tsconfig.json`, `@smoke` главной, `screens.spec.ts` → `tests/e2e/screens/` (В6).
6. `[ci]` — `.github/workflows/ci.yml`, `CODEOWNERS`, `dependabot.yml`, `scripts/check-workflows.sh` (OPERATIONS §8, §16.1); job `e2e` — `actions/upload-artifact`, имя `screens`, путь `tests/e2e/screens/**` (только `screens.spec.ts`, без trace). Проверка: `check`.
7. `[e2e]` — прогон e2e задачи 5.
Шаг tester — только у задач 4 и 5. Этап 3 п.5 (e2e фичи) в скелете пропускается: основа e2e — задача 5.

### Эпик «Выкатка» — второй, всегда отдельно от скелета
`[infra]` — `deploy/Dockerfile`, `.dockerignore`, `compose.yml`, `Caddyfile`, `remote/`, `bootstrap.sh`, `systemd/`, `env.allowlist`, `backup.age.pub` (ARCHITECTURE §13.3; OPERATIONS §5, §6, §9.3); затем `[ci]` — `deploy.yml`, `load.yml` (OPERATIONS §9, §11). ⛔ этапа 5 — без `deploy-staging` (O40: staging до первой выкатки prod → код 7). После мержа — только Ivan: `bootstrap.sh` → `deploy.yml -f env=prod -f bootstrap=true` → staging (OPERATIONS §9.1, O44). Самопроверка devops: `docker build -f deploy/Dockerfile .` при изменении `Dockerfile` или `.dockerignore`.

## Правила по зонам
Номера — по одному на вызов `section.sh` (подразделы входят в раздел: «§9.2» включает 9.2а).
| Зона | Разделы |
|---|---|
| backend | docs/GLOSSARY.md §1, §3, §6, §7, §8, §9, §12; docs/ARCHITECTURE.md §1, §5, §7.1, §7.2, §7.5, §8, §9.2, §9.4, §10, §11, §12.1, §14, §16; docs/SECURITY.md §1, §4, §5, §6, §7, §10, §11, §12, §13, §15, §17, §18; docs/API_CONVENTIONS.md §1, §3, §4.2, §6, §7, §8.3, §9.1, §11, §14, §15, §16; docs/TESTING.md §1, §7.3, §7.6, §11, §13, §15 |
| contracts | docs/GLOSSARY.md §1, §6, §12; docs/ARCHITECTURE.md §1, §10; docs/SECURITY.md §1, §12, §15; docs/API_CONVENTIONS.md §1, §4.2, §6, §7, §9.1, §14, §15, §16; docs/TESTING.md §1, §7.4, §11, §13 |
| frontend | docs/GLOSSARY.md §1, §3, §12; docs/ARCHITECTURE.md §1, §10, §12, §14; docs/SECURITY.md §1, §6, §10, §15; docs/API_CONVENTIONS.md §1, §3, §8.3, §9.4, §10, §14; docs/DESIGN_SYSTEM.md §1, §3, §5, §6, §7.1, §8, §10.1, §10.2, §10.4, §11, §12, §13, §14, §15, §16.2, §16.3, §17; docs/TESTING.md §1, §11, §13 |
| devops | docs/ARCHITECTURE.md §1, §5, §14; docs/SECURITY.md §1, §16, §17, §18; docs/OPERATIONS.md §1, §5, §6.1, §6.2, §6.3, §7, §8, §9.2, §14.3, §16.3, §17; docs/TESTING.md §9, §10, §12 |
| tests | docs/TESTING.md §1, §4, §5, §7.3, §7.4, §7.6, §9, §10, §15; docs/API_CONVENTIONS.md §1, §5.2, §12, §13; docs/SECURITY.md §7; docs/ARCHITECTURE.md §10, §11; docs/DESIGN_SYSTEM.md §1, §17 |

## Проверки
| Имя | Когда | Команда |
|---|---|---|
| infra-up | перед тестами | npm run db:test:up |
| check | после разработчика | npm run check |
| tester-lint | после tester, режим 1 | npx eslint <новые файлы тестов> |
| tester-tsc | после tester, режим 1 | команда ниже (в таблице её не копировать) |
| affected-tests | прогон тестов | git fetch origin main && npm run test:affected |
| e2e | задача `[e2e]` | npm run test:e2e -- tests/e2e/<сценарии фичи> |
| tester-untouched | после разработчика | git status --porcelain -- apps/server/test/contract apps/server/test/acceptance packages/chess/test fixtures tests |

tester-tsc (пусто = готово; TS2307/2305 — только для имён из «Публичных интерфейсов»):
```
npx tsc -b --pretty false 2>&1 | grep "error TS" | grep -v -E "error TS(2307|2305):"
```
Источник — TESTING §4 п.2, §6, §12. `tester-untouched` должен быть пустым (ловит и новые файлы). До задачи 2 скелета команд `npm run …` нет — `infra-up` в этапе 0 первого эпика не проходит, `check` в задачах скелета — по их «проверке» (В4). Полный набор — CI (`ci.yml`, job `check` и `e2e`).

## Ручные проверки Ivan
Точка ⛔ — этап 5 `/feature`, до PR и мержа (TESTING §4, §14 п.6–7; OPERATIONS §9.6):
- фича трогает вход, удаление аккаунта или выкатку → ⛔ «да» Ivan на `git push -u origin feature/<slug>` (diff `.github/`, `deploy/`, `scripts/ops/` — O36), затем `deploy-staging` с `REF=feature/<slug>`; Ivan входит через Google на staging. До первой выкатки prod (скелет, эпик «Выкатка») — не запускать (O40, код 7);
- фича трогает горячий путь хода (`games`, `realtime`, `platform`) перед этапом 5 или 6 → `load-staging`, Ivan подтверждает environment;
- перед этапами 5 и 6 беты — WebKit и Firefox: `npm run test:e2e -- --project=webkit --project=firefox` (вручную, TESTING §9);
- PR с экраном — скриншоты 360/1280 px (DESIGN §16.3 п.3): tester, `screens.spec.ts`; в тело PR — строка «скриншоты: артефакт `screens` job `e2e` этого PR», без ссылки; Ivan сверяет (В6).

## Выкатка
Только запуск CI-workflow. Секреты сред — только в CI; локальной машине доступ к staging и проду не нужен.
ci-workflow: ci.yml          # проверка «main зелёный»
| Имя | Команда |
|---|---|
| deploy-staging | gh workflow run deploy.yml --ref "$REF" -f env=staging |
| smoke-staging | gh run view "$RUN" --json conclusion -q .conclusion |
| rollback-staging | gh workflow run deploy.yml --ref main -f env=staging -f action=down |
| deploy-prod | gh workflow run deploy.yml --ref main -f env=prod |
| smoke-prod | gh run view "$RUN" --log \| grep -m1 -o 'result=[a-z_]*' |
| post-deploy-check | gh run view "$RUN" --json conclusion -q .conclusion |
| rollback-prod | gh workflow run deploy.yml --ref main -f env=prod -f action=rollback |
| load-staging | gh workflow run load.yml --ref "$REF" |
Нет раздела или команда — не запуск CI-workflow → `/release` не запускается.

- Источник — OPERATIONS §10. Версия — это `--ref` (ветка или `main`), отдельного входа `version` нет. Поиск своего `$RUN` после `gh workflow run`, опрос статуса (`waiting` = ждёт подтверждения environment Ivan), коды `result=` — `section.sh docs/OPERATIONS.md 10` и `9.3`.
- smoke staging — шаг `@smoke` в job `staging` того же run (OPERATIONS §9.6 п.3): `conclusion=success` = smoke зелёный. smoke prod и наблюдение 60 с — проверки 9.4 п.8 а–г в job `prod` того же run: `result=ok` и `conclusion=success`. Дальше — алерты `watch.sh` в Telegram (OPERATIONS §12.3, §13), не CI.
- Только Ivan: `-f bootstrap=true` (первая выкатка, новый VPS — OPERATIONS §9.1), `-f image=sha256:…`, `-f force=true` (OPERATIONS §9.5, §10). Перед подтверждением environment `prod` Ivan сверяет список PR в итоге job `plan` (OPERATIONS §9.2а, O45); оркестратор свой список вместо него не составляет.
- Не запускать два `deploy.yml` одновременно; 60 мин в `waiting` → «ждёт Ivan», run не отменять (OPERATIONS §10).

## GitHub и подтверждения
- Сессия — только fine-grained токен `GH_TOKEN` (OPERATIONS §16.2, O43); `gh auth` Ivan в сессии не залогинен. Инструкция запуска — `docs/PIPELINE_DECISIONS.md`, «Сделать человеку».
- К GitHub — только команды OPERATIONS §10 и `gh pr create|view|list|checks`. Никогда: `gh api`, `curl`/`wget` к GitHub, `gh auth|secret|variable|repo edit`, `gh run cancel|rerun`, `gh workflow enable|disable`, `gh pr review`, обёртки вокруг них (OPERATIONS §1).
- Перед `git push` коммитов с `.github/`, `deploy/`, `scripts/ops/` и перед `gh pr merge` такого PR — показать Ivan diff этих путей (O36).
- Мерж — только `gh pr merge <N> --match-head-commit <SHA>`, SHA — `git rev-parse HEAD` после своего push; голова сменилась → сообщить Ivan, не повторять (OPERATIONS §16.3).
- Коммиты с `.github/workflows/**` пушит Ivan сам (у токена нет права Workflows).

## Макеты
tool: Figma (BUSINESS D11)
file: https://www.figma.com/design/z6VyHSdwqFzCQIdP7ScisI          # DESIGN §16.4, U34

## Трекер
type: jira
jira.project: KAN
jira.epic: Epic
jira.task: Task
jira.status: todo=To Do; in_progress=In Progress; review=In Review; done=Done

## Модели
Opus: analyst, designer, architect, arbiter, reviewer, devops; при `Риск: high` — backend-dev, frontend-dev и tester режима 1
Sonnet: backend-dev, frontend-dev, tester

## Рассуждения
sequential-thinking: off; roles: architect, arbiter; max-thoughts: 8   # BUSINESS не говорит о подключённом MCP

## Размеры фич
S — без analyst и designer; M — без designer, если нет UI; L — всё.
Лимит вызовов агентов на фичу: S — 20, M — 35, L — 50 (оценка — `docs/PIPELINE_DECISIONS.md` §7; утверждает Ivan, В5). L с задачами > 7 — architect делит на две фичи.
