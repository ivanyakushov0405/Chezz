# ADR-0006. Rate limit по User без зависимости `platform` от `auth`

Статус: принято (Ivan, 2026-11-05). Предложено: 2026-11-05 (architect, режим roadmap; ROADMAP «Сквозные решения» п.2). Правки документов из «Последствий» внесены в apply E01.

Изменения: 2026-11-07 — п.1 (ключ гостя: `normalizeIP`, IPv6 — подсеть /64) и п.2 (общее хранилище счётчиков, группы, окно по `TimeSource`) уточнены по итогам реализации E01 (E01 v0.3, утверждено Ivan 2026-11-07).

## Контекст
ARCHITECTURE A21 и SECURITY §9: REST и WebSocket-upgrade ограничиваются `@fastify/rate-limit` по IP для гостя и по User для Игрока (300/мин), Feedback — 5/ч Игрок, 3/ч гость. Лимит регистрирует `platform`, который ни от кого не зависит, а User известен только `auth` (F2-Q9). ADR-0005 п.7 уже вводит `request.caller`, который ставит хук `platform` через резолвер из `auth`, переданный корнем сборки.

## Решение
1. `platform` регистрирует `@fastify/rate-limit` с `global: false` и `hook: "preHandler"` — после хука `onRequest`, который ставит `request.caller` (ADR-0005). Ключ — `keyGenerator`: `caller.who !== "guest"` → `user:<user_id>`, иначе `ip:<адрес>`, где адрес — `normalizeIP(request.ip)` из `@fastify/rate-limit`: IPv4 как есть, IPv4-mapped IPv6 (`::ffff:a.b.c.d`) — как IPv4, IPv6 — начало подсети /64. Иначе лимит обходится сменой адреса внутри /64 (`trustProxy` — SECURITY §9). Session без первого входа (П1) считается по User.
2. Лимит включает сам `platform`: `registerRoute` — для каждого маршрута `/api/*` (базовый 300/мин); `platform` экспортирует ту же настройку для маршрутов вне `REST_ROUTES` — `/auth/*` (`auth`) и WebSocket-upgrade (`realtime`). Особые лимиты (Feedback) — параметр регистрации маршрута в `api.ts` модуля, значения — конфиг `platform` по SECURITY §9; `RATE_LIMIT_IP_PER_MIN` для staging — там же. Статика и HTML страниц — без лимита (SECURITY §9). Счётчики — одно хранилище `platform` на экземпляр `app` (`SharedRateLimitStore`): у ключа один счётчик на все `/api/*`, `/auth/*` и upgrade. Особый лимит (Feedback) — свой счётчик через `groupId` маршрута (`apiRateLimit({max, timeWindowMs, group})`). Окно считается по `TimeSource` (ARCHITECTURE A27), поэтому сброс окна проверяется в тестах `time.advance()`.
3. Лимит открытых WebSocket на User и token bucket на соединение — в `realtime`, как в A21; `realtime` знает User из того же `Caller`.
4. Проверка (developer `platform`, задача 4 скелета вместе с `routes.int.test.ts`): у каждого маршрута `/api/*`, `/auth/*` и upgrade есть настройка лимита; 301-й запрос гостя за минуту с одного IP — `429 rate_limited`; два Игрока с одного IP считаются раздельно.

## Последствия
- `platform` не импортирует `auth`; цикла и новой связи в 7.1 нет.
- Сначала проверяется Session, потом лимит: запрос с cookie стоит одного запроса к БД по индексу даже сверх лимита. При ≤ 20 REST/с (BUSINESS D2) это приемлемо. Если в логах флуд поддельными cookie — дополнительный грубый лимит по IP в `onRequest` до проверки Session (SECURITY §9, «по признаку»).
- Правки при apply/reopen: ARCHITECTURE A21 (кто регистрирует и ключ), §17 (закрыть F2-Q9); SECURITY §9 — ссылка «Кто регистрирует лимит по User — ADR-0006» вместо F2-Q9.
