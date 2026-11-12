import { z } from "zod";

/** `ref` команды (API §8.2): строка ≤ 16 символов; сервер возвращает её только в `error`. */
export const WsRef = z.string().min(1).max(16);

/** Ответ на `ping` (API §9.4): тот же `n`. */
export const Pong = z.strictObject({ type: z.literal("pong"), ref: WsRef.optional(), n: z.int().nonnegative() });
export type Pong = z.infer<typeof Pong>;

/** Подписка на партию (API §8.3): все, в том числе гость (зритель, SECURITY S28). */
export const GameSubscribe = z.strictObject({ type: z.literal("game.subscribe"), ref: WsRef.optional(), game_id: z.uuid() });
export type GameSubscribe = z.infer<typeof GameSubscribe>;

export const GameUnsubscribe = z.strictObject({ type: z.literal("game.unsubscribe"), ref: WsRef.optional(), game_id: z.uuid() });
export type GameUnsubscribe = z.infer<typeof GameUnsubscribe>;

/** Ход (API §9.1–9.2): `ply` — длина `moves` у клиента; ход в UCI, превращение — с буквой. Времени, цвета, итога нет. */
export const GameMove = z.strictObject({
  type: z.literal("game.move"),
  ref: WsRef.optional(),
  game_id: z.uuid(),
  ply: z.int().nonnegative(),
  uci: z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/),
});
export type GameMove = z.infer<typeof GameMove>;

/**
 * Схемы сообщений клиент → сервер: `z.strictObject({type: z.literal("…"), …})` (API §13, §9.1).
 * Сообщения появляются по эпикам (ADR-0009): новое — в список и в `ClientMessage`.
 */
export const CLIENT_MESSAGE_SCHEMAS: readonly z.ZodObject[] = [Pong, GameSubscribe, GameUnsubscribe, GameMove];

export const ClientMessage = z.discriminatedUnion("type", [Pong, GameSubscribe, GameUnsubscribe, GameMove]);
export type ClientMessage = z.infer<typeof ClientMessage>;
