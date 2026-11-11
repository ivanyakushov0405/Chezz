import { z } from "zod";
import { ErrorCode } from "../errors.ts";

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

/** Схемы сообщений сервер → клиент (API §13, §9.3); клиент разбирает нестрого (API §1). */
export const SERVER_MESSAGE_SCHEMAS: readonly z.ZodObject[] = [Welcome, Ping, WsError, SessionClosed];

export const ServerMessage = z.discriminatedUnion("type", [Welcome, Ping, WsError, SessionClosed]);
export type ServerMessage = z.infer<typeof ServerMessage>;
