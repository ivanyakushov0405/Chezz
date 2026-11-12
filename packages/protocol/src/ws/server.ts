import { z } from "zod";
import { ErrorCode } from "../errors.ts";
import { AbandonmentChoice, Clock, Color, Connected, Game, GameRatings, GameResult, Offer, Reconnect, Termination } from "../game.ts";

/** Первое сообщение соединения (API §8.1). `user.nickname` — null у П1 (первый вход не пройден). */
export const Welcome = z.object({
  type: z.literal("welcome"),
  protocol_version: z.int(),
  user: z.object({ id: z.uuid(), nickname: z.string().nullable() }).nullable(),
  ping_interval_ms: z.int().positive(),
});
export type Welcome = z.infer<typeof Welcome>;

/** Прикладной ping раз в 5 с (API §9.4, ARCHITECTURE A11). */
export const Ping = z.object({ type: z.literal("ping"), n: z.int().nonnegative() });
export type Ping = z.infer<typeof Ping>;

/** Ошибка команды (API §5, §13): `ref` — из команды или null; `details` — как в REST. */
export const WsError = z.object({
  type: z.literal("error"),
  ref: z.string().nullable(),
  code: ErrorCode,
  game_id: z.uuid().nullable(),
  details: z.unknown(),
});
export type WsError = z.infer<typeof WsError>;

/** Session закрыта (SECURITY S6); затем закрытие 4001 (API §10). */
export const SessionClosed = z.object({ type: z.literal("session.closed") });
export type SessionClosed = z.infer<typeof SessionClosed>;

/** Снимок партии (API §9.3): на подписку, после отказов «со снимком» (API §5.2). `your_color: null` — зритель. */
export const GameState = z.object({
  type: z.literal("game.state"),
  game_id: z.string(),
  game: Game,
  clock: Clock,
  your_color: Color.nullable(),
  draw_offer: Offer,
  takeback_offer: Offer,
  connected: Connected,
  first_move_ms: z.int().nonnegative().nullable(),
  reconnect: Reconnect,
  abandonment_choice: AbandonmentChoice,
});
export type GameState = z.infer<typeof GameState>;

/** Ход сделан (API §9.3): `ply` — номер этого хода с 1; часы обоих — серверные. */
export const GameMoved = z.object({
  type: z.literal("game.moved"),
  game_id: z.string(),
  ply: z.int().positive(),
  san: z.string(),
  clock: Clock,
  draw_offer: Offer,
  takeback_offer: Offer,
});
export type GameMoved = z.infer<typeof GameMoved>;

/** Конец партии (API §9.3, ARCHITECTURE §9.1 п.7). */
export const GameEnded = z.object({
  type: z.literal("game.ended"),
  game_id: z.string(),
  status: z.enum(["finished", "aborted"]),
  result: GameResult.nullable(),
  termination: Termination,
  ratings: GameRatings,
});
export type GameEnded = z.infer<typeof GameEnded>;

/** Схемы сообщений сервер → клиент (API §13, §9.3); клиент разбирает нестрого (API §1). */
export const SERVER_MESSAGE_SCHEMAS: readonly z.ZodObject[] = [Welcome, Ping, WsError, SessionClosed, GameState, GameMoved, GameEnded];

export const ServerMessage = z.discriminatedUnion("type", [Welcome, Ping, WsError, SessionClosed, GameState, GameMoved, GameEnded]);
export type ServerMessage = z.infer<typeof ServerMessage>;
