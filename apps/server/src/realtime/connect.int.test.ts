// /ws: upgrade, версия, welcome, лимит соединений, онлайн (API §8.1, §10; SECURITY §6, §9; OPERATIONS §12.2).
import { PROTOCOL_VERSION, ServerMessage } from "@chezz/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { startApp, type TestApp } from "../../test/support/app.ts";
import { createPlayer } from "../../test/support/factories.ts";
import { rest } from "../../test/support/rest.ts";
import { closeAllWs, connectWelcomed, connectWs, type WsClient } from "../../test/support/ws.ts";

const WALL = new Date("2026-11-11T12:00:00.000Z");

const apps: TestApp[] = [];
afterEach(async () => {
  closeAllWs();
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function app(config: Parameters<typeof startApp>[0] = {}): Promise<TestApp> {
  const a = await startApp({ time: { wall: WALL }, ...config });
  apps.push(a);
  return a;
}

async function refused(promise: Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await promise;
  } catch (err) {
    return err as { status: number; body: unknown };
  }
  throw new Error("upgrade was accepted");
}

async function online(a: TestApp): Promise<number> {
  const body = await (await fetch(`${a.metricsUrl}/metrics`)).text();
  const match = /^chezz_players_online (\d+)$/m.exec(body);
  if (match === null) throw new Error("no chezz_players_online");
  return Number(match[1]);
}

/** Онлайн обновляется после события close на сервере — ждём, а не спим. */
async function eventually(probe: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return;
    if (Date.now() > until) throw new Error("condition not met");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("realtime: подключение", () => {
  it("К-1: чужой Origin и нет Origin → 403 origin_forbidden, соединения нет", async () => {
    const a = await app();
    const player = await createPlayer(a.db, { now: WALL });
    for (const origin of ["https://evil.example", null]) {
      const res = await refused(connectWs(a, { origin, cookie: player.cookie }));
      expect(res.status, String(origin)).toBe(403);
      expect((res.body as { error: { code: string } }).error.code).toBe("origin_forbidden");
    }
    expect(await online(a)).toBe(0);
  });

  it("К-1: Origin проверяется до Session — с чужим Origin Session не читается (нет user_active)", async () => {
    const a = await app();
    const player = await createPlayer(a.db, { now: WALL });
    await refused(connectWs(a, { origin: "https://evil.example", cookie: player.cookie }));
    await a.analytics.drain();
    const { listAnalyticsEvents } = await import("../../test/support/analytics.ts");
    expect((await listAnalyticsEvents()).filter((e) => e.name === "user_active")).toHaveLength(0);
  });

  it("К-1: upgrade на другой путь с чужим Origin — тоже 403, Session не читается", async () => {
    const a = await app();
    const player = await createPlayer(a.db, { now: WALL });
    const { default: WebSocket } = await import("ws");
    const status = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(`${a.url.replace("http", "ws")}/api/me`, {
        headers: { Origin: "https://evil.example", Cookie: player.cookie! },
      });
      socket.once("unexpected-response", (_req, res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      socket.once("open", () => {
        socket.terminate();
        reject(new Error("upgrade accepted"));
      });
      socket.once("error", reject);
    });
    expect(status).toBe(403);
  });

  it("К-1: upgrade — в общем счётчике REST: 299 REST + upgrade проходят, следующий запрос — 429", async () => {
    const a = await app();
    const client = rest(a.url);
    for (let i = 0; i < 299; i++) expect((await client.get("/api/me")).status).toBe(200);
    const ws = await connectWs(a);
    ws.close();
    expect((await client.get("/api/me")).status).toBe(429);
    const res = await refused(connectWs(a));
    expect(res.status).toBe(429);
    expect((res.body as { error: { code: string } }).error.code).toBe("rate_limited");
  });

  it("К-2: protocol_version другой или нет → error client_outdated и закрытие 4002", async () => {
    const a = await app();
    for (const protocolVersion of [String(PROTOCOL_VERSION + 1), null, "abc"]) {
      const ws = await connectWs(a, { protocolVersion });
      const error = await ws.next("error");
      expect(error, String(protocolVersion)).toMatchObject({ type: "error", code: "client_outdated", ref: null });
      expect((await ws.closed()).code).toBe(4002);
      expect(ws.received.map((m) => m.type)).toEqual(["error"]);
    }
  });

  it("К-3: welcome гостя — user null, ping_interval_ms 5000", async () => {
    const a = await app();
    const { welcome } = await connectWelcomed(a);
    expect(ServerMessage.parse(welcome)).toEqual({
      type: "welcome",
      protocol_version: PROTOCOL_VERSION,
      user: null,
      ping_interval_ms: 5_000,
    });
  });

  it("К-3: welcome Игрока и П1 — {id, nickname}, у П1 nickname null", async () => {
    const a = await app();
    const player = await createPlayer(a.db, { now: WALL });
    const p1 = await createPlayer(a.db, { nickname: null, now: WALL });
    expect((await connectWelcomed(a, { cookie: player.cookie })).welcome).toMatchObject({
      user: { id: player.user_id, nickname: player.nickname },
    });
    expect((await connectWelcomed(a, { cookie: p1.cookie })).welcome).toMatchObject({ user: { id: p1.user_id, nickname: null } });
  });

  it("К-3: недействительная cookie — соединение гостя", async () => {
    const a = await app();
    const { welcome } = await connectWelcomed(a, { cookie: "__Host-sid=nonsense" });
    expect(welcome["user"]).toBeNull();
  });

  it("К-4: 6-е соединение User → too_many_connections и 4003; прежние пять живы", async () => {
    const a = await app();
    const player = await createPlayer(a.db, { now: WALL });
    const five: WsClient[] = [];
    for (let i = 0; i < 5; i++) five.push((await connectWelcomed(a, { cookie: player.cookie })).client);
    const sixth = await connectWs(a, { cookie: player.cookie });
    expect(await sixth.next("error")).toMatchObject({ code: "too_many_connections" });
    expect((await sixth.closed()).code).toBe(4003);
    expect(five.every((c) => c.isOpen())).toBe(true);

    // Освободилось место — снова можно.
    five[0]!.close();
    await five[0]!.closed();
    await eventually(async () => (await online(a)) === 1);
    const again = await connectWs(a, { cookie: player.cookie });
    expect((await again.next()).type).toBe("welcome");
  });

  it("К-4: две Session одного User делят лимит; другой User не задет", async () => {
    const a = await app();
    const player = await createPlayer(a.db, { now: WALL });
    const second = await a.auth.createSession(player.user_id);
    const cookie2 = `__Host-sid=${second.token}`;
    for (let i = 0; i < 3; i++) await connectWelcomed(a, { cookie: player.cookie });
    for (let i = 0; i < 2; i++) await connectWelcomed(a, { cookie: cookie2 });
    const extra = await connectWs(a, { cookie: cookie2 });
    expect(await extra.next()).toMatchObject({ type: "error", code: "too_many_connections" });

    const other = await createPlayer(a.db, { now: WALL });
    expect((await connectWelcomed(a, { cookie: other.cookie })).welcome["type"]).toBe("welcome");
  });

  it("К-4: 51-е соединение без Session с одного IP → 4003", async () => {
    const a = await app();
    for (let i = 0; i < 50; i++) await connectWelcomed(a);
    const extra = await connectWs(a);
    expect(await extra.next()).toMatchObject({ type: "error", code: "too_many_connections" });
    expect((await extra.closed()).code).toBe(4003);
    // Игрок с того же IP считается по User.
    const player = await createPlayer(a.db, { now: WALL });
    expect((await connectWelcomed(a, { cookie: player.cookie })).welcome["type"]).toBe("welcome");
  });

  it("К-10: chezz_players_online — разные User (П1 входит, гость нет), падает при закрытии", async () => {
    const a = await app();
    expect(await online(a)).toBe(0);
    const player = await createPlayer(a.db, { now: WALL });
    const p1 = await createPlayer(a.db, { nickname: null, now: WALL });
    const one = (await connectWelcomed(a, { cookie: player.cookie })).client;
    const two = (await connectWelcomed(a, { cookie: player.cookie })).client;
    await connectWelcomed(a, { cookie: p1.cookie });
    await connectWelcomed(a);
    expect(await online(a)).toBe(2);

    one.close();
    two.close();
    await eventually(async () => (await online(a)) === 1);
  });
});
