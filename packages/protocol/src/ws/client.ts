import { z } from "zod";

/** `ref` команды (API §8.2): строка ≤ 16 символов; сервер возвращает её только в `error`. */
export const WsRef = z.string().min(1).max(16);

/** Ответ на `ping` (API §9.4): тот же `n`. */
export const Pong = z.strictObject({ type: z.literal("pong"), ref: WsRef.optional(), n: z.int().nonnegative() });
export type Pong = z.infer<typeof Pong>;

/**
 * Схемы сообщений клиент → сервер: `z.strictObject({type: z.literal("…"), …})` (API §13, §9.1).
 * Сообщения появляются по эпикам (ADR-0009): новое — в список и в `ClientMessage`.
 */
export const CLIENT_MESSAGE_SCHEMAS: readonly z.ZodObject[] = [Pong];

export const ClientMessage = z.discriminatedUnion("type", [Pong]);
export type ClientMessage = z.infer<typeof ClientMessage>;
