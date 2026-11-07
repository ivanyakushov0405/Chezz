# Ревью E03 — наблюдаемость

## T-1 — итерация 1
Вердикт: APPROVE

Что проверено: diff `packages/protocol/src/{common,index,snapshot,schemas.test,snapshot.test}.ts`, `snapshot/protocol.json`, новые `scrub.ts`, `scrub.test.ts`. Тесты tester (`apps/server/test/acceptance/protocol/`) не изменены: `git diff` и `git status --porcelain` по путям tester пусты. `vitest run packages/protocol apps/server/test/acceptance/protocol`: 78/78. Правила зоны contracts из профиля (GLOSSARY §1, §6, §12; ARCHITECTURE §1, §10; SECURITY §1, §12, §15; API §1, §4.2, §6, §7, §9.1, §14, §15, §16; TESTING §1, §7.4, §11, §13) сверены по MUST/MUST NOT. Нарушений нет.

- Требования: всё по плану T-1. `scrub.ts` с экспортом в `index.ts`, `request_id: z.uuid()`, `io: "output"` для `response`, `common.ErrorResponse` и `ws_server`, снимок перегенерирован. Лишнего нет, новых зависимостей нет, `@sentry/*` не импортируется.
- SECURITY §15 S37: удаляются `request.cookies/headers/data/query_string/env`. У `user` остаётся только `id`. Строка запроса и фрагмент отрезаются до маскировки у `request.url` и `data.url/to/from`. Маскируются `transaction`, `message`, `logentry.message`, `exception.values[].value` и `breadcrumbs[]`. Маскировка только через `maskChallengeIds`, второй реализации нет. `/game/<id>` не трогается.
- Покрытие: тесты tester есть на AC-12…AC-16, AC-32 и EC-3…EC-6, по тесту на каждое поле (SECURITY §15 MUST, TESTING §1). Свои тесты разработчика проверяют каждое поле `request` отдельно, нестроковые и чужие типы, бросающий геттер, замороженный объект и режимы `toJson` / `toOutputJson` в снимке.
- API §7, совместимость снимка без смены `PROTOCOL_VERSION`. Возражений нет:
  - `request_id` сужен только на выходе. Сервер генерирует его сам: `genReqId: randomUUID()` (v4, подходит под шаблон `z.uuid()`), входящий заголовок не принимается (`requestIdHeader: false`, `apps/server/src/app.ts:30-31`). Ни один ответ, который сервер уже шлёт, схему не нарушает.
  - `additionalProperties: false` у ответов и `ErrorResponse` — это запись в JSON Schema того, что схемы zod на выходе отбрасывают лишние ключи. Форма ответа не меняется. Клиент по API §1 и так разбирает ответы нестрого.
  - Входные схемы (`params`, `query`, `body`, `ws_client`) в снимке не изменились.
  - В PR оркестратор MUST добавить строку «снимок изменён совместимо: `request_id` → uuid (выход, сервер шлёт `randomUUID`); `io: output` у ответов — `additionalProperties: false`, форма ответов не изменилась» (API §7, §16).

### Блокеры
нет

### Желательно
- [packages/protocol/src/scrub.ts:131-137] Один `try` на всю функцию. Если на каком-то поле бросит исключение, все следующие поля не очищаются, и событие уходит частично очищенным (fail-open). Пример: бросающий геттер `message` — тогда не маскируются `exception`, `breadcrumbs` и т.д. `request` и `user` идут первыми, это смягчает риск, но по сути главный фильтр ПДн (риск high) пропускает данные при сбое. → Обернуть в `try` каждый шаг `scrubEventFields` отдельно, чтобы сбой одного поля не мешал остальным. Либо при сбое ставить сырым текстовым полям заглушку. Сейчас не блокер: события Sentry — обычные объекты. (Чек-лист п.2 и п.4, SECURITY §15.)
- [packages/protocol/src/scrub.ts:9-66] Структурные типы пока не сверены с настоящими типами `@sentry/node` / `@sentry/browser`: пакетов ещё нет в `node_modules`. → В T-3 и T-5 подставить `scrubSentryEvent` в `beforeSend` / `beforeSendTransaction` и `scrubSentryBreadcrumb` в `beforeBreadcrumb` без `as` и убедиться, что `tsc` проходит. Если не пройдёт — поправить типы `SentryEventLike` и `SentryBreadcrumbLike` отдельной задачей `[contracts]`, а не приведением типов в `apps/*`.
- [packages/protocol/src/scrub.ts:105-123] Если трассировку когда-нибудь включат, у transaction-события останутся неочищенными `spans[].description`, `spans[].data["url"]` и `contexts.trace.data` с URL `/api/challenges/<id>/…`. SECURITY §15 перечисляет только поля, которые сейчас обрабатываются, а AC-16 допускает выключенную трассировку. → T-3 и T-5 должны явно не задавать `tracesSampleRate` (или ставить 0). Включение трассировки — только через правку SECURITY §15 с перечнем полей span'ов (→ architect-apply).
- [packages/protocol/src/scrub.ts:79] `stripQuery` отрезает всё после первого `?` или `#`. Для `request.url` и `data.url/to/from` так и задумано, а `message` у крошки сохраняет строку запроса (`GET /challenge/:id?x=1`), это закреплено тестом разработчика (`scrub.test.ts`, «message маскируется, но строка запроса в message сохраняется»). SECURITY §15 требует удалять строку запроса только у URL-полей, так что это по правилам. Но у fetch-крошки в `message` может оказаться `/auth/google/callback?code=…`. → Проверить в T-5, что SDK браузера не кладёт URL со строкой запроса в `breadcrumb.message`. Если кладёт — поднять вопрос architect.

## T-2 — итерация 1
Вердикт: CHANGES_REQUESTED

Что проверено: diff `.env.example`, `apps/server/package.json`, `package-lock.json`, `app.ts`, `platform/{config,config.test,log,routes.int.test,skeleton.int.test}.ts`, `test/support/app.ts`, `scripts/check-architecture.sh`; новые `platform/{metrics,log.test,check-architecture.test}.ts`; `main.ts` (не менялся, EC-17 — `listen` реджектится → «app failed to start», `exit(1)`). Тесты tester не изменены: `git diff` и `git status --porcelain` по путям tester пусты. `vitest run` (из корня) по `platform/{check-architecture,log,config}.test.ts` и `test/contract/platform`: 49/49. Правила зоны backend из профиля сверены по MUST/MUST NOT (ARCHITECTURE §1, §7.2, §14; SECURITY §15, §18; TESTING §7.3, §11 и др.).

- Требования: AC-1…AC-9, EC-12…EC-17 закрыты (тесты tester + `log.test.ts` на AC-9, `config.test.ts` на конфиг). Свой `Registry` на экземпляр, `app_info{version}`, `node:http` без лимита и лога, 404 с пустым телом, `start`/`stop` в `onReady`/`onClose`. SECURITY §15: путь маскируется `maskChallengeIds`, `err` — только `type/message/stack/code`, `cause` и `detail` не пишутся.
- `prom-client` — в плане с причиной (SECURITY §18); `@opentelemetry/api`, `bintrees`, `tdigest` — его транзитивные, лицензии MIT/Apache-2.0.
- Отступления разработчика:
  - `AppDeps.onMetrics?` — допустимо. Тот же приём, что `onRoute`. Без него `startApp.close()`, который не вызывает `app.close()`, не освободил бы порт (AC-6). Штатный `app.close()` освобождает порт через `onClose`.
  - `createMetrics` вместо `create…Service` — допустимо. Так же названы помощники `platform` (`createDb`, `createLogger`), вызов — только в `app.ts`. Минус: правило 5 `check-architecture.sh` этот вызов не видит (см. «Желательно»).
  - Без ретраев при явном `config.metrics` — допустимо. Иначе EC-17 повторял бы занятый порт 5 раз. Побочный эффект — см. «Желательно».
- Документация: `APP_VERSION`, `SENTRY_DSN`, `METRICS_HOST`, `METRICS_PORT` есть в OPERATIONS §6.2 и в таблице переменных; `.env.example` обновлён.

### Блокеры
- [scripts/check-architecture.sh:125] Шаблон `'\/challenge|\/api\/challenges'` в `grep -E` означает просто `/challenge` (`\/` = `/`). Проверено: `printf 'const p = "/challenge/x";\n// see /api/challenges/:id\n' | grep -E '\/challenge|\/api\/challenges'` находит обе строки. Правило запрещает любую подстроку `/challenge` в `apps/server/src` и `apps/web/src` вне тестов: комментарий `// POST /api/challenges/:id/accept`, строку лога, будущий модуль `challenges`. Это расходится с комментарием правила (стр. 122), текстом нарушения и design T-2 («сначала grep экранированного слэша»). → Искать сам обратный слэш: `grep_files '\/challenge|\/api\/challenges'`. В `check-architecture.test.ts:55` добавить случай: `apps/server/src/z.ts` с `"/challenge/x"` и комментарием `// /api/challenges/:id` → нарушения «вторая маскировка» нет. (Чек-лист п.2, корректность; TESTING §11: правка правила — вместе с его проверкой; design T-2.)

### Желательно
- [apps/server/src/platform/metrics.ts:24] Каждый `createMetrics` вызывает `collectDefaultMetrics`. Внутри prom-client 15.1.3 (`lib/metrics/gc.js:45`, `eventLoopLag.js:46`) создаются `PerformanceObserver` по GC и включённый `monitorEventLoopDelay`. Отключить их нельзя, они держат `Registry` экземпляра до конца процесса. В prod экземпляр один, так что это не блокер. Но в тестах каждый `buildApp` (даже с `metrics: null`) добавляет по наблюдателю, который срабатывает на каждой сборке мусора в воркере. → Как минимум вызывать `collectDefaultMetrics` только при `deps.config !== null`. Если при росте числа тестов воркеры начнут тормозить — вопрос architect (EC-16 / ADR-0010).
- [apps/server/test/support/app.ts:91] При явном `config.metrics` ретраев нет и на коллизии **основного** порта (гонка `freePort`) — тест упадёт случайно. → Ретраить, если занят основной порт: сравнить `(err as {port?: number}).port` с `port`.
- [scripts/check-architecture.sh:86-98] Правило 5 видит только `create<Модуль>Service(`, поэтому вызов `createMetrics` вне `app.ts` оно не поймает. → Можно добавить `createMetrics` в список имён правила 5 или вынести это в «Хвосты».
- [apps/server/test/support/app.ts:95] При `config.metrics: null` `metricsUrl` указывает на свободный порт, который никто не слушает. → Комментарий в `TestApp.metricsUrl` («без метрик — адрес без сервера») или пустая строка.

## T-2 — итерация 2
Вердикт: APPROVE

Что проверено: блокер итерации 1 и изменения после неё — `scripts/check-architecture.sh:125`, `apps/server/src/platform/check-architecture.test.ts`, `apps/server/src/platform/metrics.ts:23-24`. Тесты tester не изменены (`git status --porcelain` и `git diff` по их путям пусты). `bash scripts/check-architecture.sh` → `ok`; `vitest run` по `check-architecture.test.ts` и `test/contract/platform/metrics.test.ts` — 15/15.

- Блокер закрыт. В файле стоит `grep_files '\/challenge|\/api\/challenges'` (байты проверены через `od -c`). Этот шаблон, взятый из скрипта, на пробном файле находит только `/\/challenge\//` и не находит литерал `"/challenge/x"`. Новый тест «простой литерал и комментарий с /challenge, /api/challenges — не нарушение» гоняет сам скрипт и закрепляет это поведение (TESTING §11).
- `collectDefaultMetrics` теперь вызывается только при `deps.config !== null`. AC-2 на порту метрик не задет, `app_info` остаётся. Тесты с `metrics: null` (`routes.int.test.ts`, `skeleton.int.test.ts`) наблюдателей GC и event loop больше не создают.

### Блокеры
нет

### Желательно
- Пункты итерации 1 про ретрай основного порта при явном `config.metrics` (`test/support/app.ts:91`), правило 5 для `createMetrics` и `metricsUrl` при `metrics: null` остаются в силе. Ни один не блокер.

## T-3 — итерация 1
Вердикт: APPROVE

Что проверено: diff `apps/server/{package.json,src/app.ts,src/main.ts,src/platform/{errors,http,spa.int.test}.ts,test/support/app.ts}`, `package-lock.json`; новые `platform/{sentry,sentry.test,sentry.int.test,client-config,client-config.test}.ts`, `test/support/sentry.ts`. Тесты tester (коммит 2ef5fa8) не изменены: `git diff` и `git status --porcelain` по их путям пусты. `vitest run` по T-3 (unit, int, contract `client-config`/`sentry`, acceptance `error-reporter`, `spa.int`) — 83/83. Правила зоны backend из профиля (GLOSSARY §1, §12; ARCHITECTURE §1, §7.2, §9.4, §14; SECURITY §1, §6, §7, §10, §15, §17, §18; API §1, §5.1; TESTING §1, §7.3, §11, §13) сверены по MUST/MUST NOT. Нарушений нет.

- Требования: AC-10 (одно событие, `tags.request_id` = `error.request_id`, `environment`, `release`, `transaction` по шаблону маршрута, `request.url` = origin + путь без строки запроса), AC-11 (4xx, в том числе zod и `forbidden` → 0 событий), AC-12/AC-19 (`sendDefaultPii: false`, хуки — функции `@chezz/protocol`), AC-18/EC-10 (без DSN — `disabledReporter`, клиента нет, `<meta chezz-sentry-dsn>` нет), EC-3…EC-7 (EC-7: `asError` не пускает поля объекта в событие; без `extraErrorData` поле `detail` у `pg` не уходит — проверено int-тестом), EC-8, EC-9 (`createFatalErrorHandler`: fatal → capture → flush(2000) → `exit(1)`, повторная ошибка только логируется, обработчик не реджектится), EC-11 (захват в `try`, отправка асинхронная, `withTimeout` на `flush`/`close`), EC-18 (`onClose` → `close(2000)`). HTML-контракт `<meta>`: `/`, `/index.html` (через `globIgnore` идут в фолбэк), `/challenge/<uuid>`; каждая — ровно один раз.
- SECURITY §15: в событие попадают только `tags.request_id`, `user.id` (если не гость), `transaction` и `request.{method,url}` (маскированные ещё до `beforeSend`); интеграций нет, значит нет `contexts` ОС и хоста, `extra`, переменных кадров, `server_name` (`includeServerName: false`). `id` вызова в `extra`/`contexts` не пишется. Scope новый на каждое событие — контекст запроса не переходит в чужое событие. T-1 «желательно» закрыты: хуки подставлены без `as` (`tsc` в `check` зелёный), `tracesSampleRate` не задан (есть тест).
- SECURITY §6/§10: в HTML только `<meta>`, inline-скрипта нет; значения экранируются (`& < > " '`). Кроме того, `APP_ENV` — перечисление, `APP_VERSION` и DSN проверяются в конфиге.
- ARCHITECTURE §9.4: на успешном запросе новой работы нет. `index.html` с `<meta>` собирается один раз в `buildApp`. Захват — только на 5xx. `Sentry.init` и автоинструментации нет, хуки `require`/`import` не ставятся.
- SECURITY §18: `@sentry/node` есть в плане T-3 с причиной. Транзитивные (`@opentelemetry/*`, `import-in-the-middle`, `require-in-the-middle`, `cjs-module-lexer`, `module-details-from-path`) под MIT/Apache-2.0.
- Отступления разработчика:
  1. `@sentry/node ~10.78.0`: допустимо. 10.x ещё выпускается (10.78.0 — 2026-10-28, позже 11.0.0), лицензия MIT. MUST SECURITY §15 «`sendDefaultPii: false`» на v10 выполняется буквально. Нужна запись в документах, см. «Желательно».
  2. `ErrorReporter.close(timeoutMs)`: обосновано. `node-core/build/cjs/sdk/client.js:47` без условия вешает `process.on("beforeExit")`, и снимает его только `close()`. Без этого каждый `buildApp` с DSN держал бы клиента до конца процесса (ADR-0005 п.2). В «Публичных интерфейсах» design метода нет → architect-apply.
  3. `integrations: []` вместо «`defaultIntegrations: false` + `linkedErrors`, `dedupe`» (design «Обзор» п.3). То, что у NodeClient нет `defaultIntegrations`, объясняет `[]` вместо значений по умолчанию, но не объясняет отказ от `linkedErrors` и `dedupe`. Это отступление от утверждённого плана без причины, см. «Желательно». Не блокер: ни одно AC/EC его не требует, утечки данных нет.
  4. `setTimeout` + `unref` в `withTimeout`: допустимо. A27 / ARCHITECTURE §7.2 относятся к `service`, `GameRoom` и таймерам модулей. Здесь же граница реального ввода-вывода SDK, и SDK всё равно ходит по реальным таймерам. С `ManualTimeSource` таймаут в тестах не сработал бы никогда.
  5. `includeServerName: false`: правильно, в Sentry не уходит имя хоста VPS (SECURITY §1, §17 — данные инфраструктуры).
  6. `MaxListenersExceededWarning` воспроизводится (11 `beforeExit`): его дают репортёры `acceptance/platform/error-reporter.test.ts`, которые не закрываются. Код разработчика не виноват: tester не мог закрыть репортёры, потому что `close` нет в интерфейсе design. См. «Желательно».

### Блокеры
нет

### Желательно
- [apps/server/src/platform/sentry.ts:55] Отступление 3. → Либо `integrations: [linkedErrorsIntegration(), dedupeIntegration()]` и `client.init()` после конструктора (иначе интеграции клиента не ставятся). Тогда `cause` из обёрток ошибок попадёт в `exception.values[]`, а их `value` уже маскирует `scrubSentryEvent`. Нужен unit-тест «`cause` с `id` вызова → `:id`». Либо architect фиксирует в design «Обзор» п.3 «без интеграций» (→ architect-apply). Решение — architect/Ivan.
- [docs/adr/0010-observability-wiring.md п.1 / design.md «Публичные интерфейсы» → «Sentry сервера»] → architect-apply: (а) добавить `close(timeoutMs): Promise<boolean>` в `ErrorReporter` и строку «каждый созданный с DSN репортёр закрывается»; (б) записать, что сервер закреплён на `@sentry/node` 10.x, потому что в 11.x нет `sendDefaultPii` (`dataCollection`), и переход на 11.x требует правки SECURITY §15 (MUST `sendDefaultPii: false` → эквивалент в `dataCollection`). Пункт (б) затрагивает и T-5: `@sentry/browser` той же линии, иначе AC-19 на клиенте упрётся в то же самое.
- [apps/server/test/acceptance/platform/error-reporter.test.ts:60] После (а) — задача tester: в `afterEach` закрывать репортёры (`close(0)`), чтобы убрать `MaxListenersExceededWarning`. Developer этот файл не правит (TESTING §1).
- [apps/server/src/app.ts:95-97] Если `metrics.stop()` бросит, `reporter.close()` не вызовется и буфер Sentry не отправится (EC-18). → Закрывать независимо: `await Promise.allSettled([metrics.stop(), reporter.close(…)])` или `try/finally`.
- [apps/server/src/platform/sentry.ts:77-78] В фатальном пути таймер `flush` с `unref`. Если исключение случится, когда цикл событий уже пуст (сервер закрыт, транспорт ничего не держит), процесс может завершиться с кодом 0 раньше, чем вызовется `exit(1)`, потому что обработчик `uncaughtException` уже перехватил исключение. → В `createFatalErrorHandler` держать свой ref-таймер до `exit` или передавать в `withTimeout` флаг «не unref». Вероятность мала, поэтому не блокер.
