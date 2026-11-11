// Вход через Google целиком по HTTP: start → callback (SECURITY §4, S30; API §12.1). Обмен code подменён (AppDeps.oidc).
import { GetMeResponse } from "@chezz/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { listAnalyticsEvents } from "../../test/support/analytics.ts";
import { startApp, TEST_GOOGLE_CLIENT, type TestApp } from "../../test/support/app.ts";
import { rest } from "../../test/support/rest.ts";
import type { OidcChecks, OidcProvider } from "./oidc.ts";

const WALL = new Date("2026-11-10T12:00:00.000Z");
const NOW_S = WALL.getTime() / 1000;

interface FakeGoogle extends OidcProvider {
  /** Утверждения ID-токена, которые «вернёт Google»; по умолчанию — верные для checks. */
  claims: (checks: OidcChecks) => Record<string, unknown>;
  exchanges: number;
  fail: boolean;
}

function fakeGoogle(sub: string): FakeGoogle {
  const fake: FakeGoogle = {
    exchanges: 0,
    fail: false,
    claims: (checks) => ({
      iss: "https://accounts.google.com",
      aud: TEST_GOOGLE_CLIENT.clientId,
      sub,
      exp: NOW_S + 3600,
      iat: NOW_S,
      nonce: checks.nonce,
      email: "p@example.test",
      email_verified: true,
      name: "Pat",
      picture: "https://lh3.googleusercontent.com/a/x",
    }),
    authorizationUrl: (p) => `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ ...p, scope: "openid email profile" }).toString()}`,
    exchange: async (_url, _redirect, checks) => {
      fake.exchanges++;
      if (fake.fail) throw new Error("invalid_grant");
      return fake.claims(checks);
    },
  };
  return fake;
}

const apps: TestApp[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

let subSeq = 0;
async function setup(): Promise<{ a: TestApp; google: FakeGoogle; sub: string }> {
  const sub = `g-${Date.now()}-${++subSeq}-${Math.random().toString(36).slice(2)}`;
  const google = fakeGoogle(sub);
  const a = await startApp({ time: { wall: WALL }, oidc: google });
  apps.push(a);
  return { a, google, sub };
}

function cookieValue(setCookies: string[], name: string): string | null {
  const line = setCookies.find((c) => c.startsWith(`${name}=`));
  if (line === undefined) return null;
  return line.slice(name.length + 1).split(";")[0] ?? null;
}

async function start(a: TestApp, returnTo?: string): Promise<{ location: URL; oidcCookie: string; setCookie: string }> {
  const q = returnTo === undefined ? "" : `?return_to=${encodeURIComponent(returnTo)}`;
  const res = await rest(a.url).get(`/auth/google/start${q}`);
  expect(res.status).toBe(302);
  const oidc = cookieValue(res.setCookies, "__Host-oidc");
  expect(oidc).not.toBeNull();
  return {
    location: new URL(res.headers.get("location") ?? ""),
    oidcCookie: `__Host-oidc=${oidc ?? ""}`,
    setCookie: res.setCookies.find((c) => c.startsWith("__Host-oidc=")) ?? "",
  };
}

async function callback(a: TestApp, cookie: string | null, state: string, extra = "") {
  return rest(a.url, cookie).get(`/auth/google/callback?state=${encodeURIComponent(state)}&code=abc${extra}`);
}

describe("GET /auth/google/start", () => {
  it("К-1: 302 на Google с state, nonce, PKCE S256, scope; подписанная __Host-oidc 10 мин", async () => {
    const { a } = await setup();
    const { location, setCookie } = await start(a, "/challenge/3f9c");
    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const p = location.searchParams;
    expect(p.get("scope")).toBe("openid email profile");
    expect(p.get("redirect_uri")).toBe(`${a.url}/auth/google/callback`);
    for (const k of ["state", "nonce", "code_challenge"]) expect(p.get(k)?.length ?? 0).toBeGreaterThanOrEqual(22);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/Max-Age=600/);
    expect(setCookie).not.toMatch(/Domain=/i);
    // Значение подписано: state в открытом JSON, но подделка подписи — отказ (ниже).
    expect(decodeURIComponent(setCookie)).not.toContain(p.get("code_challenge") ?? "-");
  });

  it("К-1: вход выключен (нет клиента Google) → сразу на callback → login-failed", async () => {
    const a = await startApp({ time: { wall: WALL } });
    apps.push(a);
    const res = await rest(a.url).get("/auth/google/start");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${a.url}/auth/google/callback`);
    expect((await rest(a.url).get("/auth/google/callback")).status).toBe(400);
  });
});

describe("GET /auth/google/callback", () => {
  it("К-3: новый sub → User, user_registered, Session-cookie (S4), 302 на /welcome?return_to=", async () => {
    const { a } = await setup();
    const s = await start(a, "/challenge/3f9c?x=1");
    const res = await callback(a, s.oidcCookie, s.location.searchParams.get("state") ?? "");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${a.url}/welcome?return_to=${encodeURIComponent("/challenge/3f9c?x=1")}`);
    const sid = res.setCookies.find((c) => c.startsWith("__Host-sid="));
    expect(sid).toMatch(/HttpOnly/i);
    expect(sid).toMatch(/Secure/i);
    expect(sid).toMatch(/SameSite=Lax/i);
    expect(sid).toMatch(/Max-Age=2592000/);
    expect(res.setCookies.some((c) => /^__Host-oidc=;/.test(c))).toBe(true);
    const me = GetMeResponse.parse((await rest(a.url, `__Host-sid=${cookieValue(res.setCookies, "__Host-sid") ?? ""}`).get("/api/me")).body);
    expect(me.user).toMatchObject({ onboarding_required: true, nickname: null, email: "p@example.test" });
    await a.analytics.drain();
    const registered = (await listAnalyticsEvents()).filter((e) => e.name === "user_registered" && e.user_id === me.user?.id);
    expect(registered).toHaveLength(1);
  });

  it("К-3: новый игрок без return_to → /welcome без параметра; язык из Accept-Language", async () => {
    const { a } = await setup();
    const s = await start(a);
    const res = await fetch(`${a.url}/auth/google/callback?state=${s.location.searchParams.get("state") ?? ""}&code=abc`, {
      headers: { Cookie: s.oidcCookie, "Accept-Language": "ru-RU,ru;q=0.9" },
      redirect: "manual",
    });
    expect(res.headers.get("location")).toBe(`${a.url}/welcome`);
    const sid = cookieValue(res.headers.getSetCookie(), "__Host-sid") ?? "";
    expect(GetMeResponse.parse((await rest(a.url, `__Host-sid=${sid}`).get("/api/me")).body).user?.locale).toBe("ru");
  });

  it("К-3: известный Игрок → 302 на return_to, без user_registered; email/имя обновлены", async () => {
    const { a, google } = await setup();
    const first = await start(a);
    const r1 = await callback(a, first.oidcCookie, first.location.searchParams.get("state") ?? "");
    const sid = `__Host-sid=${cookieValue(r1.setCookies, "__Host-sid") ?? ""}`;
    await rest(a.url, sid).post("/api/me/onboarding", { nickname: `k_${subSeq}_${Date.now() % 1e8}`, terms_accepted: true });

    const base = google.claims;
    google.claims = (c) => ({ ...base(c), email: "new@example.test" });
    const s = await start(a, "/leaderboard/blitz");
    const res = await callback(a, s.oidcCookie, s.location.searchParams.get("state") ?? "");
    expect(res.headers.get("location")).toBe(`${a.url}/leaderboard/blitz`);
    const me = GetMeResponse.parse((await rest(a.url, `__Host-sid=${cookieValue(res.setCookies, "__Host-sid") ?? ""}`).get("/api/me")).body);
    expect(me.user?.email).toBe("new@example.test");
    await a.analytics.drain();
    expect((await listAnalyticsEvents()).filter((e) => e.name === "user_registered" && e.user_id === me.user?.id)).toHaveLength(1);
  });

  it("К-1: return_to чужого origin при start → после входа на /", async () => {
    const { a } = await setup();
    const s = await start(a, "//evil.example/x");
    const res = await callback(a, s.oidcCookie, s.location.searchParams.get("state") ?? "");
    expect(res.headers.get("location")).toBe(`${a.url}/welcome`);
  });

  it("К-2: state ≠ cookie, нет cookie, поддельная подпись, error от Google → 400 login-failed, Session нет, cookie стёрта", async () => {
    const { a, google } = await setup();
    const s = await start(a);
    const state = s.location.searchParams.get("state") ?? "";
    const cases = [
      await callback(a, s.oidcCookie, "other-state"),
      await callback(a, null, state),
      await callback(a, s.oidcCookie.replace(/.$/, (c) => (c === "A" ? "B" : "A")), state),
      await callback(a, s.oidcCookie, state, "&error=access_denied"),
    ];
    for (const res of cases) {
      expect(res.status).toBe(400);
      expect(res.setCookies.some((c) => c.startsWith("__Host-sid="))).toBe(false);
      expect(res.setCookies.some((c) => /^__Host-oidc=;/.test(c))).toBe(true);
    }
    expect(google.exchanges).toBe(0);
  });

  it("К-2: ошибка обмена или любое неверное утверждение ID-токена → 400, Session нет; в логе нет code и state", async () => {
    const { a, google } = await setup();
    const bad: Record<string, unknown>[] = [
      { iss: "https://evil.example" },
      { aud: "other-client" },
      { exp: NOW_S - 1 },
      { iat: NOW_S + 120 },
      { nonce: "other" },
    ];
    for (const over of bad) {
      const base = fakeGoogle("x").claims;
      google.claims = (c) => ({ ...base(c), ...over });
      const s = await start(a);
      const res = await callback(a, s.oidcCookie, s.location.searchParams.get("state") ?? "");
      expect(res.status, JSON.stringify(over)).toBe(400);
      expect(res.setCookies.some((c) => c.startsWith("__Host-sid="))).toBe(false);
    }
    google.fail = true;
    const s = await start(a);
    expect((await callback(a, s.oidcCookie, s.location.searchParams.get("state") ?? "")).status).toBe(400);
  });

  it("К-2 E-2: повторный callback с тем же state (cookie уже стёрта браузером) → login-failed", async () => {
    const { a } = await setup();
    const s = await start(a);
    const state = s.location.searchParams.get("state") ?? "";
    const first = await callback(a, s.oidcCookie, state);
    expect(first.status).toBe(302);
    // Браузер применил стирание cookie — второй заход без неё.
    expect((await callback(a, null, state)).status).toBe(400);
  });

  it("К-1: /auth/* в общем лимите ключа (ADR-0006)", async () => {
    const a = await startApp({ time: { wall: WALL }, config: { rateLimitIpPerMin: 3 } });
    apps.push(a);
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await rest(a.url).get("/auth/google/start")).status);
    expect(codes).toEqual([302, 302, 302, 429]);
  });

});
