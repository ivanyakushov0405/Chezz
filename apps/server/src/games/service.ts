// games: Game, Move, часы, GameRoom, зрители, «1 активная партия» (ARCHITECTURE §7.1, §9; A9, A25, A28).
// Реестр комнат — в замыкании фабрики (ADR-0005 п.2). Комната поднимается при старте (все active Game) и
// лениво — по первой команде к active Game без комнаты (бриф E06, «Решения»); полное 9.3 с таймерами — E07.
import type { Outcome } from "@chezz/chess";
import type { Category, ErrorCode, Game, GameState, PlayerRef, ServerMessage } from "@chezz/protocol";
import type { FastifyBaseLogger } from "fastify";
import type { AnalyticsService } from "../analytics/service.ts";
import type { Database } from "../database.ts";
import { withTransaction, type Db, type Trx } from "../platform/db.ts";
import type { MetricsService } from "../platform/metrics.ts";
import type { ErrorReporter } from "../platform/sentry.ts";
import type { TimeSource } from "../platform/time.ts";
import type { WsContext } from "../platform/ws.ts";
import type { RatingService } from "../rating/service.ts";
import type { UsersService } from "../users/service.ts";
import { categoryOf } from "./domain/category.ts";
import { buildPgn } from "./domain/pgn.ts";
import { createGamesEvents, type GamesEvents } from "./events.ts";
import {
  activeGameIdOf,
  appendMove,
  findActiveGames,
  findGame,
  finishGame,
  insertGame,
  playersWithActiveGame,
  type GameRow,
} from "./repo.ts";
import { createGameRoom, type EndedInfo, type GameRoom, type RatingChangesView } from "./room.ts";

export { categoryOf } from "./domain/category.ts";

/** Отказ createGame (ARCHITECTURE §9.1 п.1, A28): не AppError — код клиенту выбирает вызывающий модуль. */
export class GameCreateRefused extends Error {
  readonly reason: "busy" | "deleted";
  readonly user_ids: string[];

  constructor(reason: "busy" | "deleted", userIds: string[]) {
    super(`game create refused: ${reason}`);
    this.name = "GameCreateRefused";
    this.reason = reason;
    this.user_ids = userIds;
  }
}

export interface CreateGameInput {
  white_id: string;
  black_id: string;
  /** Секунды. */
  time_base: number;
  /** Секунды. */
  time_increment: number;
  rated: boolean;
}

export interface CreatedGame {
  game_id: string;
  /**
   * Вызвать после коммита транзакции вызывающего (§9.1 п.1): комната, событие `game_started`,
   * аналитика. До коммита партии для других транзакций ещё нет.
   */
  started(): void;
}

export interface GamesService {
  readonly events: GamesEvents;
  /** Первое действие — `users.lockForGame` (ADR-0008); отказ — GameCreateRefused. */
  createGame(trx: Trx, input: CreateGameInput): Promise<CreatedGame>;
  /** id `active` Game игрока или null (`Me.active_game_id`). */
  activeGameId(userId: string): Promise<string | null>;
  /** `game.subscribe` (API §8.3): снимок сразу; одна партия на соединение. */
  subscribe(ctx: WsContext, ref: string | null, gameId: string): Promise<void>;
  unsubscribe(ctx: WsContext, gameId: string): void;
  /** `game.move` (API §9.1–9.2); `receivedAt` — монотонное время приёма (метрика доставки). */
  move(ctx: WsContext, ref: string | null, gameId: string, ply: number, uci: string, receivedAt: number): Promise<void>;
  /** Поднять комнаты всех `active` Game (часть 9.3 без таймеров переподключения). */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Все очереди комнат и загрузки пусты (тесты, TESTING §7.2). */
  idle(): Promise<void>;
}

export interface GamesServiceDeps {
  db: Db<Database>;
  time: TimeSource;
  log: FastifyBaseLogger;
  reporter?: ErrorReporter;
  metrics: MetricsService;
  analytics: AnalyticsService;
  users: UsersService;
  rating: RatingService;
}

export function createGamesService(deps: GamesServiceDeps): GamesService {
  const { db, time, log, users, rating, analytics } = deps;
  const report = (err: unknown, what: string): void => {
    log.error({ err }, what);
    deps.reporter?.captureException(err);
  };
  const events = createGamesEvents((err) => report(err, "games event subscriber failed"));
  const rooms = new Map<string, GameRoom>();
  /** Загрузка комнаты одной партии — один промис на всех ждущих. */
  const loading = new Map<string, Promise<GameRoom | null>>();
  /** Подписка соединения: connection_id → game_id (одна партия на соединение, API §8.3). */
  const subscriptions = new Map<string, string>();
  /** Соединения, на закрытие которых уже подписаны. */
  const watched = new Set<string>();
  let stopped = false;

  deps.metrics.addGauge({ name: "chezz_games_active", help: "Game в статусе active", collect: () => rooms.size });
  const delivery = deps.metrics.addSummary({
    name: "chezz_move_delivery_seconds",
    help: "От приёма game.move до отправки game.moved (после коммита)",
    percentiles: [0.5, 0.95, 0.99],
    max_age_seconds: 300,
  });

  const playerRef = async (userId: string, category: Category, withRating: boolean): Promise<PlayerRef> => {
    const user = await users.getUser(userId);
    const nickname = user === null || user.deleted_at !== null ? null : user.nickname;
    if (!withRating) return { id: userId, nickname, rating: null, provisional: false };
    const shown = rating.display(await rating.getRating(userId, category));
    return { id: userId, nickname, rating: shown.rating, provisional: shown.provisional };
  };

  const finish = async (row: GameRow, outcome: Outcome, moves: readonly { san: string; clock_ms: number }[], endedAt: Date) =>
    withTransaction(db, async (trx): Promise<RatingChangesView | null | "already_ended"> => {
      const pgn = buildPgn({
        started_at: row.started_at,
        time_base: row.time_base,
        time_increment: row.time_increment,
        result: outcome.result,
        termination: outcome.termination,
        sans: moves.map((m) => m.san),
      });
      const updated = await finishGame(trx, row.id, {
        status: "finished",
        result: outcome.result,
        termination: outcome.termination,
        pgn,
        ended_at: endedAt,
        moves,
      });
      if (!updated) return "already_ended";
      if (!row.rated) return null;
      return rating.applyResult(trx, {
        gameId: row.id,
        category: row.category,
        whiteId: row.white_id,
        blackId: row.black_id,
        result: outcome.result,
        endedAt,
      });
    });

  const onEnded = (row: GameRow, info: EndedInfo): void => {
    rooms.get(row.id)?.dispose();
    rooms.delete(row.id);
    for (const [conn, gameId] of subscriptions) if (gameId === row.id) subscriptions.delete(conn);
    events.emitGameEnded({ game_id: row.id, white_id: row.white_id, black_id: row.black_id });
    for (const user_id of [row.white_id, row.black_id]) {
      analytics.record({
        name: "game_finished",
        user_id,
        game_id: row.id,
        props: { termination: info.outcome.termination, after_restart: false },
      });
    }
  };

  const openRoom = async (row: GameRow): Promise<GameRoom> => {
    const [white, black] = await Promise.all([
      playerRef(row.white_id, row.category, true),
      playerRef(row.black_id, row.category, true),
    ]);
    const existing = rooms.get(row.id);
    if (existing) return existing;
    const room = createGameRoom(row, { white, black }, {
      time,
      report,
      appendMove: (gameId, plyBefore, move) => appendMove(db, gameId, plyBefore, move),
      finish,
      ended: onEnded,
      observeDelivery: (s) => delivery.observe(s),
    });
    rooms.set(row.id, room);
    return room;
  };

  /** Комната active Game: из памяти или из БД (один промис на партию). null — партии нет или она не active. */
  const roomOf = async (gameId: string): Promise<GameRoom | null> => {
    const ready = rooms.get(gameId);
    if (ready) return ready;
    const pending = loading.get(gameId);
    if (pending) return pending;
    const load = (async () => {
      const row = await findGame(db, gameId);
      if (row === null || row.status !== "active" || stopped) return null;
      return openRoom(row);
    })().finally(() => loading.delete(gameId));
    loading.set(gameId, load);
    return load;
  };

  /** Снимок законченной партии из БД (API §9.3): часы — по последним ходам, стоят. */
  const finishedState = async (row: GameRow, ctx: WsContext): Promise<GameState> => {
    const ratings = row.rated && row.status === "finished" ? await rating.changesForGame(row.id, row.white_id, row.black_id) : null;
    const ref = async (userId: string, color: "white" | "black"): Promise<PlayerRef> => {
      const base = await playerRef(userId, row.category, false);
      const before = ratings?.[color].rating_before;
      return before === undefined ? base : { ...base, rating: before };
    };
    const [white, black] = await Promise.all([ref(row.white_id, "white"), ref(row.black_id, "black")]);
    const clocks = { white_ms: row.time_base * 1000, black_ms: row.time_base * 1000 };
    row.moves.forEach((m, i) => {
      if (i % 2 === 0) clocks.white_ms = m.clock_ms;
      else clocks.black_ms = m.clock_ms;
    });
    const game: Game = {
      id: row.id,
      white,
      black,
      category: row.category,
      time_base: row.time_base,
      time_increment: row.time_increment,
      rated: row.rated,
      status: row.status,
      result: row.result,
      termination: row.termination,
      started_at: row.started_at.toISOString(),
      ended_at: row.ended_at?.toISOString() ?? null,
      moves: row.moves.map((m) => ({ san: m.san, clock_ms: m.clock_ms })),
      ratings,
    };
    const caller = ctx.caller.who === "guest" ? null : ctx.caller.user_id;
    return {
      type: "game.state",
      game_id: row.id,
      game,
      clock: { ...clocks, running: null },
      your_color: caller === row.white_id ? "white" : caller === row.black_id ? "black" : null,
      draw_offer: null,
      takeback_offer: null,
      connected: { white: false, black: false },
      first_move_ms: null,
      reconnect: null,
      abandonment_choice: null,
    };
  };

  const sendError = (ctx: WsContext, ref: string | null, code: ErrorCode, gameId: string): void => {
    ctx.send({ type: "error", ref, code, game_id: gameId, details: null } satisfies ServerMessage);
  };

  const dropSubscription = (ctx: WsContext): void => {
    const prev = subscriptions.get(ctx.connection_id);
    if (prev === undefined) return;
    subscriptions.delete(ctx.connection_id);
    rooms.get(prev)?.unsubscribe(ctx.connection_id);
  };

  /** Закрытие соединения снимает его подписку (бриф E06, «Решения»). */
  const watchClose = (ctx: WsContext): void => {
    if (watched.has(ctx.connection_id)) return;
    watched.add(ctx.connection_id);
    ctx.onClose(() => {
      watched.delete(ctx.connection_id);
      dropSubscription(ctx);
    });
  };

  return {
    events,

    async createGame(trx, input) {
      if (input.white_id === input.black_id) throw new Error("createGame: white and black are the same user");
      const locked = await users.lockForGame(trx, [input.white_id, input.black_id]);
      // Порядок A28: сначала deleted (в user_ids — только удалённые), потом busy.
      const deleted = locked.filter((u) => u.deleted).map((u) => u.id);
      if (deleted.length > 0) throw new GameCreateRefused("deleted", deleted.sort());
      const busy = await playersWithActiveGame(trx, [input.white_id, input.black_id]);
      if (busy.length > 0) throw new GameCreateRefused("busy", busy.sort());
      const row = await insertGame(trx, {
        white_id: input.white_id,
        black_id: input.black_id,
        category: categoryOf(input.time_base, input.time_increment),
        time_base: input.time_base,
        time_increment: input.time_increment,
        rated: input.rated,
        status: "active",
        result: null,
        termination: null,
        pgn: null,
        started_at: time.wallNow(),
        ended_at: null,
      });
      return {
        game_id: row.id,
        started() {
          void roomOf(row.id).catch((err: unknown) => report(err, "game room open failed"));
          events.emitGameStarted({ game_id: row.id, white_id: row.white_id, black_id: row.black_id });
          for (const user_id of [row.white_id, row.black_id]) analytics.record({ name: "game_started", user_id, game_id: row.id });
        },
      };
    },

    activeGameId: (userId) => activeGameIdOf(db, userId),

    async subscribe(ctx, ref, gameId) {
      watchClose(ctx);
      dropSubscription(ctx);
      const id = ctx.connection_id;
      /** Соединение ещё открыто (watchClose снимает отметку при закрытии). */
      const open = (): boolean => watched.has(id);
      const room = await roomOf(gameId);
      if (!open()) return;
      if (room !== null) {
        subscriptions.set(id, gameId);
        await room.subscribe(ctx);
        // Пока команда стояла в очереди комнаты, соединение закрылось или подписалось на другое —
        // подписчик, добавленный задачей очереди, снимается (иначе `connected` врёт).
        if (!open() || subscriptions.get(id) !== gameId) room.unsubscribe(id);
        return;
      }
      const row = await findGame(db, gameId);
      if (row === null) {
        sendError(ctx, ref, "not_found", gameId);
        return;
      }
      ctx.send(await finishedState(row, ctx));
    },

    unsubscribe(ctx, gameId) {
      if (subscriptions.get(ctx.connection_id) === gameId) dropSubscription(ctx);
    },

    async move(ctx, ref, gameId, ply, uci, receivedAt) {
      const room = await roomOf(gameId);
      if (room !== null) {
        await room.move(ctx, ref, ply, uci, receivedAt);
        return;
      }
      // Комнаты нет: партии нет или она закончена (порядок API §5.2: участник → game_not_active).
      const row = await findGame(db, gameId);
      if (row === null) {
        sendError(ctx, ref, "not_found", gameId);
        return;
      }
      const caller = ctx.caller.who === "guest" ? null : ctx.caller.user_id;
      if (caller !== row.white_id && caller !== row.black_id) {
        sendError(ctx, ref, "not_a_participant", gameId);
        return;
      }
      sendError(ctx, ref, "game_not_active", gameId);
      ctx.send(await finishedState(row, ctx));
    },

    async start() {
      const rows = await findActiveGames(db);
      for (const row of rows) {
        if (rooms.has(row.id)) continue;
        // Одна битая партия не роняет запуск (иначе выкатка уходит в цикл перезапусков): лог + Sentry,
        // комнату поднимет ленивая загрузка по первой команде.
        try {
          await openRoom(row);
        } catch (err) {
          report(err, "game room restore failed");
        }
      }
      if (rows.length > 0) log.info({ games: rows.length }, "game rooms restored");
    },

    async idle() {
      do {
        await Promise.allSettled([...loading.values(), ...[...rooms.values()].map((r) => r.idle())]);
        await new Promise<void>((resolve) => setImmediate(resolve));
      } while (loading.size > 0);
    },

    async stop() {
      stopped = true;
      await Promise.allSettled([...loading.values()]);
      for (const room of rooms.values()) room.dispose();
      rooms.clear();
      subscriptions.clear();
    },
  };
}
