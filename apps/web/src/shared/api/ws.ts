// Клиент WebSocket (ARCHITECTURE §12; API §8–10): одно соединение на вкладку, ответ на ping, переподключение
// с паузами P22, коды закрытия API §10, состояния соединения DESIGN §10.2. Типы — только packages/protocol.
import { PROTOCOL_VERSION, ServerMessage, type ClientMessage } from "@chezz/protocol";

/** Состояние соединения (DESIGN §10.2): `open` — welcome получен. */
export type WsStatus = "connecting" | "open" | "reconnecting" | "offline" | "outdated" | "too-many-tabs";

/** Паузы переподключения (API §10, P22), мс; дальше — последняя. К каждой — случайные 0–30%. */
export const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 5_000] as const;
/** После 1008 (лимит сообщений) — 5 с (API §10). */
export const RATE_LIMIT_RECONNECT_MS = 5_000;
/** Клиент считает соединение мёртвым, если 15 с нет ни одного сообщения (API §9.4). */
export const SILENCE_TIMEOUT_MS = 15_000;
/** Флаг «уже перезагружались из-за 4002» (DESIGN §10.2 `outdated`). */
export const OUTDATED_RELOAD_KEY = "chezz.ws_outdated_reload";

export interface WsEnvironment {
  url: string;
  createSocket(url: string): WebSocket;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
  random(): number;
  isOnline(): boolean;
  onOnline(fn: () => void): void;
  reload(): void;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
}

export interface WsClient {
  readonly status: WsStatus;
  /** Подключиться, если ещё нет. */
  start(): void;
  /** Отправить команду; не подключены — false (команда не копится и не повторяется, API §10). */
  send(message: ClientMessage): boolean;
  /** Сообщения сервера (после разбора схемой); незнакомый type игнорируется (API §8.2). */
  onMessage(fn: (message: ServerMessage) => void): () => void;
  onStatus(fn: (status: WsStatus) => void): () => void;
  /** Каждый welcome (в том числе после переподключения): повторить подписки (API §10). */
  onWelcome(fn: () => void): () => void;
  /** Закрыта Session (4001): перезапросить /api/me, работать как гость. */
  onSessionClosed(fn: () => void): () => void;
  /** «Подключиться снова» после 4003 и переподключение после входа/выхода. */
  reconnect(): void;
  close(): void;
}

export function wsUrl(location: Pick<Location, "protocol" | "host">): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/ws?protocol_version=${PROTOCOL_VERSION}`;
}

export function browserWsEnvironment(): WsEnvironment {
  let storage: WsEnvironment["storage"] = null;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = null;
  }
  return {
    url: wsUrl(window.location),
    createSocket: (url) => new WebSocket(url),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
    random: Math.random,
    isOnline: () => navigator.onLine !== false,
    onOnline: (fn) => window.addEventListener("online", fn),
    reload: () => window.location.reload(),
    storage,
  };
}

/** Пауза попытки `attempt` (с 0) с разбросом 0–30% (P22). */
export function reconnectDelay(attempt: number, random: number): number {
  const base = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]!;
  return Math.round(base * (1 + 0.3 * random));
}

export function createWsClient(env: WsEnvironment): WsClient {
  let socket: WebSocket | null = null;
  let status: WsStatus = "connecting";
  let started = false;
  let attempt = 0;
  let retryTimer: number | null = null;
  let silenceTimer: number | null = null;
  const messageFns = new Set<(m: ServerMessage) => void>();
  const statusFns = new Set<(s: WsStatus) => void>();
  const welcomeFns = new Set<() => void>();
  const sessionFns = new Set<() => void>();

  const setStatus = (next: WsStatus): void => {
    if (status === next) return;
    status = next;
    for (const fn of statusFns) fn(next);
  };

  const clearTimers = (): void => {
    if (retryTimer !== null) env.clearTimeout(retryTimer);
    if (silenceTimer !== null) env.clearTimeout(silenceTimer);
    retryTimer = null;
    silenceTimer = null;
  };

  const detach = (): void => {
    const s = socket;
    socket = null;
    if (s === null) return;
    s.onopen = null;
    s.onmessage = null;
    s.onclose = null;
    s.onerror = null;
    if (s.readyState === s.CONNECTING || s.readyState === s.OPEN) s.close();
  };

  const scheduleRetry = (delayMs: number): void => {
    clearTimers();
    if (!env.isOnline()) {
      setStatus("offline");
      return;
    }
    setStatus("reconnecting");
    retryTimer = env.setTimeout(() => {
      retryTimer = null;
      open();
    }, delayMs);
  };

  const armSilence = (): void => {
    if (silenceTimer !== null) env.clearTimeout(silenceTimer);
    silenceTimer = env.setTimeout(() => {
      silenceTimer = null;
      // 15 с без сообщений — соединение мёртвое (API §9.4).
      detach();
      scheduleRetry(reconnectDelay(attempt++, env.random()));
    }, SILENCE_TIMEOUT_MS);
  };

  const onClose = (code: number): void => {
    detach();
    clearTimers();
    switch (code) {
      case 4001:
        for (const fn of sessionFns) fn();
        attempt = 0;
        open();
        return;
      case 4002:
        if (env.storage?.getItem(OUTDATED_RELOAD_KEY) === null) {
          env.storage.setItem(OUTDATED_RELOAD_KEY, "1");
          env.reload();
          return;
        }
        setStatus("outdated");
        return;
      case 4003:
        setStatus("too-many-tabs");
        return;
      case 1008:
        scheduleRetry(RATE_LIMIT_RECONNECT_MS);
        return;
      default:
        scheduleRetry(reconnectDelay(attempt++, env.random()));
    }
  };

  const open = (): void => {
    detach();
    if (!env.isOnline()) {
      setStatus("offline");
      return;
    }
    if (status !== "reconnecting") setStatus("connecting");
    const s = env.createSocket(env.url);
    socket = s;
    s.onopen = () => armSilence();
    s.onmessage = (event: MessageEvent) => {
      armSilence();
      let raw: unknown;
      try {
        raw = JSON.parse(String(event.data));
      } catch {
        return;
      }
      // MUST: ответ на ping — прямо в обработчике (API §9.4).
      if (typeof raw === "object" && raw !== null && (raw as { type?: unknown }).type === "ping") {
        const n = (raw as { n?: unknown }).n;
        if (typeof n === "number") s.send(JSON.stringify({ type: "pong", n }));
        return;
      }
      const parsed = ServerMessage.safeParse(raw);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === "welcome") {
        attempt = 0;
        env.storage?.removeItem(OUTDATED_RELOAD_KEY);
        setStatus("open");
        for (const fn of welcomeFns) fn();
        return;
      }
      if (message.type === "session.closed") return;
      for (const fn of messageFns) fn(message);
    };
    s.onclose = (event: CloseEvent) => {
      if (socket === s) onClose(event.code);
    };
  };

  env.onOnline(() => {
    if (started && status === "offline") open();
  });

  const subscribe = <F>(set: Set<F>, fn: F): (() => void) => {
    set.add(fn);
    return () => set.delete(fn);
  };

  return {
    get status() {
      return status;
    },
    start() {
      if (started) return;
      started = true;
      open();
    },
    send(message) {
      if (socket === null || status !== "open" || socket.readyState !== socket.OPEN) return false;
      socket.send(JSON.stringify(message));
      return true;
    },
    onMessage: (fn) => subscribe(messageFns, fn),
    onStatus: (fn) => subscribe(statusFns, fn),
    onWelcome: (fn) => subscribe(welcomeFns, fn),
    onSessionClosed: (fn) => subscribe(sessionFns, fn),
    reconnect() {
      started = true;
      attempt = 0;
      clearTimers();
      setStatus("connecting");
      open();
    },
    close() {
      started = false;
      clearTimers();
      detach();
    },
  };
}
