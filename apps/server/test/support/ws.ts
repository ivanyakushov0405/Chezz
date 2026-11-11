// Тестовый клиент WebSocket (TESTING §7.3): ставит cookie и Origin своего app, копит входящие сообщения.
import { PROTOCOL_VERSION } from "@chezz/protocol";
import WebSocket from "ws";
import type { TestApp } from "./app.ts";

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

export interface WsClient {
  readonly socket: WebSocket;
  /** Все полученные сообщения по порядку. */
  readonly received: WsMessage[];
  /** Следующее ещё не прочитанное сообщение (с type — первое такого type); ждёт до timeoutMs. */
  next(type?: string, timeoutMs?: number): Promise<WsMessage>;
  /** Отправить объект (JSON) или сырую строку. */
  send(message: unknown): void;
  /** Код и причина закрытия; ждёт до timeoutMs. */
  closed(timeoutMs?: number): Promise<{ code: number; reason: string }>;
  isOpen(): boolean;
  close(): void;
}

export interface WsOptions {
  cookie?: string | null;
  /** По умолчанию — origin app; null — без заголовка. */
  origin?: string | null;
  /** По умолчанию — PROTOCOL_VERSION; null — без параметра. */
  protocolVersion?: string | null;
  /** Заголовки upgrade (например, X-Forwarded-For не используется: ключ — адрес сокета). */
  headers?: Record<string, string>;
  /** Сразу отвечать pong на ping, как клиент (API §9.4); по умолчанию — нет. */
  autoPong?: boolean;
}

const open = new Set<WebSocket>();

/** Закрыть все клиенты теста (afterEach). */
export function closeAllWs(): void {
  for (const s of open) s.terminate();
  open.clear();
}

function wsUrl(app: TestApp, options: WsOptions): string {
  const version = options.protocolVersion === undefined ? String(PROTOCOL_VERSION) : options.protocolVersion;
  return version === null ? app.wsUrl : `${app.wsUrl}?protocol_version=${encodeURIComponent(version)}`;
}

function headersOf(app: TestApp, options: WsOptions): Record<string, string> {
  const headers: Record<string, string> = { ...options.headers };
  const origin = options.origin === undefined ? app.url : options.origin;
  if (origin !== null) headers["Origin"] = origin;
  if (options.cookie) headers["Cookie"] = options.cookie;
  return headers;
}

/** Открыть соединение; отказ upgrade (не 101) — ошибка с полем status. */
export function connectWs(app: TestApp, options: WsOptions = {}): Promise<WsClient> {
  const socket = new WebSocket(wsUrl(app, options), { headers: headersOf(app, options) });
  open.add(socket);
  const received: WsMessage[] = [];
  let cursor = new Set<number>();
  const waiters = new Set<() => void>();
  let closeInfo: { code: number; reason: string } | null = null;
  const wake = (): void => {
    for (const w of [...waiters]) w();
  };
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString()) as WsMessage;
    received.push(message);
    if (options.autoPong && message.type === "ping") socket.send(JSON.stringify({ type: "pong", n: message["n"] }));
    wake();
  });
  socket.on("close", (code, reason) => {
    closeInfo = { code, reason: reason.toString() };
    open.delete(socket);
    wake();
  });

  const wait = <T>(probe: () => T | undefined, timeoutMs: number, what: string): Promise<T> =>
    new Promise((resolve, reject) => {
      const check = (): boolean => {
        const value = probe();
        if (value === undefined) return false;
        waiters.delete(onWake);
        clearTimeout(timer);
        resolve(value);
        return true;
      };
      const onWake = (): void => {
        check();
      };
      const timer = setTimeout(() => {
        waiters.delete(onWake);
        reject(new Error(`ws: timeout waiting for ${what}; received: ${JSON.stringify(received.map((m) => m.type))}`));
      }, timeoutMs);
      waiters.add(onWake);
      check();
    });

  const client: WsClient = {
    socket,
    received,
    next: (type, timeoutMs = 2_000) =>
      wait(
        () => {
          const index = received.findIndex((m, i) => !cursor.has(i) && (type === undefined || m.type === type));
          if (index === -1) return undefined;
          cursor = new Set(cursor).add(index);
          return received[index];
        },
        timeoutMs,
        type ?? "a message",
      ),
    send: (message) => socket.send(typeof message === "string" ? message : JSON.stringify(message)),
    closed: (timeoutMs = 2_000) => wait(() => closeInfo ?? undefined, timeoutMs, "close"),
    isOpen: () => socket.readyState === WebSocket.OPEN,
    close: () => socket.close(),
  };

  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve(client));
    socket.once("unexpected-response", (_req, res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        open.delete(socket);
        const err = new Error(`ws upgrade refused: ${res.statusCode}`) as Error & { status: number; body: unknown };
        err.status = res.statusCode ?? 0;
        const text = Buffer.concat(chunks).toString();
        try {
          err.body = JSON.parse(text);
        } catch {
          err.body = text;
        }
        reject(err);
      });
    });
    socket.once("error", (err) => {
      if (socket.readyState !== WebSocket.OPEN) reject(err);
    });
  });
}

/** Подключиться и дождаться welcome. */
export async function connectWelcomed(app: TestApp, options: WsOptions = {}): Promise<{ client: WsClient; welcome: WsMessage }> {
  const client = await connectWs(app, options);
  return { client, welcome: await client.next("welcome") };
}

/**
 * Сдвинуть время app на ms шагами по 5 с с паузой на ответ клиента: при autoPong соединения живут
 * (один advance на минуту — 12 ping без возможности ответить, и соединение мёртвое, К-8).
 */
export async function advanceLive(app: TestApp, ms: number, pauseMs = 30): Promise<void> {
  let left = ms;
  while (left > 0) {
    const step = Math.min(5_000, left);
    await app.time.advance(step);
    await new Promise((r) => setTimeout(r, pauseMs));
    left -= step;
  }
}
