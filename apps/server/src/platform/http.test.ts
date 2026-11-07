// Ключ лимита (ADR-0006 п.1) и хранилище счётчиков. AC-25.
import { describe, expect, it } from "vitest";
import { ManualTimeSource } from "../../test/support/time.ts";
import { apiRateLimit, isApiPath, rateLimitKey, type Caller } from "./http.ts";
import { SharedRateLimitStore } from "./rate-limit-store.ts";

const player = (user_id: string): Caller => ({ who: "player", user_id, session_id: `s-${user_id}` });

describe("rateLimitKey", () => {
  it("AC-25: гость → ip:<ip>", () => {
    expect(rateLimitKey({ who: "guest" }, "203.0.113.7")).toBe("ip:203.0.113.7");
  });

  it("AC-25: onboarding и player → user:<user_id>, адрес не важен", () => {
    expect(rateLimitKey({ who: "onboarding", user_id: "u1", session_id: "s" }, "203.0.113.7")).toBe("user:u1");
    expect(rateLimitKey(player("u2"), "203.0.113.7")).toBe("user:u2");
    expect(rateLimitKey(player("u2"), "198.51.100.1")).toBe("user:u2");
  });

  it("AC-25: два разных user_id с одного IP — разные ключи; гость с того же IP — третий", () => {
    const keys = new Set([rateLimitKey(player("a"), "10.0.0.1"), rateLimitKey(player("b"), "10.0.0.1"), rateLimitKey({ who: "guest" }, "10.0.0.1")]);
    expect(keys.size).toBe(3);
  });

  it("AC-25: IPv6 гостя — подсеть /64; IPv4-mapped — как IPv4", () => {
    expect(rateLimitKey({ who: "guest" }, "2001:db8:1:2:aaaa::1")).toBe(rateLimitKey({ who: "guest" }, "2001:db8:1:2:bbbb::2"));
    expect(rateLimitKey({ who: "guest" }, "::ffff:203.0.113.7")).toBe("ip:203.0.113.7");
  });
});

describe("isApiPath", () => {
  it("только /api и /api/…", () => {
    for (const p of ["/api", "/api/", "/api/health", "/api?x=1"]) expect(isApiPath(p), p).toBe(true);
    for (const p of ["/", "/apix", "/auth/google/start", "/assets/api.js"]) expect(isApiPath(p), p).toBe(false);
  });
});

describe("SharedRateLimitStore", () => {
  function incr(store: SharedRateLimitStore, key: string, windowMs = 60_000): { current: number; ttl: number } {
    let out: { current: number; ttl: number } | undefined;
    store.incr(key, (_err, res) => (out = res), windowMs);
    if (!out) throw new Error("no result");
    return out;
  }

  it("child() — то же хранилище: один счётчик ключа на все маршруты", () => {
    const store = new SharedRateLimitStore(new ManualTimeSource());
    const child = store.child();
    expect(child).toBe(store);
    incr(store, "ip:1");
    expect(incr(child as SharedRateLimitStore, "ip:1").current).toBe(2);
    expect(incr(store, "ip:2").current).toBe(1);
  });

  it("окно по TimeSource: ttl убывает, после окна счёт с 1", async () => {
    const time = new ManualTimeSource();
    const store = new SharedRateLimitStore(time);
    expect(incr(store, "k")).toEqual({ current: 1, ttl: 60_000 });
    await time.advance(15_000);
    expect(incr(store, "k")).toEqual({ current: 2, ttl: 45_000 });
    await time.advance(45_000);
    expect(incr(store, "k")).toEqual({ current: 1, ttl: 60_000 });
  });

  it("apiRateLimit: без opts — общий счётчик (нет groupId); с opts — свой groupId", () => {
    expect(apiRateLimit()).not.toHaveProperty("groupId");
    expect(apiRateLimit({ max: 5, timeWindowMs: 3_600_000, group: "feedback" })).toMatchObject({ max: 5, timeWindow: 3_600_000, groupId: "#feedback" });
  });
});
