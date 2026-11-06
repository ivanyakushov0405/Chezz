import { z } from "zod";

/** Схемы сообщений сервер → клиент (API §13, §9.3). В E01 список пуст (ADR-0009). */
export const SERVER_MESSAGE_SCHEMAS: readonly z.ZodObject[] = [];

export const ServerMessage = z.never();
export type ServerMessage = z.infer<typeof ServerMessage>;
