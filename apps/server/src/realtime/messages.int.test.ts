// /ws: разбор сообщений, token bucket, ping/pong, остановка app (API §8.2, §9.4, §10; SECURITY §9).
import { afterEach, describe, expect, it } from "vitest";
import { startApp, type TestApp } from "../../test/support/app.ts";
import { createPlayer } from "../../test/support/factories.ts";
import { closeAllWs, connectWelcomed, type WsClient } from "../../test/support/ws.ts";

const WALL = new Date("2026-11-11T12:00:00.000Z");

const apps: TestApp[] = [];
afterEach(async () => {
  closeAllWs();
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function app(): Promise<TestApp> {
  const a = await startApp({ time: { wall: WALL } });
  apps.push(a);
  return a;
}

/** Сервер обработал всё отправленное: pong с чужим n ответа не даёт, поэтому — «эхо» через ошибку разбора. */
async function settle(client: WsClient): Promise<void> {
  client.send({ type: "sync.marker", ref: "sync" });
  for (;;) {
    const m = await client.next("error");
    if (m["ref"] === "sync") return;
  }
}

describe("realtime: сообщения", () => {
  it("К-5: невалидный JSON → validation_failed (ref null, rule json); соединение живёт", async () => {
    const a = await app();
    const { client } = await connectWelcomed(a);
    client.send("{not json");
    expect(await client.next("error")).toEqual({
      type: "error",
      ref: null,
      code: "validation_failed",
      game_id: null,
      details: { issues: [{ path: "", rule: "json" }] },
    });
    await settle(client);
    expect(client.isOpen()).toBe(true);
  });

  it("К-5: незнакомый type и лишнее поле → validation_failed с ref команды", async () => {
    const a = await app();
    const { client } = await connectWelcomed(a);
    client.send({ type: "game.move", ref: "m42", game_id: "9a1c", ply: 0, uci: "e2e4" });
    expect(await client.next("error")).toMatchObject({ ref: "m42", code: "validation_failed" });
    client.send({ type: "pong", ref: "p1", n: 0, extra: 1 });
    const error = await client.next("error");
    expect(error).toMatchObject({ ref: "p1", code: "validation_failed" });
    expect((error["details"] as { issues: { rule: string }[] }).issues).toContainEqual({ path: "extra", rule: "unknown_key" });
    expect(client.isOpen()).toBe(true);
  });

  it("К-5: ref длиннее 16 в ответ не возвращается", async () => {
    const a = await app();
    const { client } = await connectWelcomed(a);
    client.send({ type: "nope", ref: "x".repeat(17) });
    expect(await client.next("error")).toMatchObject({ ref: null, code: "validation_failed" });
  });

  it("К-5: сообщение больше 4 КБ → соединение закрыто (1009)", async () => {
    const a = await app();
    const { client } = await connectWelcomed(a);
    client.send(JSON.stringify({ type: "pong", n: 0, ref: "a", pad: "x".repeat(4_200) }));
    expect((await client.closed()).code).toBe(1009);
  });

  it("К-7: пачка 21 сообщения — одно rate_limited (21-е), остальные приняты", async () => {
    const a = await app();
    const { client } = await connectWelcomed(a);
    for (let i = 0; i < 21; i++) client.send({ type: "pong", n: 1_000 + i });
    const error = await client.next("error");
    expect(error).toMatchObject({ code: "rate_limited", ref: null });
    expect((error["details"] as { retry_after_ms: number }).retry_after_ms).toBeGreaterThan(0);
    await a.time.advance(1_000);
    await settle(client);
    expect(client.received.filter((m) => m["code"] === "rate_limited")).toHaveLength(1);
  });

  it("К-7: флуд дольше 10 с → закрытие 1008; другое соединение того же игрока не задето", async () => {
    const a = await app();
    const player = await createPlayer(a.db, { now: WALL });
    const { client: bot } = await connectWelcomed(a, { cookie: player.cookie });
    const { client: other } = await connectWelcomed(a, { cookie: player.cookie });
    let rejected = 0;
    const waitRejected = async (count: number): Promise<void> => {
      while (rejected < count) {
        const m = await bot.next("error");
        if (m["code"] === "rate_limited") rejected++;
      }
    };
    for (let i = 0; i < 25; i++) bot.send({ type: "pong", n: 1_000 });
    await waitRejected(5);
    // 30 сообщений/с при пополнении 10/с: отказы не прекращаются.
    for (let t = 0; t < 120 && bot.isOpen(); t++) {
      await a.time.advance(100);
      for (let i = 0; i < 3; i++) bot.send({ type: "pong", n: 1_000 });
      if (t * 100 < 10_000) await waitRejected(rejected + 2);
      else await new Promise((r) => setTimeout(r, 10));
    }
    expect((await bot.closed()).code).toBe(1008);
    expect(other.isOpen()).toBe(true);
    await settle(other);
    expect(other.received.some((m) => m["code"] === "rate_limited")).toBe(false);
  });

  it("К-8: ping раз в 5 с с растущим n; с ответами соединение живёт", async () => {
    const a = await app();
    const { client } = await connectWelcomed(a);
    for (let i = 0; i < 5; i++) {
      await a.time.advance(5_000);
      const ping = await client.next("ping");
      expect(ping).toEqual({ type: "ping", n: i });
      client.send({ type: "pong", n: ping["n"] });
      await settle(client);
    }
    expect(client.isOpen()).toBe(true);
  });

  it("К-8: 3 ping без pong → сервер закрывает соединение; pong с чужим n не спасает", async () => {
    const a = await app();
    const { client } = await connectWelcomed(a);
    for (let i = 0; i < 3; i++) {
      await a.time.advance(5_000);
      const ping = await client.next("ping");
      client.send({ type: "pong", n: (ping["n"] as number) + 100 });
      await settle(client);
    }
    expect(client.isOpen()).toBe(true);
    await a.time.advance(5_000);
    expect((await client.closed()).code).toBe(1006);
  });

  it("К-10: остановка app → 1012 всем соединениям", async () => {
    const a = await app();
    const player = await createPlayer(a.db, { now: WALL });
    const { client: guest } = await connectWelcomed(a);
    const { client: pl } = await connectWelcomed(a, { cookie: player.cookie });
    await a.shutdown();
    expect((await guest.closed()).code).toBe(1012);
    expect((await pl.closed()).code).toBe(1012);
  });
});
