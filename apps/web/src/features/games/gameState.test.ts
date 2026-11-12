import { describe, expect, it } from "vitest";
import { GAME_ID, makeState } from "../../test/games.ts";
import { applyServerMessage, withoutPending, withPending, type GameScreenState } from "./gameState.ts";

const OTHER = "44444444-4444-4444-8444-444444444444";
const loading: GameScreenState = { status: "loading" };
const ready = (moves: string[] = []): GameScreenState =>
  applyServerMessage(loading, GAME_ID, makeState({ game: { moves: moves.map((san) => ({ san, clock_ms: 180_000 })) } }), 0).state;
const moved = (ply: number, san: string) =>
  ({
    type: "game.moved",
    game_id: GAME_ID,
    ply,
    san,
    clock: { white_ms: 175_000, black_ms: 180_000, running: "black" },
    draw_offer: null,
    takeback_offer: null,
  }) as const;
const view = (s: GameScreenState) => {
  if (s.status !== "ready") throw new Error(`не ready: ${s.status}`);
  return s.view;
};

describe("gameState (API §9.3)", () => {
  it("К-9: game.state — экран ready, ход не ждёт; чужая партия игнорируется", () => {
    expect(applyServerMessage(loading, GAME_ID, makeState({ game_id: OTHER }), 0).state).toEqual(loading);
    const s = ready();
    expect(view(s).yourColor).toBe("white");
    expect(view(s).pending).toBeNull();
  });

  it("К-9: not_found на подписку — not-found; другая ошибка — error", () => {
    const err = (code: "not_found" | "internal") => ({ type: "error", ref: null, code, game_id: GAME_ID, details: null }) as const;
    expect(applyServerMessage(loading, GAME_ID, err("not_found"), 0).state).toEqual({ status: "not-found" });
    expect(applyServerMessage(loading, GAME_ID, err("internal"), 0).state).toEqual({ status: "error", code: "internal" });
  });

  it("К-9: game.moved — ход дописан, часы и момент получения заменены, ожидание снято", () => {
    const pending = withPending(ready(), { ref: "m1", ply: 0, uci: "e2e4" });
    const r = applyServerMessage(pending, GAME_ID, moved(1, "e4"), 500);
    expect(view(r.state).game.moves).toEqual([{ san: "e4", clock_ms: 175_000 }]);
    expect(view(r.state).clock.running).toBe("black");
    expect(view(r.state).clockAt).toBe(500);
    expect(view(r.state).pending).toBeNull();
  });

  it("К-9: повтор старого game.moved не меняет партию; разрыв ply — повтор подписки", () => {
    const s = ready(["e4"]);
    expect(applyServerMessage(s, GAME_ID, moved(1, "e4"), 1).state).toBe(s);
    const gap = applyServerMessage(s, GAME_ID, moved(3, "Nf3"), 1);
    expect(gap.resubscribe).toBe(true);
    expect(gap.state).toBe(s);
  });

  it("К-9: отказ хода — ожидание снято (фигура возвращается) и Toast error.<code>", () => {
    const s = withPending(ready(), { ref: "m1", ply: 0, uci: "e2e5" });
    const r = applyServerMessage(s, GAME_ID, { type: "error", ref: "m1", code: "illegal_move", game_id: GAME_ID, details: null }, 1);
    expect(r.toast).toBe("illegal_move");
    expect(view(r.state).pending).toBeNull();
  });

  it("К-9: game.ended — итог, рейтинг, часы стоят на показанном значении", () => {
    const s = applyServerMessage(loading, GAME_ID, makeState({ clock: { white_ms: 10_000, black_ms: 9_000, running: "white" } }), 1_000).state;
    const r = applyServerMessage(
      s,
      GAME_ID,
      {
        type: "game.ended",
        game_id: GAME_ID,
        status: "finished",
        result: "black_wins",
        termination: "checkmate",
        ratings: { white: { rating_before: 1500, rating_after: 1488 }, black: { rating_before: 1620, rating_after: 1629 } },
      },
      4_000,
    );
    const v = view(r.state);
    expect(v.game.status).toBe("finished");
    expect(v.game.termination).toBe("checkmate");
    expect(v.game.ratings?.white.rating_after).toBe(1488);
    expect(v.clock).toEqual({ white_ms: 7_000, black_ms: 9_000, running: null });
  });

  it("К-9: rate_limited без ref и game_id — ждущий ход снят, Toast", () => {
    const s = withPending(ready(), { ref: "m1", ply: 0, uci: "e2e4" });
    const r = applyServerMessage(s, GAME_ID, { type: "error", ref: null, code: "rate_limited", game_id: null, details: { retry_after_ms: 200 } }, 1);
    expect(r.toast).toBe("rate_limited");
    expect(view(r.state).pending).toBeNull();
    // Без ждущего хода чужая ошибка экран не трогает.
    expect(applyServerMessage(ready(), GAME_ID, { type: "error", ref: null, code: "rate_limited", game_id: null, details: null }, 1).toast).toBeUndefined();
  });

  it("К-10: разрыв соединения — неподтверждённый ход забывается", () => {
    const s = withPending(ready(), { ref: "m1", ply: 0, uci: "e2e4" });
    expect(view(withoutPending(s)).pending).toBeNull();
  });
});
