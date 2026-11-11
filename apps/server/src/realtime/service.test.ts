// realtime.service без сети: регистрация обработчиков и медленный клиент (ADR-0005 п.8; API §10).
import type { FastifyBaseLogger } from "fastify";
import { describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { ManualTimeSource } from "../../test/support/time.ts";
import type { AuthService } from "../auth/service.ts";
import { createMetrics } from "../platform/metrics.ts";
import { createRealtimeService, SEND_BUFFER_LIMIT_BYTES } from "./service.ts";

const silentLog = { error: () => undefined, warn: () => undefined, info: () => undefined } as unknown as FastifyBaseLogger;

const authStub = {
  onSessionsClosed: () => () => undefined,
  connectionInfo: () => Promise.resolve(null),
  sessionExpiries: () => Promise.resolve(new Map()),
} as unknown as AuthService;

function service() {
  return createRealtimeService({
    time: new ManualTimeSource(),
    log: silentLog,
    metrics: createMetrics({ config: null, version: "test" }),
    auth: authStub,
  });
}

class FakeSocket {
  bufferedAmount = 0;
  sent: string[] = [];
  closedWith: number | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(code: number): void {
    this.closedWith = code;
  }
  terminate(): void {
    this.closedWith = -1;
  }
  on(): this {
    return this;
  }
}

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
