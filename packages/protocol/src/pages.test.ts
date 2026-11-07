import { describe, expect, it } from "vitest";
import { PAGES } from "./pages.ts";

describe("PAGES (API §14)", () => {
  it("AC-20: адрес каждой строки раздела 14", () => {
    expect(PAGES.home()).toBe("/");
    expect(PAGES.welcome()).toBe("/welcome");
    expect(PAGES.player("knight_rider-7")).toBe("/player/knight_rider-7");
    expect(PAGES.player("a b/ё")).toBe("/player/a%20b%2F%D1%91");
    expect(PAGES.playerGames("knight_rider-7")).toBe("/player/knight_rider-7/games");
    expect(PAGES.leaderboard("blitz")).toBe("/leaderboard/blitz");
    expect(PAGES.game("9a1c")).toBe("/game/9a1c");
    expect(PAGES.gameAnalysis("9a1c")).toBe("/game/9a1c/analysis");
    expect(PAGES.challenge("3f9c")).toBe("/challenge/3f9c");
    expect(PAGES.settings()).toBe("/settings");
    expect(PAGES.accountDelete()).toBe("/account/delete");
    expect(PAGES.terms()).toBe("/terms");
    expect(PAGES.privacy()).toBe("/privacy");
  });

  it("AC-20: в PAGES ровно 12 функций", () => {
    expect(Object.keys(PAGES)).toHaveLength(12);
  });
});
