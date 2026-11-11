import { describe, expect, it } from "vitest";
import {
  CompleteOnboardingBody,
  GetMeResponse,
  MeResponse,
  PAGES,
  PENDING_CATALOG,
  REST_ROUTES,
  UpdateMeBody,
} from "./index.ts";

const MOVED = ["getMe", "completeOnboarding", "updateMe", "logout", "logoutAll"];

const sorted = (xs: readonly string[]): string[] => [...xs].sort();

describe("REST_ROUTES входа и аккаунта (API §12.1)", () => {
  it("К-4: getMe — GET /api/me, все, 200, GetMeResponse, без тела", () => {
    const r = REST_ROUTES.getMe;
    expect([r.method, r.path, r.status]).toEqual(["GET", "/api/me", 200]);
    expect(sorted(r.who)).toEqual(sorted(["guest", "onboarding", "player"]));
    expect(r.response).toBe(GetMeResponse);
    expect("body" in r ? r.body : undefined).toBeUndefined();
    expect(r.errors).toEqual([]);
  });

  it("К-5: completeOnboarding — POST /api/me/onboarding, только П1, Игроку onboarding_completed", () => {
    const r = REST_ROUTES.completeOnboarding;
    expect([r.method, r.path, r.status]).toEqual(["POST", "/api/me/onboarding", 200]);
    expect([...r.who]).toEqual(["onboarding"]);
    expect(r.refusals).toEqual({ player: "onboarding_completed" });
    expect(r.body).toBe(CompleteOnboardingBody);
    expect(r.response).toBe(MeResponse);
    expect(sorted(r.errors)).toEqual(sorted(["nickname_invalid", "nickname_reserved", "nickname_taken", "onboarding_completed"]));
  });

  it("К-7: updateMe — PATCH /api/me, только Игрок, UpdateMeBody → MeResponse", () => {
    const r = REST_ROUTES.updateMe;
    expect([r.method, r.path, r.status]).toEqual(["PATCH", "/api/me", 200]);
    expect([...r.who]).toEqual(["player"]);
    expect(r.body).toBe(UpdateMeBody);
    expect(r.response).toBe(MeResponse);
    expect(r.errors).toEqual([]);
  });

  it("К-6: logout — POST /api/auth/logout, П1 и Игрок, 204", () => {
    const r = REST_ROUTES.logout;
    expect([r.method, r.path, r.status]).toEqual(["POST", "/api/auth/logout", 204]);
    expect(sorted(r.who)).toEqual(sorted(["onboarding", "player"]));
    expect(r.errors).toEqual([]);
  });

  it("К-6: logoutAll — POST /api/auth/logout-all, П1 и Игрок, 204", () => {
    const r = REST_ROUTES.logoutAll;
    expect([r.method, r.path, r.status]).toEqual(["POST", "/api/auth/logout-all", 204]);
    expect(sorted(r.who)).toEqual(sorted(["onboarding", "player"]));
    expect(r.errors).toEqual([]);
  });
});

describe("PENDING_CATALOG после E04", () => {
  it("К-4: пять операций E04 перенесены из PENDING_CATALOG.rest", () => {
    for (const op of MOVED) expect(PENDING_CATALOG.rest as readonly string[], op).not.toContain(op);
  });

  it("К-4: остальные операции каталога на месте", () => {
    const rest = [
      "changeNickname",
      "startAccountDeletion",
      "deleteAccount",
      "getProfile",
      "getRatingHistory",
      "createChallenge",
      "getChallenge",
      "acceptChallenge",
      "cancelChallenge",
      "getGame",
      "getGamePgn",
      "listProfileGames",
      "trackEvent",
      "getLeaderboard",
      "sendFeedback",
    ];
    expect(sorted(PENDING_CATALOG.rest)).toEqual(sorted(rest));
  });
});

describe("PAGES.welcome с return_to (бриф, «Решения»)", () => {
  it("К-9: без аргумента — /welcome", () => {
    expect(PAGES.welcome()).toBe("/welcome");
  });

  it("К-9: с return_to — /welcome?return_to=<encodeURIComponent>", () => {
    expect(PAGES.welcome("/challenge/3f9c")).toBe("/welcome?return_to=%2Fchallenge%2F3f9c");
    expect(PAGES.welcome("/leaderboard/blitz?x=1&y=2")).toBe(`/welcome?return_to=${encodeURIComponent("/leaderboard/blitz?x=1&y=2")}`);
  });
});
