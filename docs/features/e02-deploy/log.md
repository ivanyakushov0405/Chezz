# E02 — журнал конвейера

- Дата старта: 2026-11-08
- Эпик: E02 «Выкатка: VPS, образ, `deploy.yml`, `load.yml`» (ROADMAP, KAN-5)
- Размер: M (ROADMAP); UI нет — designer не участвует; риск high (deploy/ci)
- Состав и порядок задач — профиль, «Эпик «Выкатка»»: `[infra]` → `[ci]`; ⛔ этапа 5 — без `deploy-staging` (O40)
- Ограничения: срок — не задан; лимит вызовов — 35 (профиль, M); макеты — не нужны
- Этап 0: документы на месте; E01 (PR #3) и E03 (PR #9) смержены; infra-up — зелёный

## Вызовы агентов (14/35)
| # | Агент | Модель | Этап | Итог |
|---|---|---|---|---|
| 1 | analyst | opus | требования | 64 AC, 42 EC, 10 рисков; 5 вопросов Ivan, 10 — architect (A1–A10); блокеров нет; зона OK |
- 2026-11-08: требования утверждены Ivan («Утверждаю»). Ответы: 1 — `backup.age.pub` пока не делать (E20); 2 — 3 дампа в режиме local пока так; 3 — Ivan спросил, что такое GHCR, решение не принято (вопрос — в план architect); 4 — `scripts/ops/` оставить до E20; 5 — статусы E01/E03 в ROADMAP обновить (зона roadmap — на приёмке).
| 2 | architect | opus | design | 5 задач (T-1 backend:platform, T-2…T-4 infra, T-5 ci), 21 правка основ + ADR-0011, e2e нет; 5 вопросов Ivan |
- 2026-11-08: план утверждён Ivan («Утверждаю»), включая 21 правку основ и ADR-0011, T-1 [backend:platform]. На вопросы ответа нет — действуют варианты плана: GHCR (а) Public вручную; правка профиля (backup.age.pub, прогон `--project deploy`) — на приёмке; `docker build` в `ci.yml` — после E02. `jq` у Ivan установлен.
| 3 | architect | opus | apply | OPERATIONS п.1–12, TESTING п.1–6, ARCHITECTURE п.1–3, ADR-0011 внесены; найден дефект П6: в §9.4 пропали проверки а–г, устарели ссылки «9.4 п.N», «A4» — нужна отдельная правка (⛔ Ivan); зона OK |
- Jira: T-1…T-5 = KAN-39…KAN-43 (эпик KAN-5).
- 2026-11-08: Ivan утвердил корректирующую правку OPERATIONS §9.4 (а–г под п.11, «A4», ссылки 9.4 п.N в OPERATIONS и PIPELINE_DECISIONS) — «Да, внести».
| 4 | architect | opus | apply (корректирующая) | §9.4 п.11 а–г восстановлены дословно (сверено с 9d0f351), «A4», ссылки 9.4 п.N в OPERATIONS и PIPELINE_DECISIONS; зона OK |
| 5 | backend-dev | sonnet | T-1 код, раунд 1 | vitest deploy/deploy-image, test:unit, yaml, tsconfig, eslint; check зелёный; ЗОНА: tests/deploy/{tsconfig.json,placeholder.ts} вне backend:platform (план отнёс tsconfig tests/deploy к T-1) — удалены, каталог создаёт tester (зона tests), k=2 |
| 6 | tester | sonnet | T-1 режим 1 (основа tests/deploy) | tsconfig.json, support/bash.ts (runScript, makeTempDir, writeFake, writeLoggingFake, toBashPath); lint/tsc OK; зона OK |
- T-1 проверки (оркестратор): check зелёный; vitest --project deploy и deploy-image — код 0.
| 7 | reviewer | opus | T-1 ревью, итерация 1 | CHANGES_REQUESTED: eslint запрещает it.skipIf в tests/deploy (нужен блок V24); желательно — groupOrder 3 в TESTING §6, test:affected и deploy-image; зона OK |
| 8 | backend-dev | sonnet | T-1 раунд 3 | блок eslint tests/deploy: только skipIf(process.platform === "win32"); check зелёный, unit 178/178; зона OK |
| 9 | reviewer | opus | T-1 ревью, итерация 2 | CHANGES_REQUESTED: блок tests/deploy выключил vitest/no-disabled-tests и потерял селектор MemberExpression (it.concurrent.skip, const s = it.skip проходят); блокер итерации 1 закрыт; зона OK |
- T-1: k = 4 > 3 — ⛔ лимит раундов, выбор Ivan.
- 2026-11-08: Ivan — вариант (1) «Ещё 2 раунда» для T-1; подсказка — убрать "off" для vitest/no-disabled-tests и вернуть селектор MemberExpression.
| 10 | backend-dev | sonnet | T-1 раунд 4 | no-disabled-tests вернул, MemberExpression + it.concurrent.*; 6 случаев по заданию; check зелёный; зона OK |
| 11 | reviewer | opus | T-1 ревью, итерация 3 | APPROVE; желательно — сообщение правила, отложенное из итерации 1 (groupOrder 3 в TESTING §6, test:affected и deploy-image); зона OK |
- T-1 [backend:platform] готова, раундов: 4 (лимит, выбор Ivan — +2), вызовов: 11/35
| 12 | tester | opus | T-2 режим 1 | 65 тестов (deploy 51: image.static 9, compose 24, caddy 9, allowlist 7; deploy-image 14), все красные по делу; EC-35 таймеры — T-4; lint/tsc OK; зона OK |
| 13 | devops | opus | T-2 код, раунд 1 | Dockerfile (app, tools; node:24-bookworm-slim), .dockerignore, compose.yml, Caddyfile, env.allowlist; deploy 51/51, deploy-image 14/14, оба docker build, check зелёный; отступление: образ по умолчанию `chezz.invalid/unset/...` в compose; прерван лимитом API и выключением Docker Desktop, продолжен; зона OK |
- Предложение tester (позже): таймауты у docker port/inspect/run в AC-5 image.image.test.ts — зависание 900 с при недоступном демоне.
- T-2 прогон (оркестратор): deploy 51/51, deploy-image 14/14, check зелёный, tester-untouched пусто.
| 14 | reviewer | opus | T-2 ревью, итерация 1 | APPROVE; оба отступления приняты; желательно 6 (заглушка chezz.invalid в OPERATIONS §6.1 → architect-apply; db получает весь prod.env; O36 diff deploy/ до push); зона: review.md OK; `.claude/profile.md` — правка Ivan («Модели»), не агента |
- Отложено (а): OPERATIONS §6.1 — заглушка образа `chezz.invalid` (architect-apply); (б) `db` — только нужные ключи вместо всего `prod.env`.
- 2026-11-10: Ivan подтвердил — правка «Модели» в `.claude/profile.md` его; с T-3 модели по новому правилу (reviewer/devops opus только при Риск: high). Файл не входит в коммиты задач.
- T-2 [infra] готова, раундов: 1, вызовов: 14/35
