// rating.service на реальной PostgreSQL (TESTING §5): значения по умолчанию, applyResult в транзакции вызывающего.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { workerDatabaseUrl } from "../../test/support/db.ts";
import { createPlayer } from "../../test/support/factories.ts";
import { countRatingRows, listRatingHistory } from "../../test/support/ratings.ts";
import type { Database } from "../database.ts";
import { createDb, withTransaction } from "../platform/db.ts";
import { grownRd, rateMany } from "./domain/glicko2.ts";
import { createRatingService, type RatedResult } from "./service.ts";

const db = createDb<Database>(workerDatabaseUrl());
const rating = createRatingService({ db });
afterAll(() => db.destroy());

const T0 = new Date("2026-11-10T12:00:00.000Z");
const DAY_MS = 86_400_000;

async function pair(): Promise<{ white: string; black: string }> {
  const a = await createPlayer(db, { token: null });
  const b = await createPlayer(db, { token: null });
  return { white: a.user_id, black: b.user_id };
}

function result(p: { white: string; black: string }, over: Partial<RatedResult> = {}): RatedResult {
  return { gameId: randomUUID(), category: "blitz", whiteId: p.white, blackId: p.black, result: "white_wins", endedAt: T0, ...over };
}

const apply = (r: RatedResult) => withTransaction(db, (trx) => rating.applyResult(trx, r));

const historyOf = (gameId: string) => listRatingHistory(db, gameId);

describe("rating.service", () => {
  it("К-3: нет строки Rating → 1500 / 350 / 0,06, 0 партий; строка не создаётся", async () => {
    const { white } = await pair();
    expect(await rating.getRating(white, "bullet")).toEqual({ rating: 1500, rd: 350, volatility: 0.06, games_count: 0, updated_at: null });
    const map = await rating.getRatings([white], "rapid");
    expect(map.get(white)?.rating).toBe(1500);
    expect(await countRatingRows(db, white)).toBe(0);
  });

  it("К-4: applyResult — Rating обоих по rateMany, games_count + 1, updated_at = ended_at, две строки RatingHistory, целые изменения", async () => {
    const p = await pair();
    const r = result(p);
    const changes = await apply(r);

    const expW = rateMany({ rating: 1500, rd: 350, volatility: 0.06 }, [{ opponent: { rating: 1500, rd: 350 }, score: 1 }], 0);
    const expB = rateMany({ rating: 1500, rd: 350, volatility: 0.06 }, [{ opponent: { rating: 1500, rd: 350 }, score: 0 }], 0);
    const w = await rating.getRating(p.white, "blitz");
    const b = await rating.getRating(p.black, "blitz");
    expect(w).toMatchObject({ games_count: 1, updated_at: T0 });
    expect(w.rating).toBeCloseTo(expW.rating, 9);
    expect(w.rd).toBeCloseTo(expW.rd, 9);
    expect(w.volatility).toBeCloseTo(expW.volatility, 12);
    expect(b.rating).toBeCloseTo(expB.rating, 9);

    expect(changes).toEqual({
      white: { rating_before: 1500, rating_after: Math.round(expW.rating) },
      black: { rating_before: 1500, rating_after: Math.round(expB.rating) },
    });
    expect(changes.white.rating_after).toBeGreaterThan(1500);
    expect(changes.black.rating_after).toBeLessThan(1500);

    const history = await historyOf(r.gameId);
    expect(history).toHaveLength(2);
    const wh = history.find((h) => h.user_id === p.white);
    expect(wh).toMatchObject({ category: "blitz", rating_before: 1500, created_at: T0 });
    expect(wh?.rating_after).toBeCloseTo(expW.rating, 9);
  });

  it("К-4: ничья между равными не меняет рейтинг; второй результат считается от первого", async () => {
    const p = await pair();
    await apply(result(p, { result: "draw" }));
    const w1 = await rating.getRating(p.white, "blitz");
    expect(w1.rating).toBeCloseTo(1500, 6);
    expect(w1.rd).toBeLessThan(350);

    await apply(result(p, { result: "black_wins" }));
    const w2 = await rating.getRating(p.white, "blitz");
    const b2 = await rating.getRating(p.black, "blitz");
    expect(w2.games_count).toBe(2);
    expect(w2.rating).toBeLessThan(w1.rating);
    expect(b2.rating).toBeGreaterThan(w1.rating);
  });

  it("К-5: откат транзакции вызывающего — ни Rating, ни RatingHistory", async () => {
    const p = await pair();
    const r = result(p);
    await expect(
      withTransaction(db, async (trx) => {
        await rating.applyResult(trx, r);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await rating.getRating(p.white, "blitz")).toMatchObject({ rating: 1500, games_count: 0, updated_at: null });
    expect(await historyOf(r.gameId)).toHaveLength(0);
  });

  it("К-6: блиц не трогает Rating пули того же игрока", async () => {
    const p = await pair();
    await apply(result(p, { category: "bullet" }));
    const bulletBefore = await rating.getRating(p.white, "bullet");
    await apply(result(p, { category: "blitz", result: "black_wins" }));
    expect(await rating.getRating(p.white, "bullet")).toEqual(bulletBefore);
    expect((await rating.getRating(p.white, "blitz")).games_count).toBe(1);
  });

  it("К-7: elapsedDays у каждого свой — от updated_at своей строки до ended_at; RD соперника тоже с ростом", async () => {
    const p = await pair();
    const other = await createPlayer(db, { token: null });
    // Белые играют в день 0, чёрные — нет; через 30 дней белые и чёрные играют между собой.
    await apply(result({ white: p.white, black: other.user_id }, { endedAt: T0 }));
    await apply(result({ white: p.black, black: other.user_id }, { endedAt: new Date(T0.getTime() + 29 * DAY_MS) }));
    const w0 = await rating.getRating(p.white, "blitz");
    const b0 = await rating.getRating(p.black, "blitz");

    const end = new Date(T0.getTime() + 30 * DAY_MS);
    await apply(result(p, { endedAt: end, result: "draw" }));

    // RD соперника — тоже с ростом за его простой (ARCHITECTURE §11).
    const expW = rateMany(w0, [{ opponent: { rating: b0.rating, rd: grownRd(b0.rd, b0.volatility, 1) }, score: 0.5 }], 30);
    const expB = rateMany(b0, [{ opponent: { rating: w0.rating, rd: grownRd(w0.rd, w0.volatility, 30) }, score: 0.5 }], 1);
    // Без роста RD соперника результат другой — тест различает.
    expect(rateMany(b0, [{ opponent: { rating: w0.rating, rd: w0.rd }, score: 0.5 }], 1).rd).not.toBeCloseTo(expB.rd, 6);
    const w = await rating.getRating(p.white, "blitz");
    const b = await rating.getRating(p.black, "blitz");
    expect(w.rd).toBeCloseTo(expW.rd, 9);
    expect(w.rating).toBeCloseTo(expW.rating, 9);
    expect(b.rd).toBeCloseTo(expB.rd, 9);
    expect(w.updated_at).toEqual(end);
  });

  it("К-4 E-1: второй applyResult с тем же game_id — ошибка, рейтинг не пересчитан дважды", async () => {
    const p = await pair();
    const r = result(p);
    await apply(r);
    const after = await rating.getRating(p.white, "blitz");
    await expect(apply({ ...r, endedAt: new Date(T0.getTime() + DAY_MS) })).rejects.toThrow(/already rated/);
    expect(await rating.getRating(p.white, "blitz")).toEqual(after);
    expect(await historyOf(r.gameId)).toHaveLength(2);
  });

  it("К-4 E-2: белые и чёрные — один игрок → ошибка до записи", async () => {
    const { white } = await pair();
    const r = result({ white, black: white });
    await expect(apply(r)).rejects.toThrow(/same user/);
    expect(await rating.getRating(white, "blitz")).toMatchObject({ games_count: 0, updated_at: null });
  });

  it("К-7: ended_at раньше updated_at (часы назад) — elapsedDays 0, updated_at не уходит в прошлое", async () => {
    const p = await pair();
    const later = new Date(T0.getTime() + DAY_MS);
    await apply(result(p, { endedAt: later }));
    await apply(result(p, { endedAt: T0, result: "draw" }));
    expect((await rating.getRating(p.white, "blitz")).updated_at).toEqual(later);
  });

  it("К-4: два одновременных результата разных партий одного игрока — оба учтены (блокировка строк)", async () => {
    const p = await pair();
    const third = await createPlayer(db, { token: null });
    await Promise.all([
      apply(result(p)),
      apply(result({ white: third.user_id, black: p.white }, { result: "black_wins" })),
    ]);
    expect((await rating.getRating(p.white, "blitz")).games_count).toBe(2);
  });
});
