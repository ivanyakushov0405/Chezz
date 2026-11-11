# E22: WebSocket-шлюз (модуль `realtime`)

Slug: `e22-realtime` · ROADMAP: E22 · Трекер: KAN-9 · Риск: high (Session на открытых соединениях, горячий путь хода — профиль «Режим работы», ROADMAP)

## Цель
Шлюз `/ws` сервера, через который E06 пустит ходы и часы: подключение с проверкой Origin, версии и Session, конверт и маршрутизация сообщений к обработчикам модулей (ADR-0005 п.8), ping/pong и RTT для компенсации (A11), лимиты (A21, SECURITY §9), закрытие по Session (S6), онлайн для `/metrics`. Для игрока пока ничего не видно: интерфейса и команд партии нет. Ссылки: ТЗ §5 «Задержка хода», «Безопасность», «Нагрузка»; ARCHITECTURE §7.1, §9.1 п.9; API §8, §10, §13; SECURITY §5, §6, §9.

## Входит / не входит
- Входит: `@fastify/websocket`; маршрут `/ws`; сообщения `welcome`, `ping`, `pong`, `error`, `session.closed` в `packages/protocol`; `realtime.registerHandlers`, права соединения гостя и П1 (API §8.1); token bucket, лимит соединений; RTT; перепроверка Session раз в 60 с, `sessions_closed`, закрытие в момент `expires_at`; коды закрытия API §10, которые шлюз ставит сам; метрика `chezz_players_online`; тестовый клиент `ws(cookie)` (TESTING §7.3).
- Не входит: подписки `lobby.*`, `game.*` и события партии (E06, E09); `seek.state` в `welcome` (E10); клиент в `apps/web`: подключение, ответ на `ping`, переподключение (E06); показ онлайн-статуса — потребителя пока нет, есть только счётчик для метрики.

## Критерии готовности
- К-1: upgrade с чужим `Origin` или без него → 403 `origin_forbidden`, соединения нет; проверка Origin идёт до Session. Upgrade считается в общий лимит REST: 301-й за минуту с IP гостя → 429 `rate_limited`.
- К-2: `protocol_version` не совпал или его нет → `error client_outdated` и закрытие 4002.
- К-3: иначе `welcome`: `protocol_version`, `user` (`{id, nickname}` у Session, `null` у гостя), `ping_interval_ms: 5000`.
- К-4: 6-е открытое соединение User (51-е без Session с одного IP) → `error too_many_connections` и закрытие 4003; прежние соединения работают.
- К-5: невалидный JSON, незнакомый `type`, лишнее поле → `error validation_failed` с `ref` команды (если `ref` есть), соединение живёт. Сообщение больше 4 КБ → закрытие.
- К-6: соединение гостя и П1 пропускает к обработчику только `pong`, `lobby.*`, `game.subscribe`, `game.unsubscribe`; остальное → `unauthenticated` или `onboarding_required`, обработчик не вызывается. Два обработчика одного `type` → ошибка при старте.
- К-7: token bucket на соединение, 10/с, запас 20: 21-е сообщение пачки → `error rate_limited`; корзина пуста дольше 10 с → закрытие 1008; другие соединения не задеты.
- К-8: раз в 5 с `ping` с растущим `n`; `pong` даёт RTT по монотонным часам сервера, медиана 5 последних → `ctx.rtt_ms`; `pong` с чужим `n` игнорируется; 3 `ping` без `pong` → сервер закрывает соединение.
- К-9: Session: `sessions_closed` → `session.closed`, затем закрытие 4001. Перепроверка раз в 60 с — один запрос на все соединения: закрываются соединения удалённых и истёкших Session. Закрытие в момент `expires_at`.
- К-10: `chezz_players_online` — число разных User с открытым соединением (П1 входит, гость — нет); падает при закрытии. Остановка `app` → 1012 всем; буфер отправки больше 1 МБ → 1011.

## Шаги
1. Протокол (слепые тесты: `tester`, режим 1, opus): схемы `Pong` (клиент), `Welcome`, `Ping`, `WsError`, `SessionClosed` (сервер), `ClientMessage`/`ServerMessage` как `discriminatedUnion`. Файлы: тест в `packages/protocol/src/ws/`, затем `ws/client.ts`, `ws/server.ts`, `index.ts`, `snapshot/protocol.json`. К-3, К-5.
2. Платформа: `@fastify/websocket` в `apps/server/package.json` и lock; в `platform/metrics.ts` — регистрация gauge модуля (`addGauge`) и тест; метрики создаются в `app.ts` раньше модулей. К-10.
3. `realtime/domain/`: `bucket.ts` (token bucket и «пуста дольше 10 с»), `ping.ts` (ping/pong, медиана 5 RTT; компенсация — не здесь), unit-тесты. К-7, К-8.
4–5 (один коммит: `service.ts` реализует оба). Подключение: `realtime/service.ts` (реестр соединений, лимиты соединений, онлайн, gauge), `realtime/api.ts` (`/ws`: Origin → лимит REST → версия → `welcome`), `app.ts` (L6), `test/support/ws.ts`, int `src/realtime/connect.int.test.ts` (`test/contract/` — зона tester). К-1…К-4, К-10.
5. Сообщения и жизнь соединения: разбор и права, `registerHandlers`, token bucket, ping/pong/RTT, мёртвое соединение, `sessions_closed`, перепроверка и `expires_at` (`auth.service.sessionExpiries(ids)` + `auth/repo.ts`), 1012 и 1011; int `messages.int.test.ts`, `session.int.test.ts`; unit `service.test.ts`, `domain/rights.test.ts`. К-5…К-10.

## Решения
- Порядок upgrade (уточнено в шаге 4): Origin проверяет `platform/http.ts` — с чужим Origin у upgrade `/ws` Session не читается (хук «Кто» ставит гостя), отказ 403 — в `preValidation` (после `onRequest` `@fastify/websocket`, иначе сокет отказа не закрывается); затем лимит REST (`preHandler`); затем версия, лимит соединений и `welcome` (service). Хук маршрута отвергнут: он идёт после общего «Кто», то есть после чтения Session.
- `expires_at`: на перепроверке `auth.sessionExpiries(ids)` возвращает `id → expires_at` живых; Session, которые истекают до следующей перепроверки, получают таймер. На подключение — тот же запрос по одному id. Таймер на 30 дней отвергнут: `setTimeout` больше 24,8 суток срабатывает сразу.
- Мёртвое соединение (3 `ping` без `pong`) — `terminate()` без кода: клиента нет, кода он не увидит.
- «Корзина пуста дольше 10 с» (SECURITY §9): отсчёт — от первого отказа; сбрасывается, только когда сообщение принято с запасом (в корзине до него ≥ 2 токенов). Иначе бот на 50/с из примера §9 получал бы токен раз в 100 мс и не закрывался никогда. Цена: клиента, который после отказа держит ровно ~10/с, закроют через 10 с — это и есть потолок. Токен берётся в момент прихода, до очереди соединения (ревью).
- Остановка: 1012 всем, через `SHUTDOWN_GRACE_MS` = 1 с — `terminate()` неответивших; иначе полуоткрытый TCP держал бы `onClose` до 30 с (ревью, блокер).
- Origin проверяется у любого WebSocket-upgrade, не только `/ws` (плагин принимает рукопожатие и на других GET) (ревью).
- Отвергнуто: `isOnline(user_id)` в сервисе — по 7.1 от `realtime` никто не зависит, потребителя нет.

## Правки документов основ
Нет. Вне основ: `docs/ROADMAP.md` — «Открытые вопросы» п.11 → «Закрыт: E22 выделен (решение Ivan 2026-11-11)»; статус E22 — «в работе».

## Вопросы к Ivan
Нет.
