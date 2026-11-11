// /ws и Session (SECURITY S6, §5; ARCHITECTURE §9.1 п.9; API §10, код 4001).
import { afterEach, describe, expect, it } from "vitest";
import { startApp, type TestApp } from "../../test/support/app.ts";
import { createPlayer } from "../../test/support/factories.ts";
import { rest } from "../../test/support/rest.ts";
import { deleteSessionById } from "../../test/support/sessions.ts";
import { advanceLive, closeAllWs, connectWelcomed as connect, type WsOptions } from "../../test/support/ws.ts";

const connectWelcomed = (a: TestApp, options: WsOptions = {}) => connect(a, { autoPong: true, ...options });

const WALL = new Date("2026-11-11T12:00:00.000Z");
const SECOND = 1_000;

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

describe("realtime: Session открытых соединений", () => {
  it("К-9: «Выйти» → session.closed и 4001 у соединений этой Session; другая Session того же User живёт", async () => {
    const a = await app();
    const player = await createPlayer(a.db, { now: WALL });
    const second = await a.auth.createSession(player.user_id);
    const { client: mine } = await connectWelcomed(a, { cookie: player.cookie });
    const { client: other } = await connectWelcomed(a, { cookie: `__Host-sid=${second.token}` });

    expect((await rest(a.url, player.cookie).post("/api/auth/logout")).status).toBe(204);

    expect(await mine.next("session.closed")).toEqual({ type: "session.closed" });
    expect((await mine.closed()).code).toBe(4001);
    expect(mine.received.map((m) => m.type)).toEqual(["welcome", "session.closed"]);
    expect(other.isOpen()).toBe(true);
  });

  it("К-9: «Выйти со всех устройств» → закрыты все соединения User; гость не задет", async () => {
    const a = await app();
    const player = await createPlayer(a.db, { now: WALL });
    const second = await a.auth.createSession(player.user_id);
    const { client: one } = await connectWelcomed(a, { cookie: player.cookie });
    const { client: two } = await connectWelcomed(a, { cookie: `__Host-sid=${second.token}` });
    const { client: guest } = await connectWelcomed(a);

    expect((await rest(a.url, player.cookie).post("/api/auth/logout-all")).status).toBe(204);

    expect((await one.closed()).code).toBe(4001);
    expect((await two.closed()).code).toBe(4001);
    expect(guest.isOpen()).toBe(true);
  });

  it("К-9: Session удалена в обход auth (скрипт) → закрытие на перепроверке через 60 с, не раньше", async () => {
    const a = await app();
    const player = await createPlayer(a.db, { now: WALL });
    const kept = await createPlayer(a.db, { now: WALL });
    const { client } = await connectWelcomed(a, { cookie: player.cookie });
    const { client: keptClient } = await connectWelcomed(a, { cookie: kept.cookie });
    await deleteSessionById(a.db, player.session_id!);

    await advanceLive(a, 59 * SECOND);
    await new Promise((r) => setTimeout(r, 100));
    expect(client.received.some((m) => m.type === "session.closed")).toBe(false);

    await advanceLive(a, 1 * SECOND);
    expect(await client.next("session.closed")).toEqual({ type: "session.closed" });
    expect((await client.closed()).code).toBe(4001);
    expect(keptClient.received.some((m) => m.type === "session.closed")).toBe(false);
  });

  it("К-9: закрытие в момент expires_at, когда срок наступает между перепроверками", async () => {
    const a = await app();
    const player = await createPlayer(a.db, { now: WALL, sessionExpiresAt: new Date(WALL.getTime() + 90 * SECOND) });
    const { client } = await connectWelcomed(a, { cookie: player.cookie });

    await advanceLive(a, 60 * SECOND); // перепроверка: жива, истекает через 30 с — таймер
    await new Promise((r) => setTimeout(r, 100));
    await advanceLive(a, 30 * SECOND - 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(client.isOpen()).toBe(true);
    await a.time.advance(1);
    expect(await client.next("session.closed")).toEqual({ type: "session.closed" });
    expect((await client.closed()).code).toBe(4001);
  });

  it("К-9: Session истекает до первой перепроверки — таймер ставится при подключении", async () => {
    const a = await app();
    const player = await createPlayer(a.db, { now: WALL, sessionExpiresAt: new Date(WALL.getTime() + 10 * SECOND) });
    const { client } = await connectWelcomed(a, { cookie: player.cookie });
    await a.time.advance(10 * SECOND);
    expect((await client.closed()).code).toBe(4001);
  });

  it("К-9: перепроверка не трогает гостя и живые Session", async () => {
    const a = await app();
    const player = await createPlayer(a.db, { now: WALL });
    const { client: guest } = await connectWelcomed(a);
    const { client: alive } = await connectWelcomed(a, { cookie: player.cookie });
    await advanceLive(a, 60 * SECOND);
    await new Promise((r) => setTimeout(r, 100));
    expect(guest.isOpen()).toBe(true);
    expect(alive.isOpen()).toBe(true);
  });
});
