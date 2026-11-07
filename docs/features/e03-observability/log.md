# E03 — журнал конвейера

- Дата старта: 2026-11-07
- Эпик: E03 «Наблюдаемость `app`: Sentry, `/metrics` с `app_info{version}`, маскирование `/challenge/<id>`, модуль `analytics`» (ROADMAP, KAN-6)
- Размер: M (ROADMAP); UI нет — designer не участвует
- Ограничения: срок — не задан; лимит вызовов — 35 (профиль, M); макеты — не нужны
- Этап 0: документы на месте; E01 смержен (PR #3); infra-up — зелёный

## Вызовы агентов (27/35)
| # | Агент | Модель | Этап | Итог |
|---|---|---|---|---|
| 1 | analyst | opus | требования | 32 AC, 28 EC; 4 вопроса Ivan, 11 — architect; блокеров нет; зона OK |
- 2026-11-07: требования утверждены Ivan («Утверждаю»); ответов на вопросы 1–4 нет — действуют значения по умолчанию из requirements.md, ручные шаги Sentry и п.4 ROADMAP — к сводке. Этап 2 пропущен (нет UI).
| 2 | architect | opus | design | 6 задач, 10 правок основ + ADR-0010, e2e 1; 2 вопроса Ivan; зона OK |
- 2026-11-07: план утверждён Ivan («Утверждаю»), включая 10 правок основ и ADR-0010; вопрос «нет метрики = 0» — принят вариант architect.
| 3 | architect | opus | apply | п.1–9 внесены; п.10 (ROADMAP) — хук: вне зоны architect-apply (зона roadmap), отложено на приёмку; зона OK |
- Jira: T-1…T-6 = KAN-33…KAN-38 (эпик KAN-6).
| 4 | tester | opus | T-1 режим 1 | 46 тестов (scrub 42, request_id 4) в apps/server/test/acceptance/protocol; lint/tsc OK; зона OK |
| 5 | backend-dev | opus | T-1 код, раунд 1 | scrub.ts, request_id uuid, снимок io:output; check зелёный; 77/78 — спор по тесту «нет id вызова»; зона OK |
| 6 | arbiter | opus | T-1 спор по тесту | прерван: лимит 5 ч API (сброс 23:20 МСК); вердикта нет |
| 7 | arbiter | opus | T-1 спор (продолжение) | TEST: фикстура message с голым id противоречит SECURITY §15; правка строки 34; зона OK |
| 8 | tester | sonnet | T-1 правка по вердикту TEST | фикстура message без голого id; 78/78; зона OK |
- T-1 прогон: оркестратор, affected-tests 147/147 (16 файлов); check зелёный; tester-untouched пусто. Режим 2 tester не вызывался — тот же прогон.
| 9 | reviewer | opus | T-1 ревью, итерация 1 | APPROVE; 4 «желательно» (try на поле, типы vs @sentry в T-3/T-5, tracesSampleRate, breadcrumb.message /auth в T-5); зона OK |
- T-1 [contracts] готова, раундов: 1, вызовов: 9/35, коммит 8c737d5
| 10 | tester | sonnet | T-2 режим 1 | 16 тестов (metrics 11, log-mask 5) + helper; AC-9/AC-17 — уровень разработчика; lint/tsc OK; зона OK |
| 11 | backend-dev | sonnet | T-2 код, раунд 1 | metrics.ts, config, log (err, маска), правило AC-17; check зелёный; зона OK |
- T-2 прогон: оркестратор, affected-tests 204/204 (28 файлов); tester-untouched пусто.
| 12 | reviewer | opus | T-2 ревью, итерация 1 | CHANGES_REQUESTED: шаблон grep правила AC-17 ловит любой /challenge; зона OK |
| 13 | backend-dev | sonnet | T-2 раунд 2 | шаблон \/challenge, тесты литерала/комментария, collectDefaultMetrics только с метриками; check зелёный, 205/205; зона OK |
| 14 | reviewer | opus | T-2 ревью, итерация 2 | APPROVE; зона OK |
- T-2 [backend:platform] готова, раундов: 2, вызовов: 14/35, коммит 627e415
| 15 | tester | opus | T-3 режим 1 | 50 тестов (sentry 11, client-config 14, error-reporter 25); AC-10 сквозной, EC-9, validation_failed — разработчику; lint/tsc OK; зона OK |
| 16 | backend-dev | opus | T-3 код, раунд 1 | sentry.ts (NodeClient без init), client-config.ts, errors/http/app/main; @sentry/node ~10.78 (v11 без sendDefaultPii); ErrorReporter.close(); check зелёный, 284/284; зона OK |
| 17 | reviewer | opus | T-3 ревью, итерация 1 | APPROVE; к architect: 10.x в ADR-0010, close() в design, integrations [] vs linkedErrors/dedupe; tester — закрывать репортёры; зона OK |
- Отложено до приёмки (решение architect/Ivan): (а) ADR-0010/design — `@sentry/node` закреплён на 10.x, переход на 11.x только с правкой SECURITY §15; (б) `ErrorReporter.close()` в «Публичных интерфейсах»; (в) `integrations: []` против `linkedErrors`/`dedupe` из design «Обзор» п.3; (г) tester закрывает репортёры в acceptance (MaxListenersExceededWarning); (д) ROADMAP п.10 — зона roadmap.
- T-3 [backend:platform] готова, раундов: 1, вызовов: 17/35, коммит 090549f
| 18 | tester | sonnet | T-4 режим 1 | 25 тестов analytics (AC-23…AC-29, EC-19…EC-23, EC-25); AC-30/31 — check-скрипты; lint/tsc OK; зона OK |
| 19 | backend-dev | sonnet | T-4 код, раунд 1 | migration 0001, analytics/{tables,repo,service}, app/database/support; check зелёный 313/313; ЗОНА: skeleton.int.test.ts вне backend:analytics — откат, k=2 в зоне backend:platform |
| 20 | backend-dev | sonnet | T-4 раунд 2 (зона backend:platform) | skeleton.int.test.ts AC-9 = число миграций; 313 зелёные; зона OK |
| 21 | reviewer | opus | T-4 ревью, итерация 1 | APPROVE; 4 «желательно» (log.error в write, снять user_active при сбое, частота captureException, лимит ключей в warn); зона OK |
- Отложено (е): T-4 «желательно» — частота captureException при недоступной БД (решение architect).
- T-4 [backend:analytics] готова, раундов: 2, вызовов: 21/35, коммит e1c9fac
| 22 | tester | sonnet | T-5 режим 1 + e2e T-6 | контрактных тестов T-5 нет (уровень разработчика); tests/e2e/observability.spec.ts 4 теста AC-20; lint/tsc OK; зона OK |
| 23 | frontend-dev | sonnet | T-5 код, раунд 1 | @sentry/browser ~10.78, meta-конфиг, onMissingKey, sourcemap; бандл 123 821 B gzip / 307 200; check зелёный, 319/319; зона OK |
| 24 | reviewer | opus | T-5 ревью, итерация 1 | CHANGES_REQUESTED: номера AC в именах тестов (AC-21/EC-26, AC-19 клиент); зона OK |
| 25 | frontend-dev | sonnet | T-5 раунд 2 | AC-21/EC-26 в именах, тест AC-19, level error; check зелёный; зона OK |
| 26 | reviewer | opus | T-5 ревью, итерация 2 | APPROVE; зона OK |
- Отложено (ж): T-5 «желательно» — browserSessionIntegration (квота Sentry), маска console data.arguments, проверка .map в check-bundle.
- T-5 [frontend] готова, раундов: 2, вызовов: 26/35, коммит aa9419b
- T-6 предпрогон (оркестратор): e2e observability — desktop/mobile-360/webkit 12/12; firefox 4 — не запускается локально (spawn UNKNOWN, окружение, как E01) → CI.
| 27 | tester | sonnet | T-6 + приёмка, режим 2 | affected 320/320; e2e observability и @smoke — desktop/mobile-360/webkit зелёные; firefox — окружение; падений по делу нет; зона OK |
- AC без номера в имени теста (по tester): AC-7 — есть («AC-7/EC-15» в metrics.test.ts, grep не поймал «/»); AC-17 — правило check-architecture + его тест; AC-30, AC-31 — check-скрипты (границы, check-api-doc/PENDING_CATALOG).
- T-6 [e2e] готова, вызовов: 27/35.
- 2026-11-08: Ivan — «Сразу PR»: отложенные решения 1–6 не вносятся в этой фиче, перечислены в PR как «позже».
