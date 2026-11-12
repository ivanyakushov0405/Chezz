import { describe, expect, it } from "vitest";
import { displayedMs, formatClock, lowTimeThresholdMs } from "./clockDisplay.ts";

describe("clock (API §9.4, U11)", () => {
  it("К-9: порог мало времени — 10 с в пуле, 12,5% базы в блице, не больше 60 с", () => {
    expect(lowTimeThresholdMs(60)).toBe(10_000);
    expect(lowTimeThresholdMs(180)).toBe(22_500);
    expect(lowTimeThresholdMs(600)).toBe(60_000);
    expect(lowTimeThresholdMs(1_800)).toBe(60_000);
  });

  it("К-9: идущая сторона убывает от момента получения, другая — как пришло", () => {
    const clock = { white_ms: 60_000, black_ms: 30_000, running: "white" as const };
    expect(displayedMs(clock, "white", 1_000, 3_500, true)).toBe(57_500);
    expect(displayedMs(clock, "black", 1_000, 3_500, true)).toBe(30_000);
    expect(displayedMs(clock, "white", 1_000, 100_000, true)).toBe(0);
  });

  it("К-9 К-10: без отсчёта (переподключение) и при running = null — серверные значения", () => {
    const clock = { white_ms: 60_000, black_ms: 30_000, running: "white" as const };
    expect(displayedMs(clock, "white", 1_000, 3_500, false)).toBe(60_000);
    expect(displayedMs({ ...clock, running: null }, "white", 1_000, 3_500, true)).toBe(60_000);
  });

  it("К-9: формат — m:ss, h:mm:ss, ниже 10 с десятые", () => {
    expect(formatClock(161_300)).toBe("2:41");
    expect(formatClock(3_723_000)).toBe("1:02:03");
    expect(formatClock(10_000)).toBe("0:10");
    expect(formatClock(9_999)).toBe("0:09.9");
    expect(formatClock(8_400)).toBe("0:08.4");
    expect(formatClock(0)).toBe("0:00.0");
    expect(formatClock(-5)).toBe("0:00.0");
  });
});
