import { z } from "zod";

/**
 * Схемы сообщений клиент → сервер: `z.strictObject({type: z.literal("…"), …})` (API §13, §9.1).
 * В E01 список пуст (ADR-0009): сообщения появляются по эпикам, и тогда `ClientMessage` становится
 * `z.discriminatedUnion("type", …)` над этим списком.
 */
export const CLIENT_MESSAGE_SCHEMAS: readonly z.ZodObject[] = [];

export const ClientMessage = z.never();
export type ClientMessage = z.infer<typeof ClientMessage>;
