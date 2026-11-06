# E01 — Скелет репозитория

Дата старта: 2026-11-05 · ветка `feature/e01-skeleton` от `main` (f3c60fa)
Размер: L (ROADMAP) · лимит вызовов: 50 · сроков нет
Состав и порядок задач — профиль, «Скелет репозитория (первый эпик) — 7 задач».
UI: главная-заглушка; макеты — новый файл Figma (designer, основа дизайн-системы).
Зависимости: нет. `infra-up` в этапе 0 не проходит до задачи 2 (профиль, В4) — пропущено.
Трекер: files.

Вызовов: 21/50

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
