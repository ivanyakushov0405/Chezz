# E01 — Скелет репозитория

Дата старта: 2026-11-05 · ветка `feature/e01-skeleton` от `main` (f3c60fa)
Размер: L (ROADMAP) · лимит вызовов: 50 · сроков нет
Состав и порядок задач — профиль, «Скелет репозитория (первый эпик) — 7 задач».
UI: главная-заглушка; макеты — новый файл Figma (designer, основа дизайн-системы).
Зависимости: нет. `infra-up` в этапе 0 не проходит до задачи 2 (профиль, В4) — пропущено.
Трекер: files.

Вызовов: 42/50

| # | Агент | Модель | Зона | Шаг | Итог |
|---|---|---|---|---|---|
| 1 | analyst | opus | analyst | requirements | 51 AC, 28 EC; 2 вопроса Ivan, 8 — architect; зона OK |
| 2 | analyst | opus | analyst | requirements v0.2 по ответам Ivan | 51 AC; lobby default, ADR-0005/0006 приняты; зона OK |
| 3 | designer | opus | designer | основа ДС + lobby default в Figma, design-spec | файл gnC4bJJ1JlSgRH3q0mNLFx; 7 вопросов (2 — Ivan, тариф); зона OK |
| 4 | designer | opus | designer | логотип а/б/в + концепты экранов | Figma: лимит MCP Starter, ничего не нарисовано; design-spec v0.2 (текстом); зона OK |
| 5 | designer | opus | designer | новый файл на Edu | стоп на whoami: tier student, seat View; ничего не создано; зона OK |
| 6 | designer | opus | designer | новый файл на Edu, повтор | стоп на whoami: seat всё ещё View; ничего не создано; зона OK |
| 7 | designer | opus | designer | новый файл z6VyHSdwqFzCQIdP7ScisI (Edu) | ДС по §16, lobby 8 фреймов, логотип а/б/в, 32 концепта; 19 вызовов MCP, лимит не сработал; spec v0.3; зона OK |
| 8 | designer | opus | designer | логотип г/д/е (после отзыва Ivan) | 22:140/202/264; а/б/в в Archive; 20 вызовов MCP; зона OK |
| 9 | designer | opus | designer | логотип ж/з/и по примеру Ivan | 24:84/146/208; г/д/е в Archive; 7 вызовов MCP; зона OK |
| 10 | designer | opus | designer | логотип к/л/м (между з и б) | 25:86/148/210; 7 вызовов MCP; зона OK |
| 11 | designer | opus | designer | логотип н/о (гладкая C, подставка) | 26:136/198; к/л/м в Archive; 3 вызова MCP; зона OK |
| 12 | designer | opus | designer | Logo = н, favicon = о, архив | Logo 4:10, favicon 27:217; lobby обновлён; 9 вызовов MCP; зона OK |
| 13 | architect | opus | architect | design.md + ADR-0009 | 7 задач, правки основ (ARCH, API, SEC, TEST, DESIGN, OPS?), 4 вопроса Ivan; зона OK |
| 14 | architect | opus | architect-apply | apply правок основ | ADR-0005/0006/0009 приняты; ARCH, API, SEC, TEST, DESIGN; OPS не трогали; зона OK |
| 15 | architect | opus | architect | design.md v0.2: CODEOWNERS — Ivan | T-6 без CODEOWNERS, п.2 закрыт; зона OK |
| 16 | devops | opus | devops | T-1 compose.test.yml, раунд 1 | config -q OK; up --wait не прогнан (Docker не запущен); зона OK |
- T-1 проверка (оркестратор, 2026-11-06): config -q OK; up -d --wait ×2 → healthy, один контейнер; server_version 18.6, fsync off; tester-untouched пусто.
| 17 | reviewer | opus | review | T-1, итерация 1 | APPROVE, 0 блокеров; зона OK |
- T-1 [infra] готова, раундов: 1, вызовов: 17/50.
| 18 | backend-dev | opus | backend:platform | T-2, раунд 1 | целиком; check OK, 19/19 тестов; зона OK |
- T-2 проверки (оркестратор): check OK; tester-untouched пусто; test:affected — 1-й прогон 1 failed/19 (детали не сохранены), следующие 9 прогонов зелёные; не воспроизводится.
| 19 | reviewer | opus | review | T-2, итерация 1 | CHANGES_REQUESTED: 2 блокера (cruiser platform, AC-15 flaky по UUID); зона OK |
| 20 | backend-dev | opus | backend:platform | T-2, раунд 2 | оба блокера исправлены; check OK, 19/19 ×3; зона OK |
- T-2 раунд 2 проверки (оркестратор): check OK; tester-untouched пусто; test:affected ×3 зелёные.
| 21 | reviewer | opus | review | T-2, итерация 2 | APPROVE; зона OK |
- T-2 [backend:platform] готова, раундов: 2, вызовов: 21/50.
| 22 | backend-dev | sonnet | contracts | T-3, раунд 1 | protocol, chess-каркас, check-api-doc.sh; check OK; зона OK |
- T-3 проверки (оркестратор): check OK (вкл. check-api-doc); tester-untouched пусто; test:affected ×2 — 37/37.
| 23 | reviewer | opus | review | T-3, итерация 1 | CHANGES_REQUESTED: GetHealthResponse strictObject (ответ должен быть нестрогим); зона OK |
- Зависимости T-3 (SECURITY §18): `zod` — схемы протокола (API §1, уже в корне с T-2); `chess.js` — каркас `@chezz/chess`, правила в E06 (ARCHITECTURE §10, ROADMAP E01).
| 24 | backend-dev | sonnet | contracts | T-3, раунд 2 | GetHealthResponse z.object, снимок, тесты AC-18 и snake_case; зона OK |
- T-3 раунд 2 проверки (оркестратор): check OK; tester-untouched пусто; test:affected — 38/38.
| 25 | reviewer | opus | review | T-3, итерация 2 | APPROVE; зона OK |
- T-3 [contracts] готова, раундов: 2, вызовов: 25/50.
| 26 | tester | opus | tests | T-4 режим 1 | health 8 + rate-limit 10 тестов; 17 красные (нет маршрута); lint/tsc OK; зона OK |
- Вопросы tester T-4 к design (architect, позже): общий ли счётчик лимита у маршрутов /api/*; поля AppConfig в «Публичных интерфейсах».
| 27 | backend-dev | opus | backend:platform | T-4, раунд 1 | registerRoute, errors, rate limit (общий счётчик), health, SPA; 101 тест; tsconfig-ссылка на protocol — TS6310 (зона contracts); зона OK |
- T-4 проверки (оркестратор): check OK; tester-untouched пусто; test:affected ×2 — 101/101.
- Зависимости T-4 (SECURITY §18): `@fastify/rate-limit` — лимит по ADR-0006; `@fastify/static` — раздача SPA (design T-4); `@chezz/protocol` — workspace.
| 28 | reviewer | opus | review | T-4, итерация 1 | APPROVE; 6 отступлений приняты; 6 «желательно»; правки design.md; зона OK |
- T-4 [backend:platform] готова, раундов: 1, вызовов: 28/50.
- Хвост до E04 (ревью T-4): свой сериализатор ошибок pino — поле `detail` ошибок pg утечёт e-mail (SECURITY §15).
| 29 | tester | sonnet | tests | T-5 режим 1 (основа e2e; 1 обрыв по лимиту API, продолжен) | playwright.config, lobby/smoke/screens spec; lint/tsc OK; зона OK |
- Вопросы tester T-5 к design (architect, позже): фон темы на body (--color-bg); устройство webkit (iPhone 13).
| 30 | frontend-dev | sonnet | frontend | T-5, раунд 1 | apps/web, packages/i18n, lobby default; check OK; e2e desktop+mobile-360 на vite preview 34/34; полный e2e не прогнан (Docker); зона OK |
- T-5 проверки (оркестратор, Docker запущен): check OK; tester-untouched пусто; test:affected 117/117; test:e2e 50 passed / 18 failed: firefox ×17 — не запускается локально (firefox.exe: Permission denied, окружение машины); webkit ×1 — AC-39 Tab не ставит фокус на ссылку → арбитр.
| 31 | arbiter | opus | review | T-5 спор webkit AC-39 | TEST: в webkit Alt+Tab (tabsToLinks), код не трогать; зона OK |
| 32 | tester | sonnet | tests | T-5 правка AC-39 по вердикту TEST (2 захода) | webkit: Shift + focus(), аннотация tabsToLinks; webkit/desktop/mobile-360 зелёные; зона OK |
- T-5 e2e после правки: desktop + mobile-360 + webkit — 51/51 (реальный webServer); firefox локально не запускается (окружение), проверит CI.
- Зависимости T-5 (SECURITY §18): react, react-dom — SPA; vite, @vitejs/plugin-react — сборка; @types/react(-dom) — типы; jsdom — проект Vitest web; @chezz/protocol (dev) в i18n — тест error.<code>.
| 33 | reviewer | opus | review | T-5, итерация 1 | CHANGES_REQUESTED: правило PAGES слишком узкое; метки AC/EC в именах тестов; зона OK |
| 34 | frontend-dev | sonnet | frontend | T-5, раунд 2 | правило PAGES шире (+leaderboard), метки AC/EC, тесты {name} и plural; зона OK |
- T-5 раунд 2 проверки (оркестратор): check OK; tester-untouched пусто; test:affected 118/118; e2e desktop+mobile-360+webkit 51/51.
| 35 | reviewer | opus | review | T-5, итерация 2 | APPROVE; зона OK |
- T-5 [frontend] готова, раундов: 2 (+ арбитр TEST по AC-39 webkit), вызовов: 35/50.
| 36 | devops | opus | devops | T-6 [ci] | ci.yml (check + e2e, postgres:18 services, gitleaks по digest, actions по SHA), dependabot.yml, scripts/check-workflows.sh (EC-25: 13 нарушений → код 1); CI не запускался до push; зона: вне зоны только .claude/profile.md — правка Ivan, не devops |
- T-6 проверки (оркестратор): check OK; check-workflows OK; tester-untouched пусто.
| 37 | reviewer | opus | review | T-6, итерация 1 | CHANGES_REQUESTED: git diff без --no-renames (перенос apps/→docs/ пропустит e2e, EC-24); желательно: strip_comments в check-workflows.sh обходит запрет secrets.* через « #» в кавычках; digest gitleaks вручную; зона OK |
| 38 | devops | opus | devops | T-6, раунд 2 | ci.yml:119 git diff --no-renames (проверено на деревьях, перенос apps/→docs/ даёт оба пути); check-workflows.sh: secrets.* по исходному файлу, с комментариями; мутации 15/15; зона OK |
- T-6 раунд 2 проверки (оркестратор): check OK; check-workflows OK; tester-untouched пусто.
| 39 | reviewer | opus | review | T-6, итерация 2 | APPROVE; желательное (digest gitleaks вручную, docker/docker-compose в dependabot → architect-apply); зона OK |
- T-6 [ci] готова, раундов: 2, вызовов: 39/50. ci.yml коммитит и пушит Ivan; CODEOWNERS — Ivan. Jira: KAN-31.
| 40 | tester | sonnet | tests | T-7, режим 2 (прогон) | desktop 17/17, mobile-360 17/17, webkit 17/17; screens: 6 PNG (RU/EN × 3 проекта); firefox — CI; зона OK |
- T-7 [e2e] готова: AC-51 локально закрыт; CI-часть — после push. Jira: KAN-32.
| 41 | architect | opus | architect | сверка design.md с кодом (v0.3) | сигнатуры, порядок registerRoute, лимит (TimeSource, общий счётчик, IPv6 /64), ответы tester, «Хвосты» (17), «Изменения документов основ v0.3» — 18 пунктов на утверждение Ivan; вопрос: логин в CODEOWNERS vs OPERATIONS §1; зона OK |
| 42 | designer | sonnet | designer | сверка design-spec с кодом (v0.4) | logo-knight 28×28, CSS-маска, forced-colors к E09; правки DESIGN на утверждение: U31 (маска), --layout-logo-mark 28px, §17/U39 node-окружение; хвосты: убрать исключение *.test.ts в check-architecture.sh, reduced-motion (E04); зона OK |
