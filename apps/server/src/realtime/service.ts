// realtime: WebSocket-шлюз — соединения, маршрутизация к обработчикам модулей (ADR-0005 п.8), права (API §8.1),
// лимиты (SECURITY §9, A21), ping/pong и RTT (A11, API §9.4), закрытие по Session (S6, ARCHITECTURE §9.1 п.9),
// онлайн для /metrics (OPERATIONS §12.2). Состояние — в замыкании фабрики (ADR-0005 п.2).
import { randomUUID } from "node:crypto";
import { ClientMessage, PROTOCOL_VERSION, type ErrorCode, type ServerMessage } from "@chezz/protocol";
import type { FastifyBaseLogger } from "fastify";
import type { WebSocket } from "ws";
import type { AuthService } from "../auth/service.ts";
import { AppError, zodIssues } from "../platform/errors.ts";
import { rateLimitKey, type Caller } from "../platform/http.ts";
import type { MetricsService } from "../platform/metrics.ts";
import { every } from "../platform/schedule.ts";
import type { ErrorReporter } from "../platform/sentry.ts";
import type { TimerId, TimeSource } from "../platform/time.ts";
import type { WsContext, WsHandler, WsHandlers } from "../platform/ws.ts";
import { fullBucket, takeToken, WS_MESSAGE_BUCKET, type BucketState } from "./domain/bucket.ts";
import { initialPingState, medianRtt, nextPing, PING_INTERVAL_MS, receivePong, type PingState } from "./domain/ping.ts";
import { refusalFor } from "./domain/rights.ts";

/** Открытых WebSocket: 5 на User; без Session — 50 на IP (SECURITY §9). */
export const MAX_CONNECTIONS_PER_USER = 5;
export const MAX_GUEST_CONNECTIONS_PER_IP = 50;
/** Перепроверка Session открытых соединений (S6). */
export const SESSION_RECHECK_MS = 60_000;
/** Остановка app: столько ждём закрытия после 1012, потом terminate (полуоткрытый TCP не держит остановку). */
export const SHUTDOWN_GRACE_MS = 1_000;
/** Буфер отправки больше 1 МБ — медленный клиент, закрытие 1011 (API §10). */
export const SEND_BUFFER_LIMIT_BYTES = 1_048_576;

/** Коды закрытия, которые ставит шлюз (API §10). */
export const CLOSE_CODE = {
  rate_limited: 1008,
  internal: 1011,
  restart: 1012,
  session_closed: 4001,
  client_outdated: 4002,
  too_many_connections: 4003,
} as const;

export interface AcceptOptions {
  caller: Caller;
  /** Адрес сокета (ключ лимита гостя, как у REST). */
  ip: string;
  /** `protocol_version` из строки запроса upgrade; нет — undefined. */
  protocol_version: string | undefined;
}

export interface RealtimeService {
  /** Обработчики модулей (ADR-0005 п.8); вызывает только app.ts. Два обработчика одного type — ошибка. */
  registerHandlers(...sets: WsHandlers[]): void;
  /** Новое соединение после upgrade (Origin и лимит REST уже проверены). */
  accept(socket: WebSocket, options: AcceptOptions): void;
  start(): void;
  /** Закрыть все соединения кодом 1012 (перезапуск app, API §10); не закрытые за SHUTDOWN_GRACE_MS — terminate. */
  closeAll(): Promise<void>;
  stop(): Promise<void>;
}

export interface RealtimeServiceDeps {
  time: TimeSource;
  log: FastifyBaseLogger;
  reporter?: ErrorReporter;
  metrics: MetricsService;
  auth: AuthService;
}

interface Connection {
  readonly id: string;
  readonly socket: WebSocket;
  readonly caller: Caller;
  readonly limitKey: string;
  readonly ctx: WsContext;
  bucket: BucketState;
  ping: PingState;
  pingTimer: TimerId | null;
  expiryTimer: TimerId | null;
  /** Обработчики закрытия от модулей (WsContext.onClose). */
  closeHandlers: (() => void)[];
  /** Сообщения соединения обрабатываются по одному, в порядке прихода (API §8.2). */
  queue: Promise<void>;
  closed: boolean;
}

/** Внутренний type, который шлюз обрабатывает сам. */
const RESERVED_TYPES: ReadonlySet<string> = new Set(["pong"]);

function sessionIdOf(caller: Caller): string | null {
  return caller.who === "guest" ? null : caller.session_id;
}

function userIdOf(caller: Caller): string | null {
  return caller.who === "guest" ? null : caller.user_id;
}

/** `ref` из сырого сообщения — только допустимая строка (API §8.2); иначе null. */
function refOf(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  const ref = (value as Record<string, unknown>)["ref"];
  return typeof ref === "string" && ref.length >= 1 && ref.length <= 16 ? ref : null;
}

function gameIdOf(message: object): string | null {
  const id = (message as Record<string, unknown>)["game_id"];
  return typeof id === "string" ? id : null;
}

export function createRealtimeService(deps: RealtimeServiceDeps): RealtimeService {
  const { time, log, auth } = deps;
  const handlers = new Map<string, WsHandler>();
  const connections = new Map<string, Connection>();
  /** Открытые соединения по ключу лимита (`user:<id>` / `ip:<адрес>`). */
  const perLimitKey = new Map<string, number>();
  /** Онлайн: User → число его открытых соединений (П1 входит, гость — нет). */
  const online = new Map<string, number>();

  deps.metrics.addGauge({ name: "chezz_players_online", help: "User с открытым WebSocket", collect: () => online.size });

  const increment = (map: Map<string, number>, key: string): void => {
    map.set(key, (map.get(key) ?? 0) + 1);
  };
  const decrement = (map: Map<string, number>, key: string): void => {
    const left = (map.get(key) ?? 0) - 1;
    if (left > 0) map.set(key, left);
    else map.delete(key);
  };

  const report = (err: unknown, what: string): void => {
    log.error({ err }, what);
    deps.reporter?.captureException(err);
  };

  /** Снять соединение со счёта; таймеры — тоже. Повторный вызов безопасен. */
  const release = (conn: Connection): void => {
    if (conn.closed) return;
    conn.closed = true;
    if (conn.pingTimer !== null) time.clearTimer(conn.pingTimer);
    if (conn.expiryTimer !== null) time.clearTimer(conn.expiryTimer);
    conn.pingTimer = null;
    conn.expiryTimer = null;
    connections.delete(conn.id);
    decrement(perLimitKey, conn.limitKey);
    const userId = userIdOf(conn.caller);
    if (userId !== null) decrement(online, userId);
    for (const fn of conn.closeHandlers.splice(0)) {
      try {
        fn();
      } catch (err) {
        report(err, "ws close handler failed");
      }
    }
  };

  const close = (conn: Connection, code: number): void => {
    if (conn.closed) return;
    release(conn);
    conn.socket.close(code);
  };

  const send = (conn: Connection, message: ServerMessage): void => {
    if (conn.closed) return;
    if (conn.socket.bufferedAmount > SEND_BUFFER_LIMIT_BYTES) {
      close(conn, CLOSE_CODE.internal);
      return;
    }
    conn.socket.send(JSON.stringify(message));
  };

  const sendError = (conn: Connection, ref: string | null, code: ErrorCode, gameId: string | null = null, details: unknown = null): void => {
    send(conn, { type: "error", ref, code, game_id: gameId, details });
  };

  const closeForSession = (conn: Connection): void => {
    send(conn, { type: "session.closed" });
    close(conn, CLOSE_CODE.session_closed);
  };

  /** Session истекает до следующей перепроверки — таймер на expires_at (таймер на 30 дней переполнил бы setTimeout). */
  const watchExpiry = (conn: Connection, expiresAt: Date): void => {
    if (conn.closed || conn.expiryTimer !== null) return;
    const delay = expiresAt.getTime() - time.wallNow().getTime();
    if (delay <= 0) {
      closeForSession(conn);
      return;
    }
    // Запас в две перепроверки: срок чуть больше 60 с не должен ждать следующего прохода (и его запроса).
    if (delay > 2 * SESSION_RECHECK_MS) return;
    conn.expiryTimer = time.setTimer(delay, () => {
      conn.expiryTimer = null;
      closeForSession(conn);
    });
  };

  const schedulePing = (conn: Connection): void => {
    if (conn.closed) return;
    conn.pingTimer = time.setTimer(PING_INTERVAL_MS, () => {
      conn.pingTimer = null;
      if (conn.closed) return;
      const next = nextPing(conn.ping, time.now());
      if (next.action === "dead") {
        // Клиента нет: код закрытия он не увидит (API §9.4).
        release(conn);
        conn.socket.terminate();
        return;
      }
      conn.ping = next.state;
      send(conn, { type: "ping", n: next.action.send });
      schedulePing(conn);
    });
  };

  const welcome = async (conn: Connection): Promise<void> => {
    let user: { id: string; nickname: string | null } | null = null;
    if (conn.caller.who !== "guest") {
      const info = await auth.connectionInfo(conn.caller);
      if (info === null) {
        closeForSession(conn);
        return;
      }
      user = info.user;
      watchExpiry(conn, info.expires_at);
    }
    send(conn, { type: "welcome", protocol_version: PROTOCOL_VERSION, user, ping_interval_ms: PING_INTERVAL_MS });
    schedulePing(conn);
  };

  /** Токен — в момент прихода, до очереди: отказанное не копится в очереди медленного обработчика. */
  const admit = (conn: Connection): boolean => {
    if (conn.closed) return false;
    const taken = takeToken(WS_MESSAGE_BUCKET, conn.bucket, time.now());
    conn.bucket = taken.state;
    if (taken.verdict === "close") {
      close(conn, CLOSE_CODE.rate_limited);
      return false;
    }
    if (taken.verdict === "rejected") {
      const retry = Math.max(1, Math.ceil(((1 - taken.state.tokens) * 1000) / WS_MESSAGE_BUCKET.rate_per_s));
      sendError(conn, null, "rate_limited", null, { retry_after_ms: retry });
      return false;
    }
    return true;
  };

  const dispatch = async (conn: Connection, data: Buffer, isBinary: boolean): Promise<void> => {
    if (conn.closed) return;
    let raw: unknown;
    try {
      if (isBinary) throw new Error("binary");
      raw = JSON.parse(data.toString("utf8"));
    } catch {
      sendError(conn, null, "validation_failed", null, { issues: [{ path: "", rule: "json" }] });
      return;
    }
    const ref = refOf(raw);
    const parsed = ClientMessage.safeParse(raw);
    if (!parsed.success) {
      sendError(conn, ref, "validation_failed", null, { issues: zodIssues(parsed.error) });
      return;
    }
    const message = parsed.data;
    const refusal = refusalFor(conn.caller.who, message.type);
    if (refusal !== null) {
      sendError(conn, ref, refusal, gameIdOf(message));
      return;
    }
    if (message.type === "pong") {
      conn.ping = receivePong(conn.ping, message.n, time.now());
      conn.ctx.rtt_ms = medianRtt(conn.ping.samples);
      return;
    }
    const handler = handlers.get(message.type);
    if (handler === undefined) {
      report(new Error(`no ws handler for ${message.type}`), "ws handler missing");
      sendError(conn, ref, "internal", gameIdOf(message));
      return;
    }
    try {
      await handler(conn.ctx, message);
    } catch (err) {
      if (err instanceof AppError) {
        sendError(conn, ref, err.code, gameIdOf(message), err.details);
      } else {
        report(err, "ws handler failed");
        sendError(conn, ref, "internal", gameIdOf(message));
      }
    }
  };

  const enqueue = (conn: Connection, task: () => Promise<void>): void => {
    conn.queue = conn.queue.then(task).catch((err: unknown) => {
      report(err, "ws connection task failed");
      close(conn, CLOSE_CODE.internal);
    });
  };

  const closeAll = async (): Promise<void> => {
    const sockets = [...connections.values()].map((conn) => {
      close(conn, CLOSE_CODE.restart);
      return conn.socket;
    });
    const pending = sockets.filter((socket) => socket.readyState !== socket.CLOSED);
    if (pending.length === 0) return;
    await new Promise<void>((resolve) => {
      let left = pending.length;
      const done = (): void => {
        left--;
        if (left === 0) {
          time.clearTimer(grace);
          resolve();
        }
      };
      for (const socket of pending) socket.once("close", done);
      const grace = time.setTimer(SHUTDOWN_GRACE_MS, () => {
        for (const socket of pending) if (socket.readyState !== socket.CLOSED) socket.terminate();
        resolve();
      });
    });
  };

  auth.onSessionsClosed((event) => {
    const ids = new Set(event.session_ids);
    for (const conn of [...connections.values()]) {
      const sid = sessionIdOf(conn.caller);
      if (sid !== null && ids.has(sid)) closeForSession(conn);
    }
  });

  const recheck = every(
    { time, log, ...(deps.reporter ? { reporter: deps.reporter } : {}) },
    { name: "realtime.session_recheck", interval_ms: SESSION_RECHECK_MS, run_at_start: false },
    async () => {
      const open = [...connections.values()].filter((c) => sessionIdOf(c.caller) !== null);
      if (open.length === 0) return;
      const ids = [...new Set(open.map((c) => sessionIdOf(c.caller)!))];
      const alive = await auth.sessionExpiries(ids);
      for (const conn of open) {
        const expiresAt = alive.get(sessionIdOf(conn.caller)!);
        if (expiresAt === undefined) closeForSession(conn);
        else watchExpiry(conn, expiresAt);
      }
    },
  );

  return {
    registerHandlers(...sets) {
      for (const set of sets) {
        for (const [type, handler] of Object.entries(set)) {
          if (RESERVED_TYPES.has(type)) throw new Error(`ws handler: ${type} is handled by realtime`);
          if (handlers.has(type)) throw new Error(`ws handler: duplicate ${type}`);
          handlers.set(type, handler);
        }
      }
    },

    accept(socket, options) {
      const { caller } = options;
      const reject = (code: "client_outdated" | "too_many_connections"): void => {
        socket.send(JSON.stringify({ type: "error", ref: null, code, game_id: null, details: null } satisfies ServerMessage));
        socket.close(CLOSE_CODE[code]);
      };
      if (options.protocol_version !== String(PROTOCOL_VERSION)) {
        reject("client_outdated");
        return;
      }
      const limitKey = rateLimitKey(caller, options.ip);
      const max = caller.who === "guest" ? MAX_GUEST_CONNECTIONS_PER_IP : MAX_CONNECTIONS_PER_USER;
      if ((perLimitKey.get(limitKey) ?? 0) >= max) {
        reject("too_many_connections");
        return;
      }

      const id = randomUUID();
      const conn: Connection = {
        id,
        socket,
        caller,
        limitKey,
        ctx: {
          caller,
          connection_id: id,
          rtt_ms: null,
          send: (message) => send(conn, message as ServerMessage),
          onClose: (fn) => {
            if (conn.closed) fn();
            else conn.closeHandlers.push(fn);
          },
        },
        closeHandlers: [],
        bucket: fullBucket(WS_MESSAGE_BUCKET, time.now()),
        ping: initialPingState(),
        pingTimer: null,
        expiryTimer: null,
        queue: Promise.resolve(),
        closed: false,
      };
      connections.set(id, conn);
      increment(perLimitKey, limitKey);
      const userId = userIdOf(caller);
      if (userId !== null) increment(online, userId);

      socket.on("message", (data, isBinary) => {
        if (!admit(conn)) return;
        const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
        enqueue(conn, () => dispatch(conn, buffer, isBinary));
      });
      socket.on("close", () => release(conn));
      enqueue(conn, () => welcome(conn));
    },

    start() {
      recheck.start();
    },

    closeAll,

    async stop() {
      await recheck.stop();
      await closeAll();
    },
  };
}
