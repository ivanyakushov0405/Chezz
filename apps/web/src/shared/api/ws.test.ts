// Клиент WebSocket (API §9.4, §10; DESIGN §10.2): фейковый сокет и таймеры окружения.
import { PROTOCOL_VERSION } from "@chezz/protocol";
import { describe, expect, it } from "vitest";
import { createWsClient, OUTDATED_RELOAD_KEY, reconnectDelay, SILENCE_TIMEOUT_MS, wsUrl, type WsEnvironment, type WsStatus } from "./ws.ts";

class FakeSocket {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = 0;
  readonly sent: unknown[] = [];
  closedByClient = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.closedByClient = true;
    this.readyState = 3;
  }
  serverOpen(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  serverClose(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

function setup(opts: { online?: boolean; storage?: Map<string, string> } = {}) {
  const sockets: FakeSocket[] = [];
  const timers = new Map<number, { at: number; fn: () => void }>();
  let now = 0;
  let seq = 0;
  let online = opts.online ?? true;
  const onlineFns: (() => void)[] = [];
  let reloads = 0;
  const store = opts.storage ?? new Map<string, string>();
  const env: WsEnvironment = {
    url: "ws://test/ws",
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s as unknown as WebSocket;
    },
    setTimeout: (fn, ms) => {
      timers.set(++seq, { at: now + ms, fn });
      return seq;
    },
    clearTimeout: (id) => void timers.delete(id),
    random: () => 0,
    isOnline: () => online,
    onOnline: (fn) => void onlineFns.push(fn),
    reload: () => void reloads++,
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    },
  };
  const client = createWsClient(env);
  const statuses: WsStatus[] = [];
  client.onStatus((s) => statuses.push(s));
  const advance = (ms: number): void => {
    const until = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = until;
  };
  const last = (): FakeSocket => sockets[sockets.length - 1]!;
  const welcome = (s = last()): void => {
    s.serverOpen();
    s.receive({ type: "welcome", protocol_version: PROTOCOL_VERSION, user: null, ping_interval_ms: 5_000 });
  };
  return {
    client,
    sockets,
    statuses,
    advance,
    last,
    welcome,
    store,
    reloads: () => reloads,
    goOnline: () => {
      online = true;
      for (const fn of onlineFns) fn();
    },
    goOffline: () => {
      online = false;
    },
  };
}

describe("ws: подключение", () => {
  it("К-10: адрес — /ws с protocol_version, wss на https", () => {
    expect(wsUrl({ protocol: "https:", host: "chezz.example" })).toBe(`wss://chezz.example/ws?protocol_version=${PROTOCOL_VERSION}`);
    expect(wsUrl({ protocol: "http:", host: "localhost:5173" })).toBe(`ws://localhost:5173/ws?protocol_version=${PROTOCOL_VERSION}`);
  });

  it("К-10: open — только после welcome; welcome зовёт onWelcome", () => {
    const t = setup();
    let welcomes = 0;
    t.client.onWelcome(() => welcomes++);
    t.client.start();
    t.last().serverOpen();
    expect(t.client.status).toBe("connecting");
    t.welcome();
    expect(t.client.status).toBe("open");
    expect(welcomes).toBe(1);
  });

  it("К-10: ping — pong с тем же n сразу в обработчике, подписчикам ping не уходит", () => {
    const t = setup();
    const got: string[] = [];
    t.client.onMessage((m) => got.push(m.type));
    t.client.start();
    t.welcome();
    t.last().receive({ type: "ping", n: 7 });
    expect(t.last().sent).toEqual([{ type: "pong", n: 7 }]);
    expect(got).toEqual([]);
  });

  it("К-10: незнакомое сообщение и битый JSON игнорируются", () => {
    const t = setup();
    const got: string[] = [];
    t.client.onMessage((m) => got.push(m.type));
    t.client.start();
    t.welcome();
    t.last().receive({ type: "future.thing" });
    t.last().onmessage?.({ data: "{oops" });
    expect(got).toEqual([]);
    expect(t.client.status).toBe("open");
  });

  it("К-10: send до welcome и во время переподключения — false, команда не копится и не повторяется", () => {
    const t = setup();
    t.client.start();
    const move = { type: "game.move", ref: "r1", game_id: "33333333-3333-4333-8333-333333333333", ply: 0, uci: "e2e4" } as const;
    expect(t.client.send(move)).toBe(false);
    t.welcome();
    expect(t.client.send(move)).toBe(true);
    t.last().serverClose(1011);
    expect(t.client.send(move)).toBe(false);
    t.advance(500);
    t.welcome();
    expect(t.sockets[0]!.sent).toEqual([move]);
    expect(t.last().sent).toEqual([]);
  });
});

describe("ws: переподключение (API §10, P22)", () => {
  it("К-10: паузы 0,5/1/2/4/5 с и дальше 5 с, разброс до 30%", () => {
    expect([0, 1, 2, 3, 4, 9].map((a) => reconnectDelay(a, 0))).toEqual([500, 1_000, 2_000, 4_000, 5_000, 5_000]);
    expect(reconnectDelay(0, 1)).toBe(650);
  });

  it("К-10: 1011 и 1012 — reconnecting, новые попытки по паузам; welcome сбрасывает счётчик", () => {
    const t = setup();
    t.client.start();
    t.welcome();
    t.last().serverClose(1012);
    expect(t.client.status).toBe("reconnecting");
    t.advance(499);
    expect(t.sockets).toHaveLength(1);
    t.advance(1);
    expect(t.sockets).toHaveLength(2);
    t.last().serverClose(1011);
    t.advance(999);
    expect(t.sockets).toHaveLength(2);
    t.advance(1);
    expect(t.sockets).toHaveLength(3);
    t.welcome();
    expect(t.client.status).toBe("open");
    t.last().serverClose(1011);
    t.advance(500);
    expect(t.sockets).toHaveLength(4);
  });

  it("К-10: 1008 — повтор через 5 с", () => {
    const t = setup();
    t.client.start();
    t.welcome();
    t.last().serverClose(1008);
    t.advance(4_999);
    expect(t.sockets).toHaveLength(1);
    t.advance(1);
    expect(t.sockets).toHaveLength(2);
  });

  it("К-10: 15 с без сообщений — соединение мёртвое, переподключение; сообщения продлевают срок", () => {
    const t = setup();
    t.client.start();
    t.welcome();
    t.advance(SILENCE_TIMEOUT_MS - 1);
    t.last().receive({ type: "ping", n: 1 });
    t.advance(SILENCE_TIMEOUT_MS - 1);
    expect(t.client.status).toBe("open");
    t.advance(1);
    expect(t.client.status).toBe("reconnecting");
    expect(t.sockets[0]!.closedByClient).toBe(true);
    t.advance(500);
    expect(t.sockets).toHaveLength(2);
  });

  it("К-10: после переподключения — снова onWelcome (повтор подписки)", () => {
    const t = setup();
    let welcomes = 0;
    t.client.onWelcome(() => welcomes++);
    t.client.start();
    t.welcome();
    t.last().serverClose(1011);
    t.advance(500);
    t.welcome();
    expect(welcomes).toBe(2);
  });

  it("К-10: 4001 — onSessionClosed и сразу новое соединение (гостем)", () => {
    const t = setup();
    let closed = 0;
    t.client.onSessionClosed(() => closed++);
    t.client.start();
    t.welcome();
    t.last().serverClose(4001);
    expect(closed).toBe(1);
    expect(t.sockets).toHaveLength(2);
    expect(t.client.status).toBe("connecting");
  });

  it("К-10: 4002 — один раз перезагрузить страницу, снова 4002 — outdated без повторов", () => {
    const store = new Map<string, string>();
    const first = setup({ storage: store });
    first.client.start();
    first.last().serverClose(4002);
    expect(first.reloads()).toBe(1);
    expect(store.get(OUTDATED_RELOAD_KEY)).toBe("1");

    const second = setup({ storage: store });
    second.client.start();
    second.last().serverClose(4002);
    expect(second.reloads()).toBe(0);
    expect(second.client.status).toBe("outdated");
    second.advance(60_000);
    expect(second.sockets).toHaveLength(1);
  });

  it("К-10: welcome снимает флаг перезагрузки 4002", () => {
    const store = new Map([[OUTDATED_RELOAD_KEY, "1"]]);
    const t = setup({ storage: store });
    t.client.start();
    t.welcome();
    expect(store.has(OUTDATED_RELOAD_KEY)).toBe(false);
  });

  it("К-10: 4003 — too-many-tabs без авто-повтора; reconnect() — новое соединение", () => {
    const t = setup();
    t.client.start();
    t.welcome();
    t.last().serverClose(4003);
    expect(t.client.status).toBe("too-many-tabs");
    t.advance(60_000);
    expect(t.sockets).toHaveLength(1);
    t.client.reconnect();
    expect(t.sockets).toHaveLength(2);
    expect(t.client.status).toBe("connecting");
  });

  it("К-10: нет сети — offline, попыток нет до события online", () => {
    const t = setup();
    t.client.start();
    t.welcome();
    t.goOffline();
    t.last().serverClose(1006);
    expect(t.client.status).toBe("offline");
    t.advance(60_000);
    expect(t.sockets).toHaveLength(1);
    t.goOnline();
    expect(t.sockets).toHaveLength(2);
    expect(t.statuses).toEqual(["open", "offline", "connecting"]);
  });

  it("К-10: close() — без переподключения", () => {
    const t = setup();
    t.client.start();
    t.welcome();
    t.client.close();
    t.advance(60_000);
    expect(t.sockets).toHaveLength(1);
    expect(t.sockets[0]!.closedByClient).toBe(true);
  });
});
