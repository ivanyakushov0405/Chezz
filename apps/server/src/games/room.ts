// GameRoom (ARCHITECTURE §9, A9): состояние активной партии, очередь команд (строго по одной, включая запись в БД),
// подписчики (игроки и зрители), таймер флага. Время — только TimeSource (A27); I/O — через deps от service.
import { ChessPosition, type Color, type Outcome } from "@chezz/chess";
import type { Clock, ErrorCode, Game, GameEnded, GameMoved, GameState, PlayerRef, ServerMessage } from "@chezz/protocol";
import type { TimerId, TimeSource } from "../platform/time.ts";
import type { WsContext } from "../platform/ws.ts";
import { chargeMove, clockFromMoves, remainingAt, stopClock, type ClockState } from "./domain/clock.ts";
import type { GameRow } from "./repo.ts";
import type { MoveRecord } from "./tables.ts";

export interface RatingChangesView {
  white: { rating_before: number; rating_after: number };
  black: { rating_before: number; rating_after: number };
}

export interface EndedInfo {
  outcome: Outcome;
  ratings: RatingChangesView | null;
  ended_at: Date;
}

export interface GameRoomDeps {
  time: TimeSource;
  /** Неожиданная ошибка команды (лог + Sentry); комната продолжает работу. */
  report(err: unknown, what: string): void;
  /** Записать ход (ARCHITECTURE §9.2 п.4); false — строка не обновлена (не `active` или чужая длина). */
  appendMove(gameId: string, plyBefore: number, move: MoveRecord): Promise<boolean>;
  /** Транзакция конца (§9.1 п.7): итог, pgn, ходы и для рейтинговой `finished` — applyResult. null — уже закончена. */
  finish(row: GameRow, outcome: Outcome, moves: readonly MoveRecord[], endedAt: Date): Promise<RatingChangesView | null | "already_ended">;
  /** После конца и рассылки: снять комнату, события, аналитика. */
  ended(row: GameRow, info: EndedInfo): void;
  /** Задержка доставки хода, с (OPERATIONS §12.2). */
  observeDelivery(seconds: number): void;
}

interface Subscriber {
  ctx: WsContext;
  color: Color | null;
}

/** Повтор флага после сбоя записи конца партии, мс: не чаще, чтобы не долбить упавшую БД. */
export const FLAG_RETRY_MS = 1_000;

export interface GameRoom {
  readonly id: string;
  subscribe(ctx: WsContext): Promise<void>;
  unsubscribe(connectionId: string): void;
  move(ctx: WsContext, ref: string | null, ply: number, uci: string, receivedAt: number): Promise<void>;
  /** Дождаться, пока очередь команд опустеет (тесты: ManualTimeSource.advance). */
  idle(): Promise<void>;
  /** Остановить таймеры (остановка app); партия в БД остаётся `active`. */
  dispose(): void;
}

const colorOfCaller = (row: GameRow, ctx: WsContext): Color | null => {
  if (ctx.caller.who === "guest") return null;
  if (ctx.caller.user_id === row.white_id) return "white";
  if (ctx.caller.user_id === row.black_id) return "black";
  return null;
};

export function createGameRoom(row: GameRow, players: { white: PlayerRef; black: PlayerRef }, deps: GameRoomDeps): GameRoom {
  const { time } = deps;
  const moves: MoveRecord[] = [...row.moves];
  let position = ChessPosition.fromSans(moves.map((m) => m.san));
  let clock: ClockState = clockFromMoves(row.time_base, moves.map((m) => m.clock_ms), time.now());
  let ended: EndedInfo | null = null;
  let flagTimer: TimerId | null = null;
  let disposed = false;
  const subscribers = new Map<string, Subscriber>();
  let queue: Promise<void> = Promise.resolve();

  /** Команды комнаты — строго по одной (A9). Ошибка команды не рвёт очередь. */
  const enqueue = (task: () => Promise<void>): Promise<void> => {
    const run = queue.then(task);
    queue = run.catch((err: unknown) => deps.report(err, "game room command failed"));
    return run;
  };

  const clockView = (now: number): Clock => ({
    white_ms: Math.round(remainingAt(clock, "white", now)),
    black_ms: Math.round(remainingAt(clock, "black", now)),
    running: clock.running,
  });

  const gameView = (): Game => ({
    id: row.id,
    white: players.white,
    black: players.black,
    category: row.category,
    time_base: row.time_base,
    time_increment: row.time_increment,
    rated: row.rated,
    // Комната заканчивает партию только как finished; aborted — E07.
    status: ended === null ? "active" : "finished",
    result: ended?.outcome.result ?? null,
    termination: ended?.outcome.termination ?? null,
    started_at: row.started_at.toISOString(),
    ended_at: ended?.ended_at.toISOString() ?? null,
    moves: moves.map((m) => ({ san: m.san, clock_ms: m.clock_ms })),
    ratings: ended?.ratings ?? null,
  });

  const connected = (): { white: boolean; black: boolean } => {
    const out = { white: false, black: false };
    for (const s of subscribers.values()) if (s.color !== null) out[s.color] = true;
    return out;
  };

  const stateFor = (sub: Subscriber): GameState => ({
    type: "game.state",
    game_id: row.id,
    game: gameView(),
    clock: clockView(time.now()),
    your_color: sub.color,
    // Предложения, первый ход, разрыв и окно выбора — E07.
    draw_offer: null,
    takeback_offer: null,
    connected: connected(),
    first_move_ms: null,
    reconnect: null,
    abandonment_choice: null,
  });

  const broadcast = (message: ServerMessage): void => {
    for (const s of subscribers.values()) s.ctx.send(message);
  };

  const refuse = (ctx: WsContext, ref: string | null, code: ErrorCode, sub: Subscriber): void => {
    ctx.send({ type: "error", ref, code, game_id: row.id, details: null } satisfies ServerMessage);
    ctx.send(stateFor(sub));
  };

  const clearFlagTimer = (): void => {
    if (flagTimer !== null) time.clearTimer(flagTimer);
    flagTimer = null;
  };

  /** Конец партии: транзакция, затем рассылка `game.ended`, затем deps.ended (§9.1 п.7). */
  const end = async (outcome: Outcome): Promise<void> => {
    clearFlagTimer();
    const clockBefore = clock;
    clock = stopClock(clock, time.now());
    const endedAt = time.wallNow();
    let ratings: RatingChangesView | null | "already_ended";
    try {
      ratings = await deps.finish(row, outcome, moves, endedAt);
    } catch (err) {
      // Конец не записан: часы снова идут (остаток ≤ 0 — следующий ход тоже флаг, SECURITY §8),
      // флаг повторяется через FLAG_RETRY_MS. Иначе ход после флага прошёл бы без списания.
      clock = clockBefore;
      scheduleFlag(FLAG_RETRY_MS);
      throw err;
    }
    if (ratings === "already_ended") throw new Error(`game ${row.id}: finish found the game already ended`);
    ended = { outcome, ratings, ended_at: endedAt };
    const message: GameEnded = {
      type: "game.ended",
      game_id: row.id,
      status: "finished",
      result: outcome.result,
      termination: outcome.termination,
      ratings,
    };
    broadcast(message);
    deps.ended(row, ended);
  };

  /** Таймер флага на остаток стороны, чьи часы идут (§9.1 п.6, п.8). */
  const scheduleFlag = (minDelayMs = 0): void => {
    clearFlagTimer();
    if (ended !== null || disposed || clock.running === null) return;
    const side = clock.running;
    const left = remainingAt(clock, side, time.now());
    flagTimer = time.setTimer(Math.max(minDelayMs, Math.ceil(left)), () => {
      flagTimer = null;
      void enqueue(async () => {
        if (ended !== null || disposed || clock.running !== side) return;
        if (remainingAt(clock, side, time.now()) > 0) {
          scheduleFlag();
          return;
        }
        await end(position.flagOutcome(side));
      });
    });
  };

  scheduleFlag();

  return {
    id: row.id,

    subscribe(ctx) {
      return enqueue(async () => {
        const sub: Subscriber = { ctx, color: colorOfCaller(row, ctx) };
        subscribers.set(ctx.connection_id, sub);
        ctx.send(stateFor(sub));
      });
    },

    unsubscribe(connectionId) {
      subscribers.delete(connectionId);
    },

    move(ctx, ref, ply, uci, receivedAt) {
      return enqueue(async () => {
        const color = colorOfCaller(row, ctx);
        const sub: Subscriber = subscribers.get(ctx.connection_id) ?? { ctx, color };
        // Порядок проверок API §5.2: участник → game_not_active → ply → очередь → допустимость.
        if (color === null) {
          ctx.send({ type: "error", ref, code: "not_a_participant", game_id: row.id, details: null } satisfies ServerMessage);
          return;
        }
        if (ended !== null) return refuse(ctx, ref, "game_not_active", sub);
        if (ply !== moves.length) return refuse(ctx, ref, "ply_mismatch", sub);
        if (position.turn() !== color) return refuse(ctx, ref, "not_your_turn", sub);

        // Время хода — момент прихода команды, а не её очереди: ожидание записи предыдущей команды
        // или загрузки комнаты — время сервера, не игрока (E-2). Флаг, сработавший раньше прихода, уже в очереди.
        const charged = chargeMove(clock, color, moves.length + 1, receivedAt, ctx.rtt_ms, row.time_increment);
        if (charged.flagged) {
          // Ход пришёл после конца времени (SECURITY §8): флаг, ход не применяется. Часы останавливает end():
          // при сбое записи конца они должны остаться идущими (остаток 0), чтобы повтор флага и следующий ход тоже флагнули.
          await end(position.flagOutcome(color));
          refuse(ctx, ref, "game_not_active", sub);
          return;
        }
        const played = position.play(uci);
        if (played === null) return refuse(ctx, ref, "illegal_move", sub);

        const move: MoveRecord = { san: played.san, clock_ms: charged.clock_ms };
        const outcome = position.outcome();
        const clockBefore = clock;
        moves.push(move);
        clock = charged.state;
        /** Запись не удалась — комната возвращается к позиции до хода (в БД его нет). */
        const rollback = (): void => {
          moves.pop();
          position = ChessPosition.fromSans(moves.map((m) => m.san));
          clock = clockBefore;
        };
        if (outcome === null) {
          let saved: boolean;
          try {
            saved = await deps.appendMove(row.id, moves.length - 1, move);
          } catch (err) {
            rollback();
            throw err;
          }
          if (!saved) {
            rollback();
            throw new Error(`game ${row.id}: move ${moves.length + 1} not saved`);
          }
        }
        const moved: GameMoved = {
          type: "game.moved",
          game_id: row.id,
          ply: moves.length,
          san: move.san,
          clock: outcome === null ? clockView(time.now()) : { ...clockView(time.now()), running: null },
          draw_offer: null,
          takeback_offer: null,
        };
        if (outcome === null) {
          broadcast(moved);
          deps.observeDelivery((time.now() - receivedAt) / 1000);
          scheduleFlag();
          return;
        }
        // Последний ход и итог — одной транзакцией (§9.2 п.4), рассылка — после коммита.
        clock = stopClock(clock, time.now());
        const endedAt = time.wallNow();
        let ratings: RatingChangesView | null | "already_ended";
        try {
          ratings = await deps.finish(row, outcome, moves, endedAt);
        } catch (err) {
          rollback();
          scheduleFlag();
          throw err;
        }
        if (ratings === "already_ended") throw new Error(`game ${row.id}: finish found the game already ended`);
        clearFlagTimer();
        ended = { outcome, ratings, ended_at: endedAt };
        broadcast(moved);
        deps.observeDelivery((time.now() - receivedAt) / 1000);
        broadcast({
          type: "game.ended",
          game_id: row.id,
          status: "finished",
          result: outcome.result,
          termination: outcome.termination,
          ratings,
        } satisfies GameEnded);
        deps.ended(row, ended);
      });
    },

    async idle() {
      for (;;) {
        const tail = queue;
        await tail;
        if (tail === queue) return;
      }
    },

    dispose() {
      disposed = true;
      clearFlagTimer();
      subscribers.clear();
    },
  };
}
