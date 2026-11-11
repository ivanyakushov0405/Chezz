# E06: Партия — ход, часы, окончания, зрители

Slug: `e06-game` · ROADMAP: E06 · Трекер: KAN-10 · Риск: high (ход и часы партии, Glicko-2 в конце партии — профиль «Режим работы»)

## Цель
Двое играют партию на `/game/:id` до естественного конца: ход на доске, правила и часы на сервере с компенсацией задержки, SAN, автоокончания и флаг, рейтинг после рейтинговой партии; зрители смотрят по ссылке. Партию пока создают фабрики и `games.service.createGame` (вызов — E08, подбор — E10). Ссылки: ТЗ §4.6, §7 «правила», «часы ≤ 0,5 с»; ARCHITECTURE §9.1–9.2, §9.4, §10; API §4.2–4.3, §8.3, §9; SECURITY §7, §8; DESIGN §6, §9.3, §10.2–10.3. Макет: Figma `game-live / 360 / light / default` (node 9:209), `/ 768 /` (9:391), `/ 1280 /` (9:581), `ended` 360 (9:1150) и 1280 (9:1333).

## Входит / не входит
- Входит: обёртка `packages/chess` и `fixtures/chess/` (9 тем TESTING §7.4); схемы партии в `packages/protocol`; модуль `games` — таблица `games`, `createGame` с `lockForGame` (A25, A28), `GameRoom` с очередью и `TimeSource`, часы и компенсация (A11), флаг, автоокончания, транзакция конца с `rating.applyResult`, события `game_started`/`game_ended`, аналитика `game_started`/`game_finished`; WS `game.subscribe`, `game.unsubscribe`, `game.move` → `game.state`, `game.moved`, `game.ended`; метрики `chezz_games_active`, `chezz_move_delivery_seconds`; `Me.active_game_id`; клиент WebSocket в `apps/web` (подключение, ответ на `ping`, переподключение API §10, `ConnectionBanner`); экран `game-live` / `game-spectator` / `ended`: `Board` (chessground, `cburnett`), `Clock`, `PlayerLine`, `MoveList` с навигацией, `MoveInput`, `PromotionPicker`, `GameResultPanel`; e2e.
- Не входит: сдаться, ничья, возврат хода, отмена, 30 с первого хода, разрыв 60 с и окно выбора, восстановление после перезапуска с таймерами (9.3), звуки — **E07** (поля `draw_offer`, `takeback_offer`, `first_move_ms`, `reconnect`, `abandonment_choice` в `game.state` есть, но всегда `null`; `connected` — по подпискам игроков; `GameControls` в E06 пуст и скрыт); `game.started` и создание партии из вызова/подбора — E08, E10; `getGame`/`getGamePgn` REST и `game-review` — E12, E13; набор `merida` и превью — E16 (до него `merida` → `cburnett`); ссылка «Вернуться в партию» в лобби — E07.

## Критерии готовности
- К-1: фикстуры `fixtures/chess/` всех 9 тем проходят через публичный API `packages/chess`: SAN каждого хода, полный список допустимых UCI, отказ недопустимых, окончание и исход флага (ТЗ §7).
- К-2: `createGame` — одна транзакция с `lockForGame`; удалённый игрок → `GameCreateRefused{deleted}`, у игрока `active` Game → `{busy}` (порядок и `user_ids` — ARCHITECTURE §9.1 п.1); две параллельные `createGame` одного игрока → одна партия. После коммита — комната, `game_started` (событие и аналитика по строке на игрока).
- К-3: `game.subscribe` (гость, П1, Игрок) → `game.state`: `your_color` у участника, `null` у зрителя; новый `subscribe` заменяет прежний, `unsubscribe` и закрытие соединения снимают подписку. Нет партии → `not_found`. Законченная партия → `game.state` из БД, `clock.running = null`.
- К-4: `game.move`, порядок проверок API §5.2: не участник → `not_a_participant`; партия не `active` → `game_not_active` + `game.state`; `ply` ≠ длине `moves` → `ply_mismatch` + `game.state`; не его очередь → `not_your_turn` + `game.state`; недопустимый UCI → `illegal_move` + `game.state`. Иначе всем подписчикам `game.moved` (`ply`, `san`, `clock`) после коммита; повтор того же сообщения второго хода не делает.
- К-5: часы (ARCHITECTURE §9.2): затрачено = сейчас − начало хода − `min(RTT/2, 1 с)`, монотонное время; затем добавка; `Move.clock_ms` — остаток после добавки. Пример 3+2: 2:41,300, думали 4,2 с, RTT 160 мс → 2:39,180. RTT 3 с → компенсация ровно 1 с. Первый ход каждой стороны часы не списывают (вопрос 1).
- К-6: флаг фиксирует сервер без хода клиента (таймер комнаты на остаток стороны): `game.ended` `timeout`, у соперника не хватает материала для мата → `draw` + `timeout_insufficient_material`. Ход, пришедший при остатке ≤ 0, не применяется — флаг.
- К-7: мат, пат, троекратное повторение, 50 ходов, недостаток материала завершают партию автоматически. Конец — одна транзакция: `status`, `result`, `termination`, `pgn` (без ников, S13), `ended_at` и для рейтинговой `finished` — `applyResult`; `game.ended.ratings` = результат `applyResult`, у товарищеской — `null`. Затем событие `game_ended`, `game_finished` по строке на игрока (`termination`, `after_restart: false`), комната удаляется.
- К-8: `chezz_games_active` = число `active` Game; `chezz_move_delivery_seconds` — от приёма `game.move` до отправки `game.moved` (summary 0.5/0.95/0.99, окно 5 мин). `/api/me.active_game_id` — id `active` Game игрока или `null`.
- К-9: экран `/game/:id`: ход перетаскиванием и кликом с подсветкой последнего хода, шаха, допустимых ходов; превращение — `PromotionPicker`, при `auto_queen` сразу ферзь; `MoveInput` (SAN или UCI, U19, U30); часы — по API §9.4 и `low-time` по порогу U11; `MoveList` с ←/→ и «К текущему»; зритель — метка «Вы зритель», без ввода хода, переворот доски; конец — `GameResultPanel` (результат, окончание, изменение рейтинга, «Новая игра» → `/`). Отказ со снимком — фигура возвращается, `Toast` `error.<code>`. Разрыв `ply` — `game.subscribe`.
- К-10: клиент WebSocket: ответ на `ping` в обработчике; переподключение по API §10 (паузы P22, коды 1008/1011/1012/4001/4002/4003) с состояниями DESIGN §10.2 и `reconnecting` на доске; после подключения повтор подписки; неподтверждённый ход не повторяется.
- К-11 (e2e): два игрока в двух браузерах доводят партию до мата — у обоих `GameResultPanel`; зритель видит те же ходы; показ часов ≤ 0,5 с от `clock` следующего `game.moved` (ТЗ §7).
- E-1: ход превращения без буквы (`e7e8`) → `illegal_move`; `e7e8q` — допустим.
- E-2: команда партии в момент срабатывания флага — по очереди комнаты: «ход» и «флаг» не применяются одновременно (A9).

## Шаги
По порядку; каждый — коммит и зелёный `check`.
1. Фикстуры (слепые: `tester`, режим 1, opus): `fixtures/chess/{castling,en-passant,promotion,checkmate,stalemate,threefold,fifty-moves,insufficient-material,flag}.json`, `packages/chess/test/fixtures.test.ts` по интерфейсу ниже. К-1, E-1.
2. `packages/chess/src/` — обёртка chess.js по интерфейсу; unit «может ли сторона поставить мат». К-1.
3. Протокол (слепые: `tester`, режим 1, opus): `PlayerRef`, `Move`, `GameSummary`, `RatingChange`, `Game`, `Clock`, `Offer`, `Reconnect`, `AbandonmentChoice`, `Connected`; клиент `game.subscribe`, `game.unsubscribe`, `game.move`; сервер `game.state`, `game.moved`, `game.ended`; снимок, `PENDING_CATALOG`. Затем схемы. К-3, К-4.
4. `games` данные: миграция `0005_games`, `tables.ts`, `repo.ts`, `users.lockForGame`, `games.service.createGame` + `GameCreateRefused`, `events.ts`; фабрики `createActiveGame`, `createFinishedGame`; int `games.int.test.ts`. К-2.
5. `games` комната: `domain/clock.ts` (списание, компенсация, добавка, остаток до флага), `domain/outcome.ts`, `room.ts` (`GameRoom`: очередь, подписчики, ход, таймер флага, конец), реестр в `service.ts`; unit. К-4…К-7, E-2.
6. Подключение: `games/api.ts` (`gamesWsHandlers`), `platform/ws.ts` (`WsContext.onClose`), `realtime` (вызов `onClose`), `platform/metrics.ts` (`addSummary`), `app.ts` (L3 `games`, обработчики, `meExtras` для `getMe`); int `src/games/*.int.test.ts` через `startApp` и `ws()`. К-3…К-8.
7. Клиент: `chessground` в `apps/web`, `public/pieces/cburnett/` + `LICENSE.md`; `shared/api/ws.ts` (клиент, переподключение), `ConnectionBanner`; unit. К-10.
8. Экран: `pages/game/GamePage.tsx`, `features/games/` (`Board`, `Clock` + `clock.ts`, `PlayerLine`, `MoveList`, `MoveInput`, `PromotionPicker`, `GameResultPanel`), маршрут, ключи `packages/i18n`; unit. К-9.
9. e2e: `tests/e2e/game.spec.ts`, `clock.spec.ts` (`@local-db`, фабрики), кадры `game-live` default/ended в `screens.spec.ts`. К-11.

Интерфейс `packages/chess` (для шагов 1–2):
```ts
export type Color = "white" | "black";
export type Termination = "checkmate" | "stalemate" | "threefold_repetition" | "fifty_moves" | "insufficient_material";
export interface Outcome { result: "white_wins" | "black_wins" | "draw"; termination: Termination | "timeout" | "timeout_insufficient_material" }
export class ChessPosition {
  static start(fen?: string | null): ChessPosition;      // null — стандартная
  static fromSans(sans: readonly string[]): ChessPosition; // восстановление комнаты из moves[]
  play(uci: string): { san: string } | null;              // null — недопустим, позиция не меняется
  legalUci(): string[];                                   // отсортированный
  turn(): Color; ply(): number; fen(): string; inCheck(): boolean;
  outcome(): Outcome | null;                              // автоокончание или null
  canMate(color: Color): boolean;                          // хватает ли материала для мата
  flagOutcome(flagged: Color): Outcome;                   // timeout или timeout_insufficient_material
}
```

## Решения
- Комната поднимается лениво: `game.subscribe`/`game.move` по `active` Game без комнаты в памяти создают её из `moves[]` (остатки — 9.3, сторона на ходу — время на начало хода, A10); одновременные загрузки одной партии — один промис. Нужно фабрикам e2e (процесс `app` отдельный) и даёт частичное восстановление до E07; полное 9.3 при `start()` с таймерами переподключения — E07. Альтернатива — партии в сиде: одна на прогон теста, ломается при повторе.
- Подписчики комнаты — `WsContext` соединений; `realtime` зовёт `ctx.onClose`, комната снимает подписку. `connected` в `game.state` — есть ли у игрока подписанное соединение (без таймеров и `game.presence` — E07).
- `Me.active_game_id`: `users` не зависит от `games` (7.1) — `app.ts` передаёт в `registerUsersRoutes` функцию `meExtras(userId)` поверх `games.service`.
- Тесты сервера — int рядом с кодом (`src/games/*.int.test.ts`); `test/contract/` — зона tester (как в E22).
- `merida` до E16 → `cburnett` (правило DESIGN §6 «неизвестное → по умолчанию» распространяется на неподключённый набор); фигуры `cburnett` — из ассетов chessground (GPL-совместимые, U33).

## Правки документов основ
Нет. Вне основ: `docs/ROADMAP.md` — статус E06 «в работе».

## Вопросы к Ivan
Нет. Закрыт: часы до первых ходов — как на Lichess (Ivan, 2026-11-11): `running: null` до первого хода каждой стороны; первый ход стороны время не списывает, добавка начисляется (`clock_ms = time_base + increment`) — так сходится формула времени на ход ARCHITECTURE §9.2; после 2-го полухода идут часы белых. Задержку первого хода ограничит таймер 30 с (E07). Отвергнуто: часы белых с создания партии.
