import { describe, expect, it } from "vitest";
import { ChessPosition } from "./index.ts";

const pos = (fen: string): ChessPosition => ChessPosition.start(fen);

describe("canMate (ARCHITECTURE §9.1 п.8)", () => {
  it("К-1: один король, король и конь, король и однопольные слоны — не хватает", () => {
    expect(pos("4k3/8/8/8/8/8/8/4K3 w - - 0 1").canMate("white")).toBe(false);
    expect(pos("4k3/8/8/8/8/8/8/3NK3 w - - 0 1").canMate("white")).toBe(false);
    // c1 и e3 — тёмные поля.
    expect(pos("4k3/8/8/8/8/4B3/8/2B1K3 w - - 0 1").canMate("white")).toBe(false);
  });

  it("К-1: пешка, ладья, ферзь, два коня, конь и слон, разнопольные слоны — хватает", () => {
    expect(pos("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1").canMate("white")).toBe(true);
    expect(pos("4k3/8/8/8/8/8/8/R3K3 w - - 0 1").canMate("white")).toBe(true);
    expect(pos("4k3/8/8/8/8/8/8/3QK3 w - - 0 1").canMate("white")).toBe(true);
    expect(pos("4k3/8/8/8/8/8/8/1N1NK3 w - - 0 1").canMate("white")).toBe(true);
    expect(pos("4k3/8/8/8/8/8/8/1NB1K3 w - - 0 1").canMate("white")).toBe(true);
    expect(pos("4k3/8/8/8/8/8/8/2BBK3 w - - 0 1").canMate("white")).toBe(true);
  });

  it("К-1: считается только своя сторона", () => {
    const p = pos("3qk3/8/8/8/8/8/8/3NK3 w - - 0 1");
    expect(p.canMate("white")).toBe(false);
    expect(p.canMate("black")).toBe(true);
  });
});

describe("play (UCI)", () => {
  it("К-1 E-1: превращение без буквы — недопустимо, с буквой — допустимо", () => {
    const p = pos("8/4P3/8/8/8/8/k7/4K3 w - - 0 1");
    const fen = p.fen();
    expect(p.play("e7e8")).toBeNull();
    expect(p.fen()).toBe(fen);
    expect(p.play("e7e8q")).toEqual({ san: "e8=Q" });
  });

  it("К-1: мусор вместо UCI — null", () => {
    const p = ChessPosition.start();
    expect(p.play("")).toBeNull();
    expect(p.play("e2e9")).toBeNull();
    expect(p.play("e2e4x")).toBeNull();
    expect(p.play("e2e4")).toEqual({ san: "e4" });
    expect(p.turn()).toBe("black");
    expect(p.ply()).toBe(1);
  });
});
