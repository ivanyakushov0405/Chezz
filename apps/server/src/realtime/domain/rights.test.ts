import { describe, expect, it } from "vitest";
import { OPEN_MESSAGE_TYPES, refusalFor } from "./rights.ts";

describe("права соединения", () => {
  it("К-6: гость и П1 — только pong, lobby.*, game.subscribe, game.unsubscribe", () => {
    for (const type of ["pong", "lobby.subscribe", "lobby.unsubscribe", "game.subscribe", "game.unsubscribe"]) {
      expect(refusalFor("guest", type), type).toBeNull();
      expect(refusalFor("onboarding", type), type).toBeNull();
    }
    expect(OPEN_MESSAGE_TYPES.size).toBe(5);
  });

  it("К-6: остальное — unauthenticated у гостя, onboarding_required у П1", () => {
    for (const type of ["game.move", "game.resign", "seek.start", "seek.cancel", "game.draw_offer"]) {
      expect(refusalFor("guest", type), type).toBe("unauthenticated");
      expect(refusalFor("onboarding", type), type).toBe("onboarding_required");
    }
  });

  it("К-6: Игроку отказа нет", () => {
    for (const type of ["game.move", "seek.start", "pong", "lobby.subscribe"]) expect(refusalFor("player", type)).toBeNull();
  });
});
