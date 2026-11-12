import { describe, expect, it } from "vitest";
import { categoryOf } from "./category.ts";
import { chargeMove, clockFromMoves, compensationMs, initialClock, remainingAt, stopClock, type ClockState } from "./clock.ts";
import { buildPgn } from "./pgn.ts";

const running = (white_ms: number, black_ms: number, side: "white" | "black", at: number): ClockState => ({
  white_ms,
  black_ms,
  running: side,
  turn_started_at: at,
});

describe("часы (ARCHITECTURE §9.2)", () => {
  it("К-5: пример 3+2 — 2:41,300, думали 4,2 с, RTT 160 мс → 2:39,180", () => {
    const r = chargeMove(running(161_300, 170_000, "white", 1_000), "white", 11, 5_200, 160, 2);
    expect(r.flagged).toBe(false);
    if (r.flagged) return;
    expect(r.clock_ms).toBe(159_180);
    expect(r.state).toEqual({ white_ms: 159_180, black_ms: 170_000, running: "black", turn_started_at: 5_200 });
  });

  it("К-5: компенсация — RTT/2, потолок 1 с, нет RTT — 0", () => {
    expect(compensationMs(160)).toBe(80);
    expect(compensationMs(3_000)).toBe(1_000);
    expect(compensationMs(null)).toBe(0);
    const r = chargeMove(running(60_000, 60_000, "black", 0), "black", 12, 5_000, 3_000, 0);
    expect(r.flagged === false && r.clock_ms).toBe(56_000);
  });

  it("К-5: компенсация больше затраченного — время не прибавляется", () => {
    const r = chargeMove(running(60_000, 60_000, "white", 0), "white", 3, 100, 1_000, 0);
    expect(r.flagged === false && r.clock_ms).toBe(60_000);
  });

  it("К-5: первые ходы сторон не списывают время, добавка начисляется; часы идут с 2-го полухода", () => {
    const start = initialClock(180);
    const w = chargeMove(start, "white", 1, 9_000, null, 2);
    expect(w).toEqual({ flagged: false, clock_ms: 182_000, state: { white_ms: 182_000, black_ms: 180_000, running: null, turn_started_at: null } });
    if (w.flagged) return;
    const b = chargeMove(w.state, "black", 2, 20_000, null, 2);
    expect(b).toEqual({ flagged: false, clock_ms: 182_000, state: { white_ms: 182_000, black_ms: 182_000, running: "white", turn_started_at: 20_000 } });
  });

  it("К-6: остаток ≤ 0 — флаг, без добавки", () => {
    const r = chargeMove(running(200, 60_000, "white", 0), "white", 21, 250, null, 1);
    expect(r).toEqual({ flagged: true, state: { white_ms: 0, black_ms: 60_000, running: null, turn_started_at: null } });
  });

  it("К-6: remainingAt и stopClock считают только идущую сторону", () => {
    const s = running(10_000, 20_000, "white", 1_000);
    expect(remainingAt(s, "white", 4_000)).toBe(7_000);
    expect(remainingAt(s, "black", 4_000)).toBe(20_000);
    expect(remainingAt(s, "white", 99_000)).toBe(0);
    expect(stopClock(s, 4_000)).toEqual({ white_ms: 7_000, black_ms: 20_000, running: null, turn_started_at: null });
  });

  it("К-5: часы из moves[] — остатки сторон, сторона на ходу получает время на начало хода (A10)", () => {
    expect(clockFromMoves(180, [], 5)).toEqual(initialClock(180));
    expect(clockFromMoves(180, [182_000], 5)).toEqual({ white_ms: 182_000, black_ms: 180_000, running: null, turn_started_at: null });
    expect(clockFromMoves(180, [182_000, 181_000, 150_000], 7)).toEqual({ white_ms: 150_000, black_ms: 181_000, running: "black", turn_started_at: 7 });
  });
});

describe("категория (GLOSSARY §6)", () => {
  it("К-2: 2+1 → пуля, 3+0 → блиц, 2+12 → рапид, 479 → блиц", () => {
    expect(categoryOf(120, 1)).toBe("bullet");
    expect(categoryOf(179, 0)).toBe("bullet");
    expect(categoryOf(180, 0)).toBe("blitz");
    expect(categoryOf(479, 0)).toBe("blitz");
    expect(categoryOf(120, 12)).toBe("rapid");
  });
});

describe("PGN (ARCHITECTURE §9.1 п.7)", () => {
  it("К-7: теги без ников, ходы с номерами, результат", () => {
    const pgn = buildPgn({
      started_at: new Date("2026-11-11T10:00:00Z"),
      time_base: 180,
      time_increment: 2,
      result: "black_wins",
      termination: "checkmate",
      sans: ["f3", "e5", "g4", "Qh4#"],
    });
    expect(pgn).toBe(
      '[Event "Chezz"]\n[Site "Chezz"]\n[Date "2026.11.11"]\n[Result "0-1"]\n[TimeControl "180+2"]\n[Termination "checkmate"]\n\n1. f3 e5 2. g4 Qh4# 0-1\n',
    );
    expect(pgn).not.toMatch(/White|Black/);
  });
});
