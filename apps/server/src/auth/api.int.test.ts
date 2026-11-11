// Session, «Кто», getMe, первый вход, выход и чистка через HTTP (TESTING §5, §7.3; SECURITY §5; API §12.1).
import { DEFAULT_USER_SETTINGS, GetMeResponse } from "@chezz/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { listAnalyticsEvents } from "../../test/support/analytics.ts";
import { startApp, type TestApp } from "../../test/support/app.ts";
import { createPlayer, randomNickname } from "../../test/support/factories.ts";
import { rest } from "../../test/support/rest.ts";

const WALL = new Date("2026-11-10T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const apps: TestApp[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function app(): Promise<TestApp> {
  const a = await startApp({ time: { wall: WALL } });
  apps.push(a);
  return a;
}

function errorCode(body: unknown): string | undefined {
  return (body as { error?: { code?: string } } | null)?.error?.code;
}

async function sessionCount(a: TestApp, userId: string): Promise<number> {
  const rows = await a.db.selectFrom("sessions").select("id").where("user_id", "=", userId).execute();
  return rows.length;
}

describe("auth: Session и «Кто»", () => {
  it("К-4: гость (без cookie и с чужой cookie) → {user: null}", async () => {
    const a = await app();
    expect((await rest(a.url).get("/api/me")).body).toEqual({ user: null });
    expect((await rest(a.url, "__Host-sid=nonsense").get("/api/me")).body).toEqual({ user: null });
  });

  it("К-4: П1 → onboarding_required, nickname null; Игрок → полный Me", async () => {
    const a = await app();
    const p1 = await createPlayer(a.db, { nickname: null, now: WALL });
    const me1 = GetMeResponse.parse((await rest(a.url, p1.cookie).get("/api/me")).body);
    expect(me1.user).toMatchObject({ id: p1.user_id, nickname: null, onboarding_required: true, can_change_nickname: false });

    const pl = await createPlayer(a.db, { now: WALL });
    const me2 = GetMeResponse.parse((await rest(a.url, pl.cookie).get("/api/me")).body);
    expect(me2.user).toMatchObject({
      id: pl.user_id,
      nickname: pl.nickname,
      onboarding_required: false,
      can_change_nickname: true,
      active_game_id: null,
      open_challenge_id: null,
      settings: DEFAULT_USER_SETTINGS,
    });
  });

  it("К-4: истёкшая Session — как гость", async () => {
    const a = await app();
    const p = await createPlayer(a.db, { now: new Date(WALL.getTime() - 31 * DAY) });
    expect((await rest(a.url, p.cookie).get("/api/me")).body).toEqual({ user: null });
    await a.time.advance(0);
    const p2 = await createPlayer(a.db, { now: WALL, sessionExpiresAt: new Date(WALL.getTime() + HOUR) });
    expect(GetMeResponse.parse((await rest(a.url, p2.cookie).get("/api/me")).body).user?.id).toBe(p2.user_id);
    await a.time.advance(HOUR);
    expect((await rest(a.url, p2.cookie).get("/api/me")).body).toEqual({ user: null });
  });
});

describe("auth: первый вход (SECURITY S5)", () => {
  it("К-5: П1 выбирает ник и принимает правила → Игрок", async () => {
    const a = await app();
    const p1 = await createPlayer(a.db, { nickname: null, now: WALL });
    const nickname = randomNickname("new");
    const res = await rest(a.url, p1.cookie).post("/api/me/onboarding", { nickname, terms_accepted: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ user: { nickname, onboarding_required: false, terms_accepted_at: WALL.toISOString() } });
    expect(GetMeResponse.parse((await rest(a.url, p1.cookie).get("/api/me")).body).user?.onboarding_required).toBe(false);
  });

  it("К-5: ошибки ника через HTTP — nickname_invalid 400, nickname_reserved 400, nickname_taken 409", async () => {
    const a = await app();
    const taken = await createPlayer(a.db, { now: WALL });
    const p1 = await createPlayer(a.db, { nickname: null, now: WALL });
    const c = rest(a.url, p1.cookie);
    const bad = await c.post("/api/me/onboarding", { nickname: "a b", terms_accepted: true });
    expect([bad.status, errorCode(bad.body)]).toEqual([400, "nickname_invalid"]);
    const reserved = await c.post("/api/me/onboarding", { nickname: "Admin", terms_accepted: true });
    expect([reserved.status, errorCode(reserved.body)]).toEqual([400, "nickname_reserved"]);
    const dup = await c.post("/api/me/onboarding", { nickname: taken.nickname?.toUpperCase(), terms_accepted: true });
    expect([dup.status, errorCode(dup.body)]).toEqual([409, "nickname_taken"]);
    const noTerms = await c.post("/api/me/onboarding", { nickname: randomNickname(), terms_accepted: false });
    expect([noTerms.status, errorCode(noTerms.body)]).toEqual([400, "validation_failed"]);
  });

  it("К-5: Игрок на onboarding → 409 onboarding_completed; гость → 401 unauthenticated", async () => {
    const a = await app();
    const pl = await createPlayer(a.db, { now: WALL });
    const r1 = await rest(a.url, pl.cookie).post("/api/me/onboarding", { nickname: randomNickname(), terms_accepted: true });
    expect([r1.status, errorCode(r1.body)]).toEqual([409, "onboarding_completed"]);
    const r2 = await rest(a.url).post("/api/me/onboarding", { nickname: randomNickname(), terms_accepted: true });
    expect([r2.status, errorCode(r2.body)]).toEqual([401, "unauthenticated"]);
  });

  it("К-5: П1 на маршруте Игрока (updateMe) → 403 onboarding_required", async () => {
    const a = await app();
    const p1 = await createPlayer(a.db, { nickname: null, now: WALL });
    const res = await rest(a.url, p1.cookie).patch("/api/me", { locale: "ru" });
    expect([res.status, errorCode(res.body)]).toEqual([403, "onboarding_required"]);
  });
});

describe("auth: updateMe", () => {
  it("К-7: Игрок меняет locale, страну и часть настроек", async () => {
    const a = await app();
    const pl = await createPlayer(a.db, { now: WALL, locale: "en" });
    const res = await rest(a.url, pl.cookie).patch("/api/me", { locale: "ru", country: "RU", settings: { sound: false } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ user: { locale: "ru", country: "RU", settings: { ...DEFAULT_USER_SETTINGS, sound: false } } });
    const strict = await rest(a.url, pl.cookie).patch("/api/me", { settings: { volume: 1 } });
    expect(errorCode(strict.body)).toBe("validation_failed");
  });
});

describe("auth: выход", () => {
  it("К-6: logout — только текущая Session, cookie стёрта, sessions_closed с её id", async () => {
    const a = await app();
    const pl = await createPlayer(a.db, { now: WALL });
    const second = await a.auth.createSession(pl.user_id);
    const res = await rest(a.url, pl.cookie).post("/api/auth/logout");
    expect(res.status).toBe(204);
    expect(res.setCookies.join("\n")).toMatch(/__Host-sid=;.*Max-Age=0|__Host-sid=;.*Expires=Thu, 01 Jan 1970/);
    expect((await rest(a.url, pl.cookie).get("/api/me")).body).toEqual({ user: null });
    expect(await sessionCount(a, pl.user_id)).toBe(1);
    expect(a.sessionsClosed).toEqual([{ session_ids: [pl.session_id] }]);
    expect(GetMeResponse.parse((await rest(a.url, `__Host-sid=${second.token}`).get("/api/me")).body).user?.id).toBe(pl.user_id);
  });

  it("К-6: logoutAll — все Session User, одно событие со всеми id; доступно П1", async () => {
    const a = await app();
    const p1 = await createPlayer(a.db, { nickname: null, now: WALL });
    const other = await a.auth.createSession(p1.user_id);
    const res = await rest(a.url, p1.cookie).post("/api/auth/logout-all");
    expect(res.status).toBe(204);
    expect(await sessionCount(a, p1.user_id)).toBe(0);
    expect(a.sessionsClosed).toHaveLength(1);
    expect([...(a.sessionsClosed[0]?.session_ids ?? [])].sort()).toEqual([p1.session_id, other.session.id].sort());
  });

  it("К-6: гость на logout → 401; без Origin → 403", async () => {
    const a = await app();
    const r = await rest(a.url).post("/api/auth/logout");
    expect([r.status, errorCode(r.body)]).toEqual([401, "unauthenticated"]);
    const pl = await createPlayer(a.db, { now: WALL });
    const noOrigin = await fetch(`${a.url}/api/auth/logout`, { method: "POST", headers: { Cookie: pl.cookie ?? "", "X-Protocol-Version": "1" } });
    expect(noOrigin.status).toBe(403);
    expect(await sessionCount(a, pl.user_id)).toBe(1);
  });

  it("К-6: cookie Session ставится с атрибутами S4 и Max-Age 30 дней", async () => {
    const a = await app();
    const pl = await createPlayer(a.db, { now: WALL, token: null });
    const { token } = await a.auth.createSession(pl.user_id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await a.db.selectFrom("sessions").select(["token_hash", "expires_at"]).where("user_id", "=", pl.user_id).execute();
    expect(rows[0]?.token_hash).not.toContain(token);
    expect(rows[0]?.expires_at.toISOString()).toBe(new Date(WALL.getTime() + 30 * DAY).toISOString());
  });
});

describe("auth: user_active и чистка", () => {
  it("К-8: user_active — один на User в сутки при запросах с Session; гость — нет", async () => {
    const a = await app();
    const pl = await createPlayer(a.db, { now: WALL });
    for (let i = 0; i < 3; i++) await rest(a.url, pl.cookie).get("/api/me");
    await rest(a.url).get("/api/me");
    await a.analytics.drain();
    const mine = (await listAnalyticsEvents()).filter((e) => e.user_id === pl.user_id && e.name === "user_active");
    expect(mine).toHaveLength(1);
    await a.time.advance(DAY);
    await rest(a.url, pl.cookie).get("/api/me");
    await a.analytics.drain();
    expect((await listAnalyticsEvents()).filter((e) => e.user_id === pl.user_id && e.name === "user_active")).toHaveLength(2);
  });

  it("К-8: истёкшие Session удаляются раз в сутки, действующие остаются", async () => {
    const a = await app();
    await a.time.advance(0);
    const expiring = await createPlayer(a.db, { now: WALL, sessionExpiresAt: new Date(WALL.getTime() + HOUR) });
    const valid = await createPlayer(a.db, { now: WALL, sessionExpiresAt: new Date(WALL.getTime() + 3 * DAY) });
    await a.time.advance(DAY);
    // Чистка асинхронна: ждём, пока строка исчезнет (не дольше 2 с).
    for (let i = 0; i < 40 && (await sessionCount(a, expiring.user_id)) > 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(await sessionCount(a, expiring.user_id)).toBe(0);
    expect(await sessionCount(a, valid.user_id)).toBe(1);
  });
});
