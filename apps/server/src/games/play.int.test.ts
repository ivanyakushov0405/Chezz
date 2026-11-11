// Партия через /ws (API §8.3, §9; ARCHITECTURE §9.1–9.2; SECURITY §7, §8): подписка, ход, часы, флаг, окончания.
import { ChessPosition } from "@chezz/chess";
import { afterEach, describe, expect, it } from "vitest";
import { listAnalyticsEvents } from "../../test/support/analytics.ts";
import { startApp, type TestApp } from "../../test/support/app.ts";
import { createActiveGame, createFinishedGame, createPlayer, type CreatedPlayer } from "../../test/support/factories.ts";
import { readGame } from "../../test/support/games.ts";
import { listRatingHistory } from "../../test/support/ratings.ts";
import { advanceLive, closeAllWs, connectWelcomed, type WsClient, type WsMessage } from "../../test/support/ws.ts";
import { withTransaction } from "../platform/db.ts";

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

interface Table {
  a: TestApp;
  white: CreatedPlayer;
  black: CreatedPlayer;
  game_id: string;
  w: WsClient;
  b: WsClient;
}

async function table(options: { time_base?: number; time_increment?: number; rated?: boolean; autoPong?: boolean } = {}): Promise<Table> {
  const a = await app();
  const [white, black] = await Promise.all([createPlayer(a.db), createPlayer(a.db)]);
  const created = await withTransaction(a.db, (trx) =>
    a.games.createGame(trx, {
      white_id: white.user_id,
      black_id: black.user_id,
      time_base: options.time_base ?? 180,
      time_increment: options.time_increment ?? 2,
      rated: options.rated ?? true,
    }),
  );
  created.started();
  const autoPong = options.autoPong ?? false;
  const w = (await connectWelcomed(a, { cookie: white.cookie, autoPong })).client;
  const b = (await connectWelcomed(a, { cookie: black.cookie, autoPong })).client;
  w.send({ type: "game.subscribe", game_id: created.game_id });
  b.send({ type: "game.subscribe", game_id: created.game_id });
  await w.next("game.state");
  await b.next("game.state");
  return { a, white, black, game_id: created.game_id, w, b };
}

/** Ход и ожидание game.moved у обоих; возвращает сообщение белым. */
async function play(t: Table, by: WsClient, ply: number, uci: string): Promise<WsMessage> {
  by.send({ type: "game.move", ref: `m${ply}`, game_id: t.game_id, ply, uci });
  const moved = await t.w.next("game.moved");
  await t.b.next("game.moved");
  return moved;
}

async function playLine(t: Table, ucis: string[]): Promise<void> {
  for (const [i, uci] of ucis.entries()) await play(t, i % 2 === 0 ? t.w : t.b, i, uci);
}

describe("game.subscribe (К-3)", () => {
  it("К-3: участник получает game.state со своим цветом; часы стоят до 2-го полухода", async () => {
    const t = await table();
    const state = t.w.received.find((m) => m.type === "game.state")!;
    expect(state).toMatchObject({
      game_id: t.game_id,
      your_color: "white",
      clock: { white_ms: 180_000, black_ms: 180_000, running: null },
      draw_offer: null,
      takeback_offer: null,
      connected: { white: true, black: false },
      first_move_ms: null,
      reconnect: null,
      abandonment_choice: null,
      game: {
        id: t.game_id,
        status: "active",
        category: "blitz",
        rated: true,
        moves: [],
        ratings: null,
        white: { id: t.white.user_id, nickname: t.white.nickname, rating: 1500, provisional: true },
      },
    });
    expect(t.b.received.find((m) => m.type === "game.state")).toMatchObject({ your_color: "black", connected: { white: true, black: true } });
  });

  it("К-3: гость — зритель (your_color null) и получает ходы", async () => {
    const t = await table();
    const g = (await connectWelcomed(t.a)).client;
    g.send({ type: "game.subscribe", game_id: t.game_id });
    expect(await g.next("game.state")).toMatchObject({ your_color: null });
    await play(t, t.w, 0, "e2e4");
    expect(await g.next("game.moved")).toMatchObject({ ply: 1, san: "e4" });
  });

  it("К-3: зритель-игрок шлёт ход → not_a_participant, партия не меняется", async () => {
    const t = await table();
    const other = await createPlayer(t.a.db);
    const s = (await connectWelcomed(t.a, { cookie: other.cookie })).client;
    s.send({ type: "game.subscribe", game_id: t.game_id });
    await s.next("game.state");
    s.send({ type: "game.move", ref: "x", game_id: t.game_id, ply: 0, uci: "e2e4" });
    expect(await s.next("error")).toEqual({ type: "error", ref: "x", code: "not_a_participant", game_id: t.game_id, details: null });
    expect((await readGame(t.a.db, t.game_id))?.moves).toEqual([]);
  });

  it("К-3: нет партии → not_found", async () => {
    const t = await table();
    const id = "00000000-0000-4000-8000-000000000000";
    t.w.send({ type: "game.subscribe", ref: "s", game_id: id });
    expect(await t.w.next("error")).toMatchObject({ ref: "s", code: "not_found", game_id: id });
  });

  it("К-3: новый subscribe заменяет прежний; unsubscribe снимает подписку", async () => {
    const t = await table();
    const g = (await connectWelcomed(t.a)).client;
    g.send({ type: "game.subscribe", game_id: t.game_id });
    await g.next("game.state");
    g.send({ type: "game.unsubscribe", game_id: t.game_id });
    await play(t, t.w, 0, "e2e4");
    // Маркер: после него game.moved уже пришёл бы.
    g.send({ type: "game.subscribe", game_id: t.game_id });
    const state = await g.next("game.state");
    expect((state["game"] as { moves: unknown[] }).moves).toHaveLength(1);
    expect(g.received.some((m) => m.type === "game.moved")).toBe(false);
  });

  it("К-3: закрытие соединения снимает подписку (connected)", async () => {
    const t = await table();
    t.b.close();
    await t.b.closed();
    const g = (await connectWelcomed(t.a)).client;
    g.send({ type: "game.subscribe", game_id: t.game_id });
    expect(await g.next("game.state")).toMatchObject({ connected: { white: true, black: false } });
  });

  it("К-3: законченная партия → game.state из БД, часы стоят", async () => {
    const a = await app();
    const [white, black] = await Promise.all([createPlayer(a.db), createPlayer(a.db)]);
    const { game_id } = await createFinishedGame(a.db, {
      white_id: white.user_id,
      black_id: black.user_id,
      rated: false,
      result: "black_wins",
      termination: "checkmate",
      moves: [
        { san: "f3", clock_ms: 182_000 },
        { san: "e5", clock_ms: 182_000 },
        { san: "g4", clock_ms: 170_000 },
        { san: "Qh4#", clock_ms: 175_000 },
      ],
    });
    const g = (await connectWelcomed(a)).client;
    g.send({ type: "game.subscribe", game_id });
    expect(await g.next("game.state")).toMatchObject({
      your_color: null,
      clock: { white_ms: 170_000, black_ms: 175_000, running: null },
      game: { status: "finished", result: "black_wins", termination: "checkmate", ratings: null, white: { rating: null } },
    });
  });

  it("К-3: active Game без комнаты (фабрика) поднимается по подписке; остатки — из moves[]", async () => {
    const a = await app();
    const [white, black] = await Promise.all([createPlayer(a.db), createPlayer(a.db)]);
    const { game_id } = await createActiveGame(a.db, {
      white_id: white.user_id,
      black_id: black.user_id,
      moves: [
        { san: "e4", clock_ms: 182_000 },
        { san: "e5", clock_ms: 182_000 },
        { san: "Nf3", clock_ms: 170_500 },
      ],
    });
    const b = (await connectWelcomed(a, { cookie: black.cookie })).client;
    b.send({ type: "game.subscribe", game_id });
    expect(await b.next("game.state")).toMatchObject({ your_color: "black", clock: { white_ms: 170_500, black_ms: 182_000, running: "black" } });
    b.send({ type: "game.move", game_id, ply: 3, uci: "b8c6" });
    expect(await b.next("game.moved")).toMatchObject({ ply: 4, san: "Nc6" });
  });
});

describe("game.move (К-4)", () => {
  it("К-4: ход → game.moved обоим после записи; повтор того же сообщения → ply_mismatch + game.state", async () => {
    const t = await table();
    const moved = await play(t, t.w, 0, "e2e4");
    expect(moved).toEqual({
      type: "game.moved",
      game_id: t.game_id,
      ply: 1,
      san: "e4",
      clock: { white_ms: 182_000, black_ms: 180_000, running: null },
      draw_offer: null,
      takeback_offer: null,
    });
    expect((await readGame(t.a.db, t.game_id))?.moves).toEqual([{ san: "e4", clock_ms: 182_000 }]);
    t.w.send({ type: "game.move", ref: "again", game_id: t.game_id, ply: 0, uci: "e2e4" });
    expect(await t.w.next("error")).toMatchObject({ ref: "again", code: "ply_mismatch", game_id: t.game_id });
    expect(await t.w.next("game.state")).toMatchObject({ game: { moves: [{ san: "e4" }] } });
    expect((await readGame(t.a.db, t.game_id))?.moves).toHaveLength(1);
  });

  it("К-4: не своя очередь → not_your_turn + game.state", async () => {
    const t = await table();
    t.b.send({ type: "game.move", ref: "b", game_id: t.game_id, ply: 0, uci: "e7e5" });
    expect(await t.b.next("error")).toMatchObject({ code: "not_your_turn" });
    expect(await t.b.next("game.state")).toMatchObject({ your_color: "black" });
  });

  it("К-4 E-1: недопустимый ход и превращение без буквы → illegal_move + game.state", async () => {
    const t = await table();
    t.w.send({ type: "game.move", ref: "i", game_id: t.game_id, ply: 0, uci: "e2e5" });
    expect(await t.w.next("error")).toMatchObject({ ref: "i", code: "illegal_move" });
    await t.w.next("game.state");
    const a = t.a;
    const [white, black] = await Promise.all([createPlayer(a.db), createPlayer(a.db)]);
    // 1. e4 d5 2. exd5 c6 3. dxc6 Qb6 4. cxb7 Qa5 — белая пешка на b7, поле a8 и c8 под ударом.
    const sans = ["e4", "d5", "exd5", "c6", "dxc6", "Qb6", "cxb7", "Qa5"];
    const { game_id } = await createActiveGame(a.db, { white_id: white.user_id, black_id: black.user_id, moves: sans.map((san) => ({ san, clock_ms: 180_000 })) });
    const w = (await connectWelcomed(a, { cookie: white.cookie })).client;
    w.send({ type: "game.subscribe", game_id });
    await w.next("game.state");
    w.send({ type: "game.move", ref: "p", game_id, ply: 8, uci: "b7a8" });
    expect(await w.next("error")).toMatchObject({ ref: "p", code: "illegal_move" });
    w.send({ type: "game.move", game_id, ply: 8, uci: "b7a8q" });
    expect(await w.next("game.moved")).toMatchObject({ ply: 9, san: "bxa8=Q" });
  });

  it("К-4: гость и П1 не могут ходить (права соединения realtime)", async () => {
    const t = await table();
    const g = (await connectWelcomed(t.a)).client;
    g.send({ type: "game.move", ref: "g", game_id: t.game_id, ply: 0, uci: "e2e4" });
    expect(await g.next("error")).toMatchObject({ code: "unauthenticated" });
  });

  it("К-4: команда в законченную партию → game_not_active + game.state", async () => {
    const t = await table();
    await playLine(t, ["f2f3", "e7e5", "g2g4", "d8h4"]);
    await t.w.next("game.ended");
    t.w.send({ type: "game.move", ref: "late", game_id: t.game_id, ply: 4, uci: "a2a3" });
    expect(await t.w.next("error")).toMatchObject({ ref: "late", code: "game_not_active" });
    expect(await t.w.next("game.state")).toMatchObject({ game: { status: "finished" }, clock: { running: null } });
  });
});

describe("часы (К-5)", () => {
  it("К-5: списание с 3-го полухода, добавка; running — сторона на ходу", async () => {
    const t = await table();
    await playLine(t, ["e2e4", "e7e5"]);
    await t.a.time.advance(4_200);
    const moved = await play(t, t.w, 2, "g1f3");
    expect(moved["clock"]).toEqual({ white_ms: 182_000 - 4_200 + 2_000, black_ms: 182_000, running: "black" });
    expect((await readGame(t.a.db, t.game_id))?.moves[2]).toEqual({ san: "Nf3", clock_ms: 179_800 });
  });

  it("К-5: компенсация RTT/2 (RTT 160 мс → 80 мс); RTT 3 с → ровно 1 с", async () => {
    const t = await table();
    await playLine(t, ["e2e4", "e7e5"]);
    // ping через 5 с, pong — через 160 мс: RTT 160.
    await t.a.time.advance(5_000);
    const ping = await t.w.next("ping");
    await t.a.time.advance(160);
    t.w.send({ type: "pong", n: ping["n"] });
    const moved = await play(t, t.w, 2, "g1f3");
    // Затрачено 5 160 − 80 = 5 080 мс.
    expect((moved["clock"] as { white_ms: number }).white_ms).toBe(182_000 - 5_080 + 2_000);

    const pingB = await t.b.next("ping");
    await t.a.time.advance(3_000);
    t.b.send({ type: "pong", n: pingB["n"] });
    await t.a.time.advance(2_000);
    const moved2 = await play(t, t.b, 3, "b8c6");
    // У чёрных: ход начался после хода белых; прошло 5 000, компенсация 1 000.
    expect((moved2["clock"] as { black_ms: number }).black_ms).toBe(182_000 - 4_000 + 2_000);
  });
});

describe("флаг (К-6)", () => {
  it("К-6: время кончилось без хода — сервер фиксирует timeout, победа соперника, рейтинг пересчитан", async () => {
    // autoPong и шаги по 5 с: без pong соединение умерло бы раньше флага (3 ping, API §9.4).
    const t = await table({ time_base: 60, time_increment: 0, autoPong: true });
    await playLine(t, ["e2e4", "e7e5"]);
    await advanceLive(t.a, 60_000);
    const ended = await t.w.next("game.ended");
    expect(ended).toMatchObject({ status: "finished", result: "black_wins", termination: "timeout" });
    expect(await t.b.next("game.ended")).toEqual(ended);
    const row = await readGame(t.a.db, t.game_id);
    expect(row).toMatchObject({ status: "finished", result: "black_wins", termination: "timeout" });
    expect(await listRatingHistory(t.a.db, t.game_id)).toHaveLength(2);
  });

  // Исход флага при недостатке материала у соперника (draw, timeout_insufficient_material) — фикстуры flag.json.
  it("К-6: флаг в комнате, поднятой из moves[] (остаток белых 1 с)", async () => {
    const a = await app();
    const [white, black] = await Promise.all([createPlayer(a.db), createPlayer(a.db)]);
    const { game_id } = await createActiveGame(a.db, {
      white_id: white.user_id,
      black_id: black.user_id,
      time_base: 60,
      time_increment: 0,
      moves: [
        { san: "e4", clock_ms: 1_000 },
        { san: "e5", clock_ms: 60_000 },
      ],
    });
    const w = (await connectWelcomed(a, { cookie: white.cookie })).client;
    w.send({ type: "game.subscribe", game_id });
    await w.next("game.state");
    await a.time.advance(1_000);
    expect(await w.next("game.ended")).toMatchObject({ result: "black_wins", termination: "timeout" });
  });
});

describe("окончания (К-7)", () => {
  it("К-7: мат — одна транзакция с рейтингом; game.ended.ratings = RatingHistory; pgn без ников; аналитика", async () => {
    const t = await table();
    await playLine(t, ["f2f3", "e7e5", "g2g4"]);
    t.b.send({ type: "game.move", game_id: t.game_id, ply: 3, uci: "d8h4" });
    const moved = await t.w.next("game.moved");
    expect(moved).toMatchObject({ ply: 4, san: "Qh4#", clock: { running: null } });
    const ended = await t.w.next("game.ended");
    expect(ended).toMatchObject({ status: "finished", result: "black_wins", termination: "checkmate" });
    const history = await listRatingHistory(t.a.db, t.game_id);
    const ratings = ended["ratings"] as { white: { rating_before: number; rating_after: number }; black: { rating_after: number } };
    const white = history.find((h) => h.user_id === t.white.user_id)!;
    expect(ratings.white).toEqual({ rating_before: Math.round(white.rating_before), rating_after: Math.round(white.rating_after) });
    expect(ratings.black.rating_after).toBeGreaterThan(1500);
    const row = await readGame(t.a.db, t.game_id);
    expect(row).toMatchObject({ status: "finished", result: "black_wins", termination: "checkmate", ended_at: WALL });
    expect(row?.moves).toHaveLength(4);
    expect(row?.pgn).toContain("1. f3 e5 2. g4 Qh4# 0-1");
    expect(row?.pgn).not.toContain(t.white.nickname!);
    await t.a.analytics.drain();
    const finished = (await listAnalyticsEvents()).filter((e) => e.name === "game_finished" && e.game_id === t.game_id);
    expect(finished.map((e) => e.user_id).sort()).toEqual([t.white.user_id, t.black.user_id].sort());
    expect(finished[0]?.props).toEqual({ termination: "checkmate", after_restart: false });
  });

  it("К-7: товарищеская — ratings null, RatingHistory нет", async () => {
    const t = await table({ rated: false });
    await playLine(t, ["f2f3", "e7e5", "g2g4", "d8h4"]);
    expect(await t.w.next("game.ended")).toMatchObject({ ratings: null });
    expect(await listRatingHistory(t.a.db, t.game_id)).toHaveLength(0);
  });

  it("К-7: троекратное повторение — ничья", async () => {
    const t = await table({ rated: false });
    await playLine(t, ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"]);
    expect(await t.w.next("game.ended")).toMatchObject({ result: "draw", termination: "threefold_repetition" });
  });

  it("К-7: пат — ничья (Сэм Лойд, 10 ходов)", async () => {
    const t = await table({ rated: false });
    const sans = ["e3", "a5", "Qh5", "Ra6", "Qxa5", "h5", "h4", "Rah6", "Qxc7", "f6", "Qxd7+", "Kf7", "Qxb7", "Qd3", "Qxb8", "Qh7", "Qxc8", "Kg6", "Qe6"];
    const pos = ChessPosition.start();
    const ucis = sans.map((san) => {
      const uci = pos.legalUci().find((u) => ChessPosition.start(pos.fen()).play(u)?.san === san);
      if (uci === undefined) throw new Error(`no uci for ${san}`);
      pos.play(uci);
      return uci;
    });
    await playLine(t, ucis);
    expect(await t.w.next("game.ended")).toMatchObject({ result: "draw", termination: "stalemate" });
  });
});

describe("метрики (К-8)", () => {
  it("К-8: chezz_games_active и chezz_move_delivery_seconds", async () => {
    const t = await table();
    const scrape = async () => (await fetch(`${t.a.metricsUrl}/metrics`)).text();
    // В базе воркера — активные партии прошлых тестов: start() поднял их тоже, поэтому сравнение — разницей.
    const active = async () => Number(/^chezz_games_active (\d+)$/m.exec(await scrape())?.[1]);
    const before = await active();
    expect(before).toBeGreaterThanOrEqual(1);
    await play(t, t.w, 0, "e2e4");
    expect(await scrape()).toMatch(/^chezz_move_delivery_seconds_count 1$/m);
    await play(t, t.b, 1, "e7e5");
    await play(t, t.w, 2, "f1c4");
    await play(t, t.b, 3, "b8c6");
    await play(t, t.w, 4, "d1h5");
    await play(t, t.b, 5, "g8f6");
    t.w.send({ type: "game.move", game_id: t.game_id, ply: 6, uci: "h5f7" });
    await t.w.next("game.ended");
    expect(await active()).toBe(before - 1);
  });
});
