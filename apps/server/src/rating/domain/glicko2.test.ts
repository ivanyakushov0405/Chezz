import { describe, expect, it } from "vitest";
import { DEFAULT_GLICKO, grownRd, MAX_RD, rateMany, type Glicko, type RatedGame } from "./glicko2.ts";

const settled: Glicko = { rating: 1800, rd: 60, volatility: 0.06 };
const win: RatedGame[] = [{ opponent: { rating: 1800, rd: 60 }, score: 1 }];

describe("rateMany", () => {
  it("К-2: чем дольше без игр, тем больше RD после партии", () => {
    const rd0 = rateMany(settled, win, 0).rd;
    const rd30 = rateMany(settled, win, 30).rd;
    const rd365 = rateMany(settled, win, 365).rd;
    expect(rd30).toBeGreaterThan(rd0);
    expect(rd365).toBeGreaterThan(rd30);
  });

  it("К-2: рост RD до партии не выше 350 — долгий перерыв новичка как партия без перерыва", () => {
    const fresh = rateMany(DEFAULT_GLICKO, win, 0);
    const afterYears = rateMany(DEFAULT_GLICKO, win, 3650);
    expect(afterYears.rd).toBeCloseTo(fresh.rd, 10);
    expect(afterYears.rating).toBeCloseTo(fresh.rating, 10);
    expect(afterYears.rd).toBeLessThan(MAX_RD);
  });

  it("К-1: победа поднимает рейтинг, поражение опускает, ничья с равным почти не меняет", () => {
    const opp = { rating: 1800, rd: 60 };
    expect(rateMany(settled, [{ opponent: opp, score: 1 }], 0).rating).toBeGreaterThan(1800);
    expect(rateMany(settled, [{ opponent: opp, score: 0 }], 0).rating).toBeLessThan(1800);
    expect(rateMany(settled, [{ opponent: opp, score: 0.5 }], 0).rating).toBeCloseTo(1800, 6);
  });

  it("К-7: grownRd — RD 60 за год ≈ 110 (lila), 0 суток — без роста, потолок 350", () => {
    expect(grownRd(60, 0.06, 0)).toBeCloseTo(60, 10);
    expect(grownRd(60, 0.06, 365)).toBeGreaterThan(105);
    expect(grownRd(60, 0.06, 365)).toBeLessThan(115);
    expect(grownRd(300, 0.06, 36500)).toBe(MAX_RD);
    expect(() => grownRd(60, 0.06, -1)).toThrow(RangeError);
  });

  it("К-1: пустой массив партий и отрицательное или нечисловое время — ошибка", () => {
    expect(() => rateMany(settled, [], 0)).toThrow(RangeError);
    expect(() => rateMany(settled, win, -1)).toThrow(RangeError);
    expect(() => rateMany(settled, win, Number.NaN)).toThrow(RangeError);
  });
});
