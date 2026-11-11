// Проверка утверждений ID-токена (SECURITY §4 п.4; TESTING §7.3) — подготовленные утверждения, без Google.
import { describe, expect, it } from "vitest";
import { verifyIdTokenClaims } from "./oidc.ts";
import { localeFromAcceptLanguage } from "./oidc-api.ts";

const NOW = new Date("2026-11-10T12:00:00.000Z");
const NOW_S = NOW.getTime() / 1000;
const CLIENT = "client-1.apps.googleusercontent.com";
const NONCE = "nonce-1";

function claims(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT,
    sub: "1234567890",
    exp: NOW_S + 3600,
    iat: NOW_S - 5,
    nonce: NONCE,
    email: "p@example.test",
    email_verified: true,
    name: "Pat",
    picture: "https://lh3.googleusercontent.com/a/x",
    ...over,
  };
}

const check = (c: Record<string, unknown>) => verifyIdTokenClaims(c, { clientId: CLIENT, nonce: NONCE, now: NOW });

describe("verifyIdTokenClaims", () => {
  it("К-3: верные утверждения → identity из sub, email, email_verified, name, picture", () => {
    expect(check(claims())).toEqual({
      ok: true,
      identity: { sub: "1234567890", email: "p@example.test", email_verified: true, name: "Pat", picture: "https://lh3.googleusercontent.com/a/x" },
    });
    expect(check(claims({ iss: "accounts.google.com" })).ok).toBe(true);
    expect(check(claims({ aud: ["other", CLIENT] })).ok).toBe(true);
  });

  it("К-2: iss не Google → отказ iss", () => {
    for (const iss of ["https://evil.example", "https://accounts.google.com.evil", undefined, ""]) {
      expect(check(claims({ iss }))).toEqual({ ok: false, reason: "iss" });
    }
  });

  it("К-2: aud не наш клиент → отказ aud", () => {
    for (const aud of ["other-client", ["other"], undefined, 1]) expect(check(claims({ aud }))).toEqual({ ok: false, reason: "aud" });
  });

  it("К-2: exp истёк (или ровно сейчас, или нет) → отказ exp", () => {
    for (const exp of [NOW_S - 1, NOW_S, undefined, "9999999999"]) expect(check(claims({ exp }))).toEqual({ ok: false, reason: "exp" });
  });

  it("К-2: iat из будущего больше 60 с → отказ iat; в пределах 60 с — да", () => {
    expect(check(claims({ iat: NOW_S + 61 }))).toEqual({ ok: false, reason: "iat" });
    expect(check(claims({ iat: undefined }))).toEqual({ ok: false, reason: "iat" });
    expect(check(claims({ iat: NOW_S + 60 })).ok).toBe(true);
  });

  it("К-2: nonce не совпал или нет → отказ nonce", () => {
    for (const nonce of ["other", undefined, ""]) expect(check(claims({ nonce }))).toEqual({ ok: false, reason: "nonce" });
  });

  it("К-2: нет sub → отказ sub", () => {
    expect(check(claims({ sub: undefined }))).toEqual({ ok: false, reason: "sub" });
  });

  it("К-3: email_verified не true → identity с email_verified false (S19 решает users)", () => {
    const r = check(claims({ email_verified: "true" }));
    expect(r.ok && r.identity.email_verified).toBe(false);
  });
});

describe("localeFromAcceptLanguage", () => {
  it("К-3: ru* → ru, иначе en", () => {
    expect(localeFromAcceptLanguage("ru-RU,ru;q=0.9,en;q=0.8")).toBe("ru");
    expect(localeFromAcceptLanguage("en-US,ru;q=0.5")).toBe("en");
    expect(localeFromAcceptLanguage(undefined)).toBe("en");
  });
});
