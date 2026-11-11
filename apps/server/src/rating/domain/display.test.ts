import { describe, expect, it } from "vitest";
import { isProvisional, roundRating } from "./display.ts";

describe("показ рейтинга", () => {
  it("К-8: RD 110 — не предварительный, 110,01 и 350 — предварительный", () => {
    expect(isProvisional(110)).toBe(false);
    expect(isProvisional(60)).toBe(false);
    expect(isProvisional(110.01)).toBe(true);
    expect(isProvisional(350)).toBe(true);
  });

  it("К-8: рейтинг округляется до целого, половина — вверх", () => {
    expect(roundRating(1464.06)).toBe(1464);
    expect(roundRating(1499.5)).toBe(1500);
    expect(roundRating(1500.49)).toBe(1500);
  });
});
