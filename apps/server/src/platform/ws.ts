// Типы обработчиков WebSocket (ADR-0005 п.8): модули экспортируют xWsHandlers(svc): WsHandlers,
// app.ts передаёт их в realtime. Сервера WebSocket в E01 нет — только типы.
import type { Caller } from "./http.ts";

export interface WsContext {
  caller: Caller;
  /** id соединения (внутренний, в протокол не уходит). */
  connection_id: string;
  /** Последний измеренный RTT, мс (A11); null — ещё не измерен. */
  rtt_ms: number | null;
  /** Отправить сообщение этому соединению (тип сообщения — ServerMessage из packages/protocol). */
  send(message: unknown): void;
}

export type WsHandler = (ctx: WsContext, message: unknown) => Promise<void>;

/** «type сообщения → обработчик»; два обработчика одного type — ошибка при старте. */
export type WsHandlers = Readonly<Record<string, WsHandler>>;
