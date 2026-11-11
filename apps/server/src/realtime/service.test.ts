// realtime.service без сети: регистрация обработчиков и медленный клиент (ADR-0005 п.8; API §10).
import type { FastifyBaseLogger } from "fastify";
import { describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { ManualTimeSource } from "../../test/support/time.ts";
import type { AuthService } from "../auth/service.ts";
import { createMetrics } from "../platform/metrics.ts";
import { createRealtimeService, SEND_BUFFER_LIMIT_BYTES, SHUTDOWN_GRACE_MS } from "./service.ts";

const silentLog = { error: () => undefined, warn: () => undefined, info: () => undefined } as unknown as FastifyBaseLogger;

const authStub = {
  onSessionsClosed: () => () => undefined,
  connectionInfo: () => Promise.resolve(null),
  sessionExpiries: () => Promise.resolve(new Map()),
} as unknown as AuthService;

function service(time = new ManualTimeSource()) {
  return createRealtimeService({
    time,
    log: silentLog,
    metrics: createMetrics({ config: null, version: "test" }),
    auth: authStub,
  });
}

/** Сокет, который сам не закрывается: close() только запоминает код (полуоткрытый TCP). */
class FakeSocket {
  readonly CLOSED = 3;
  readyState = 1;
  bufferedAmount = 0;
  sent: string[] = [];
  closedWith: number | null = null;
  terminated = false;
  private readonly closeListeners: (() => void)[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
  close(code: number): void {
    this.closedWith = code;
  }
  terminate(): void {
    this.terminated = true;
    this.readyState = this.CLOSED;
    for (const l of this.closeListeners.splice(0)) l();
  }
  /** Клиент ответил на close. */
  finishClose(): void {
    this.readyState = this.CLOSED;
    for (const l of this.closeListeners.splice(0)) l();
  }
  on(): this {
    return this;
  }
  once(event: string, fn: () => void): this {
    if (event === "close") this.closeListeners.push(fn);
    return this;
  }
}

const GUEST_ACCEPT = { caller: { who: "guest" } as const, ip: "127.0.0.1", protocol_version: "1" };

describe("realtime.registerHandlers", () => {
  it("К-6: два обработчика одного type — ошибка при старте", () => {
    const svc = service();
    const handler = () => Promise.resolve();
    svc.registerHandlers({ "game.subscribe": handler });
    expect(() => svc.registerHandlers({ "game.subscribe": handler })).toThrow(/duplicate game\.subscribe/);
  });

  it("К-6: pong обрабатывает сам шлюз — обработчик модуля для него — ошибка", () => {
    expect(() => service().registerHandlers({ pong: () => Promise.resolve() })).toThrow(/pong/);
  });
});

describe("realtime: медленный клиент", () => {
  it("К-10: буфер отправки больше 1 МБ → закрытие 1011 вместо отправки", async () => {
    const svc = service();
    const socket = new FakeSocket();
    socket.bufferedAmount = SEND_BUFFER_LIMIT_BYTES + 1;
    svc.accept(socket as unknown as WebSocket, { caller: { who: "guest" }, ip: "127.0.0.1", protocol_version: "1" });
    await new Promise((r) => setTimeout(r, 0));
    expect(socket.sent).toEqual([]);
    expect(socket.closedWith).toBe(1011);
  });

  it("К-10: буфер в пределах — welcome отправлен", async () => {
    const svc = service();
    const socket = new FakeSocket();
    socket.bufferedAmount = SEND_BUFFER_LIMIT_BYTES;
    svc.accept(socket as unknown as WebSocket, { caller: { who: "guest" }, ip: "127.0.0.1", protocol_version: "1" });
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({ type: "welcome", user: null });
    expect(socket.closedWith).toBeNull();
  });
});

describe("realtime: остановка", () => {
  it("К-10: closeAll — 1012; клиент не закрылся за SHUTDOWN_GRACE_MS — terminate, остановка не висит", async () => {
    const time = new ManualTimeSource();
    const svc = service(time);
    const silent = new FakeSocket();
    const polite = new FakeSocket();
    svc.accept(silent as unknown as WebSocket, GUEST_ACCEPT);
    svc.accept(polite as unknown as WebSocket, GUEST_ACCEPT);
    let finished = false;
    const closing = svc.closeAll().then(() => {
      finished = true;
    });
    expect(silent.closedWith).toBe(1012);
    expect(polite.closedWith).toBe(1012);
    polite.finishClose();
    await time.advance(SHUTDOWN_GRACE_MS - 1);
    expect(finished).toBe(false);
    expect(silent.terminated).toBe(false);
    await time.advance(1);
    await closing;
    expect(silent.terminated).toBe(true);
    expect(polite.terminated).toBe(false);
  });

  it("К-10: все закрылись сами — closeAll завершается без ожидания таймера", async () => {
    const time = new ManualTimeSource();
    const svc = service(time);
    const socket = new FakeSocket();
    svc.accept(socket as unknown as WebSocket, GUEST_ACCEPT);
    const closing = svc.closeAll();
    socket.finishClose();
    await closing;
    expect(socket.terminated).toBe(false);
    expect(time.pendingTimers()).toBe(0);
  });
});
