// games.service.createGame на реальной PostgreSQL (ARCHITECTURE §9.1 п.1, A25, A28) и Me.active_game_id.
import { afterEach, describe, expect, it } from "vitest";
import { listAnalyticsEvents } from "../../test/support/analytics.ts";
import { startApp, type TestApp } from "../../test/support/app.ts";
import { createPlayer } from "../../test/support/factories.ts";
import { listGamesOf, markUserDeleted, readGame } from "../../test/support/games.ts";
import { rest } from "../../test/support/rest.ts";
import { closeAllWs } from "../../test/support/ws.ts";
import { withTransaction } from "../platform/db.ts";
import { GameCreateRefused, type CreateGameInput } from "./service.ts";

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

const blitz = (white_id: string, black_id: string): CreateGameInput => ({ white_id, black_id, time_base: 180, time_increment: 2, rated: true });

async function create(a: TestApp, input: CreateGameInput) {
  const created = await withTransaction(a.db, (trx) => a.games.createGame(trx, input));
  created.started();
  await a.time.advance(0);
  return created;
}

async function refusal(a: TestApp, input: CreateGameInput): Promise<GameCreateRefused> {
  try {
    await create(a, input);
  } catch (err) {
    if (err instanceof GameCreateRefused) return err;
    throw err;
  }
  throw new Error("createGame was not refused");
}

describe("games.createGame", () => {
  it("К-2: active Game с категорией по контролю; game_started по строке на игрока", async () => {
    const a = await app();
    const w = await createPlayer(a.db);
    const b = await createPlayer(a.db);
    const { game_id } = await create(a, blitz(w.user_id, b.user_id));
    const row = await readGame(a.db, game_id);
    expect(row).toMatchObject({ status: "active", category: "blitz", rated: true, result: null, moves: [], started_at: WALL });
    await a.analytics.drain();
    const events = (await listAnalyticsEvents()).filter((e) => e.game_id === game_id);
    expect(events.map((e) => [e.name, e.user_id]).sort()).toEqual(
      [
        ["game_started", w.user_id],
        ["game_started", b.user_id],
      ].sort(),
    );
  });

  it("К-2: у игрока active Game → busy, user_ids — только занятые", async () => {
    const a = await app();
    const [w, b, c] = await Promise.all([createPlayer(a.db), createPlayer(a.db), createPlayer(a.db)]);
    await create(a, blitz(w.user_id, b.user_id));
    const err = await refusal(a, blitz(c.user_id, b.user_id));
    expect(err.reason).toBe("busy");
    expect(err.user_ids).toEqual([b.user_id]);
  });

  it("К-2: удалённый раньше занятого — deleted, в user_ids только удалённые (A28)", async () => {
    const a = await app();
    const [w, b, c] = await Promise.all([createPlayer(a.db), createPlayer(a.db), createPlayer(a.db)]);
    await create(a, blitz(w.user_id, b.user_id));
    await markUserDeleted(a.db, c.user_id);
    const err = await refusal(a, blitz(c.user_id, b.user_id));
    expect(err).toMatchObject({ reason: "deleted", user_ids: [c.user_id] });
  });

  it("К-2: две параллельные createGame одного игрока → одна партия", async () => {
    const a = await app();
    const [w, b, c] = await Promise.all([createPlayer(a.db), createPlayer(a.db), createPlayer(a.db)]);
    const results = await Promise.allSettled([create(a, blitz(w.user_id, b.user_id)), create(a, blitz(c.user_id, w.user_id))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(GameCreateRefused);
    expect((await listGamesOf(a.db, w.user_id)).filter((g) => g.status === "active")).toHaveLength(1);
  });

  it("К-2: откат транзакции вызывающего — партии нет", async () => {
    const a = await app();
    const [w, b] = await Promise.all([createPlayer(a.db), createPlayer(a.db)]);
    await expect(
      withTransaction(a.db, async (trx) => {
        await a.games.createGame(trx, blitz(w.user_id, b.user_id));
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await listGamesOf(a.db, w.user_id)).toHaveLength(0);
  });
});

describe("Me.active_game_id", () => {
  it("К-8: /api/me — id active Game игрока; без партии — null", async () => {
    const a = await app();
    const [w, b, c] = await Promise.all([createPlayer(a.db), createPlayer(a.db), createPlayer(a.db)]);
    const { game_id } = await create(a, blitz(w.user_id, b.user_id));
    const me = async (cookie: string | null) => ((await rest(a.url, cookie).get("/api/me")).body as { user: { active_game_id: string | null } }).user;
    expect((await me(w.cookie)).active_game_id).toBe(game_id);
    expect((await me(b.cookie)).active_game_id).toBe(game_id);
    expect((await me(c.cookie)).active_game_id).toBeNull();
  });
});
