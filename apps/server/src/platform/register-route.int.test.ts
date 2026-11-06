// registerRoute на голом Fastify с синтетическими RouteDef и заглушкой CallerResolver (design.md E01, ADR;
// AC-30). Синтетические маршруты есть только в этом тесте — не в buildApp и не в REST_ROUTES (SECURITY §1).
import { randomUUID } from "node:crypto";
import { PROTOCOL_VERSION, type RouteDef } from "@chezz/protocol";
import Fastify, { type FastifyInstance, type InjectOptions } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ManualTimeSource } from "../../test/support/time.ts";
import { AppError } from "./errors.ts";
import { installHttp, registerRoute, type Caller, type CallerResolver } from "./http.ts";

const ORIGIN = "https://chezz.test";
const VERSION = { "x-protocol-version": String(PROTOCOL_VERSION) };
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const Echo = z.strictObject({ time_base: z.number().int().min(1).max(180), category: z.enum(["bullet", "blitz", "rapid"]) });

const createThing = {
  method: "POST",
  path: "/api/things/:thing_id",
  who: ["player"],
  params: z.strictObject({ thing_id: z.string().regex(/^[a-z0-9]{4}$/) }),
  body: Echo,
  response: z.object({ thing_id: z.string(), time_base: z.number(), by: z.string() }),
  status: 201,
  errors: [],
} as const satisfies RouteDef;

const readThing = {
  method: "GET",
  path: "/api/thing",
  who: ["guest", "onboarding", "player"],
  query: z.strictObject({ limit: z.coerce.number().int().max(50).optional() }),
  response: z.object({ ok: z.boolean() }),
  status: 200,
  errors: [],
} as const satisfies RouteDef;

const failing = {
  method: "POST",
  path: "/api/fail",
  who: ["guest", "onboarding", "player"],
  body: z.strictObject({ kind: z.enum(["app", "boom", "bad_response", "ws_code"]) }),
  response: z.object({ ok: z.literal(true) }),
  status: 200,
  errors: ["player_busy"],
} as const satisfies RouteDef;

const patchNoBody = {
  method: "PATCH",
  path: "/api/nobody",
  who: ["guest", "onboarding", "player"],
  response: z.object({ ok: z.boolean() }),
  status: 200,
  errors: [],
} as const satisfies RouteDef;

/** «Кто» по заголовку x-test-who (только в этом тесте). */
const stubResolver: CallerResolver = (req) => {
  const who = req.headers["x-test-who"];
  const user = String(req.headers["x-test-user"] ?? "u1");
  const caller: Caller = who === "player" || who === "onboarding" ? { who, user_id: user, session_id: `s-${user}` } : { who: "guest" };
  return Promise.resolve(caller);
};

const opened: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((a) => a.close()));
});

async function bare(rateLimitIpPerMin = 1000): Promise<FastifyInstance> {
  const app = Fastify({ genReqId: () => randomUUID(), requestIdHeader: false, bodyLimit: 16_384 });
  opened.push(app);
  await installHttp(app, { appOrigin: ORIGIN, rateLimitIpPerMin, resolveCaller: stubResolver, time: new ManualTimeSource() });
  registerRoute(app, createThing, async ({ caller, params, body }) => ({
    thing_id: params.thing_id,
    time_base: body.time_base,
    by: caller.who === "guest" ? "guest" : caller.user_id,
  }));
  registerRoute(app, readThing, async ({ query }) => ({ ok: query.limit === undefined || query.limit > 0 }));
  registerRoute(app, failing, async ({ body }) => {
    if (body.kind === "app") throw new AppError("player_busy");
    if (body.kind === "ws_code") throw new AppError("not_your_turn");
    if (body.kind === "boom") throw new Error("secret-internal-detail at /srv/db password=hunter2");
    return { ok: false } as unknown as { ok: true };
  });
  registerRoute(app, patchNoBody, async () => ({ ok: true }));
  registerRoute(app, { ...readThing, path: "/api/limited" }, async () => ({ ok: true }), { rateLimit: { max: 2, timeWindowMs: 60_000 } });
  await app.ready();
  return app;
}

const playerHeaders = { ...VERSION, origin: ORIGIN, "x-test-who": "player" };

function post(app: FastifyInstance, url: string, payload: unknown, headers: Record<string, string> = playerHeaders, extra: Partial<InjectOptions> = {}) {
  return app.inject({ method: "POST", url, payload: payload as InjectOptions["payload"], headers, ...extra });
}

interface ErrorJson {
  error: { code: string; message: string; details: unknown; request_id: string };
}

function expectError(res: Awaited<ReturnType<FastifyInstance["inject"]>>, status: number, code: string): ErrorJson["error"] {
  expect(res.statusCode, res.body).toBe(status);
  const body = res.json<ErrorJson>();
  expect(Object.keys(body.error).sort()).toEqual(["code", "details", "message", "request_id"]);
  expect(body.error.code).toBe(code);
  expect(body.error.request_id).toMatch(UUID_V4);
  expect(res.headers["x-request-id"]).toBe(body.error.request_id);
  expect(res.headers["cache-control"]).toBe("no-store");
  return body.error;
}

describe("registerRoute: успех", () => {
  it("AC-30: POST с Origin, версией, «Кто» = И и строгим телом → def.status, ответ по схеме", async () => {
    const app = await bare();
    const res = await post(app, "/api/things/ab12", { time_base: 5, category: "blitz" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ thing_id: "ab12", time_base: 5, by: "u1" });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
  });

  it("AC-30: GET без Origin проходит; query по схеме", async () => {
    const app = await bare();
    const res = await app.inject({ method: "GET", url: "/api/thing?limit=3", headers: VERSION });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("AC-30: PATCH без тела допустим", async () => {
    const app = await bare();
    const res = await app.inject({ method: "PATCH", url: "/api/nobody", headers: { ...VERSION, origin: ORIGIN } });
    expect(res.statusCode).toBe(200);
  });
});

describe("registerRoute: Origin (SECURITY §6)", () => {
  it("AC-30: POST/PATCH без Origin или с чужим → 403 origin_forbidden", async () => {
    const app = await bare();
    const body = { time_base: 5, category: "blitz" };
    const { origin: _o, ...noOrigin } = playerHeaders;
    expectError(await post(app, "/api/things/ab12", body, noOrigin), 403, "origin_forbidden");
    expectError(await post(app, "/api/things/ab12", body, { ...playerHeaders, origin: "https://evil.example" }), 403, "origin_forbidden");
    expectError(await post(app, "/api/things/ab12", body, { ...playerHeaders, origin: `${ORIGIN}.evil.example` }), 403, "origin_forbidden");
    expectError(await app.inject({ method: "PATCH", url: "/api/nobody", headers: { ...VERSION, origin: "null" } }), 403, "origin_forbidden");
  });

  it("AC-30: Origin проверяется раньше версии, «Кто» и тела", async () => {
    const app = await bare();
    const res = await app.inject({
      method: "POST",
      url: "/api/things/ab12",
      headers: { origin: "https://evil.example", "content-type": "text/plain" },
      payload: "{broken",
    });
    expectError(res, 403, "origin_forbidden");
  });
});

describe("registerRoute: версия протокола (API §7)", () => {
  it("AC-30: нет X-Protocol-Version или чужой → 409 client_outdated", async () => {
    const app = await bare();
    expectError(await app.inject({ method: "GET", url: "/api/thing" }), 409, "client_outdated");
    for (const v of [String(PROTOCOL_VERSION + 1), "0", "", "x"]) {
      expectError(await app.inject({ method: "GET", url: "/api/thing", headers: { "x-protocol-version": v } }), 409, "client_outdated");
    }
  });

  it("AC-30: версия проверяется раньше «Кто»", async () => {
    const app = await bare();
    expectError(await post(app, "/api/things/ab12", {}, { origin: ORIGIN }), 409, "client_outdated");
  });
});

describe("registerRoute: «Кто» (API §1, §12)", () => {
  it("AC-30: гость → 401 unauthenticated; П1 → 403 onboarding_required (на маршруте только И)", async () => {
    const app = await bare();
    const body = { time_base: 5, category: "blitz" };
    expectError(await post(app, "/api/things/ab12", body, { ...VERSION, origin: ORIGIN }), 401, "unauthenticated");
    expectError(await post(app, "/api/things/ab12", body, { ...playerHeaders, "x-test-who": "onboarding" }), 403, "onboarding_required");
  });

  it("AC-30: «Кто» проверяется раньше схемы тела", async () => {
    const app = await bare();
    expectError(await post(app, "/api/things/ab12", { user_id: "x" }, { ...VERSION, origin: ORIGIN }), 401, "unauthenticated");
  });
});

describe("registerRoute: строгая схема (API §5.1, SECURITY §15)", () => {
  it("AC-30: лишнее поле → 400 validation_failed, issue unknown_key с путём ключа, без входных значений", async () => {
    const app = await bare();
    const err = expectError(
      await post(app, "/api/things/ab12", { time_base: 5, category: "blitz", user_id: "victim-user-id-123" }),
      400,
      "validation_failed",
    );
    expect(err.details).toEqual({ issues: [{ path: "user_id", rule: "unknown_key" }] });
  });

  it("AC-30: правила max, min, type, enum, format; details не содержат значений", async () => {
    const app = await bare();
    const cases: [unknown, { path: string; rule: string }][] = [
      [{ time_base: 999, category: "blitz" }, { path: "time_base", rule: "max" }],
      [{ time_base: 0, category: "blitz" }, { path: "time_base", rule: "min" }],
      [{ time_base: "five", category: "blitz" }, { path: "time_base", rule: "type" }],
      [{ time_base: 5, category: "classical-secret" }, { path: "category", rule: "enum" }],
    ];
    for (const [body, issue] of cases) {
      const res = await post(app, "/api/things/ab12", body);
      const err = expectError(res, 400, "validation_failed");
      expect(err.details).toEqual({ issues: [issue] });
      expect(res.body).not.toContain("classical-secret");
      expect(res.body).not.toContain("999");
    }
    const bad = await post(app, "/api/things/NOT-VALID", { time_base: 5, category: "blitz" });
    expect(expectError(bad, 400, "validation_failed").details).toEqual({ issues: [{ path: "thing_id", rule: "format" }] });
    expect(bad.body).not.toContain("NOT-VALID");
  });

  it("AC-30: лишний параметр query → unknown_key; тело на маршруте без схемы тела → 400", async () => {
    const app = await bare();
    const q = await app.inject({ method: "GET", url: "/api/thing?limit=1&secret_param=zzz", headers: VERSION });
    expect(expectError(q, 400, "validation_failed").details).toEqual({ issues: [{ path: "secret_param", rule: "unknown_key" }] });
    const p = await app.inject({ method: "PATCH", url: "/api/nobody", headers: { ...VERSION, origin: ORIGIN }, payload: { a: 1 } });
    expectError(p, 400, "validation_failed");
  });

  it("AC-30: тело не application/json → 400 validation_failed {path: \"\", rule: content_type}", async () => {
    const app = await bare();
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const res = await post(app, "/api/things/ab12", "time_base=5", { ...playerHeaders, "content-type": contentType });
      expect(expectError(res, 400, "validation_failed").details).toEqual({ issues: [{ path: "", rule: "content_type" }] });
    }
  });

  it("AC-30: битый JSON и __proto__ → 400 validation_failed {path: \"\", rule: json}", async () => {
    const app = await bare();
    const headers = { ...playerHeaders, "content-type": "application/json; charset=utf-8" };
    for (const raw of ['{"time_base": 5,', '{"__proto__": {"x": 1}, "time_base": 5, "category": "blitz"}']) {
      const res = await post(app, "/api/things/ab12", raw, headers);
      expect(expectError(res, 400, "validation_failed").details).toEqual({ issues: [{ path: "", rule: "json" }] });
    }
  });

  it("AC-30: тело > 16 КБ → 413 payload_too_large; ровно 16 КБ — не 413", async () => {
    const app = await bare();
    const big = JSON.stringify({ time_base: 5, category: "blitz", pad: "x".repeat(16_384) });
    expectError(await post(app, "/api/things/ab12", big, { ...playerHeaders, "content-type": "application/json" }), 413, "payload_too_large");

    const prefix = '{"time_base":5,"category":"blitz","pad":"';
    const exact = prefix + "x".repeat(16_384 - prefix.length - 2) + '"}';
    expect(Buffer.byteLength(exact)).toBe(16_384);
    const res = await post(app, "/api/things/ab12", exact, { ...playerHeaders, "content-type": "application/json" });
    // Не 413: дальше схема отклоняет лишний ключ pad.
    expect(expectError(res, 400, "validation_failed").details).toEqual({ issues: [{ path: "pad", rule: "unknown_key" }] });
  });
});

describe("registerRoute: ошибки обработчика (API §5)", () => {
  it("AC-30: AppError(code) → статус по §5.2", async () => {
    const app = await bare();
    const err = expectError(await post(app, "/api/fail", { kind: "app" }), 409, "player_busy");
    expect(err.details).toBeNull();
    expect(err.message).toBe("Player busy");
  });

  it("AC-30: неизвестное исключение → 500 internal без подробностей", async () => {
    const app = await bare();
    const res = await post(app, "/api/fail", { kind: "boom" });
    const err = expectError(res, 500, "internal");
    expect(err.details).toBeNull();
    for (const leak of ["secret-internal-detail", "hunter2", "/srv/db", "stack"]) expect(res.body).not.toContain(leak);
  });

  it("AC-30: ответ не по схеме → 500 internal; код только WebSocket в REST → 500 internal", async () => {
    const app = await bare();
    expectError(await post(app, "/api/fail", { kind: "bad_response" }), 500, "internal");
    expectError(await post(app, "/api/fail", { kind: "ws_code" }), 500, "internal");
  });

  it("/api/<нет такого> → 404 not_found в формате §5", async () => {
    const app = await bare();
    expectError(await app.inject({ method: "GET", url: "/api/nope?x=1" }), 404, "not_found");
    expectError(await app.inject({ method: "DELETE", url: "/api/things/ab12" }), 404, "not_found");
  });
});

describe("registerRoute: лимит (ADR-0006)", () => {
  it("AC-27: отказы origin_forbidden, client_outdated, validation_failed и 404 считаются в общий лимит ключа", async () => {
    const app = await bare(4);
    expectError(await post(app, "/api/things/ab12", {}, { "x-test-who": "guest" }), 403, "origin_forbidden");
    expectError(await app.inject({ method: "GET", url: "/api/thing" }), 409, "client_outdated");
    expectError(await post(app, "/api/fail", "x", { ...VERSION, origin: ORIGIN, "content-type": "text/plain" }), 400, "validation_failed");
    expectError(await app.inject({ method: "GET", url: "/api/nope" }), 404, "not_found");
    // Пятый запрос гостя с того же IP к любому /api/* — сверх лимита 4.
    const limited = expectError(await app.inject({ method: "GET", url: "/api/thing", headers: VERSION }), 429, "rate_limited");
    expect(limited.details).toEqual({ retry_after_ms: 60_000 });
  });

  it("AC-25 AC-27: один счётчик на ключ для всех /api/*; два Игрока с одного IP — раздельно", async () => {
    const app = await bare(1000);
    const as = (user: string) => ({ ...VERSION, "x-test-who": "player", "x-test-user": user });
    for (let i = 0; i < 300; i++) {
      const res = await app.inject({ method: "GET", url: i % 2 === 0 ? "/api/thing" : "/api/nope", headers: as("a") });
      expect(res.statusCode).not.toBe(429);
    }
    expectError(await app.inject({ method: "GET", url: "/api/thing", headers: as("a") }), 429, "rate_limited");
    expect((await app.inject({ method: "GET", url: "/api/thing", headers: as("b") })).statusCode).toBe(200);
  });

  it("особый лимит маршрута — свой счётчик, не трогает общий", async () => {
    const app = await bare(5);
    for (let i = 0; i < 2; i++) expect((await app.inject({ method: "GET", url: "/api/limited", headers: VERSION })).statusCode).toBe(200);
    const res = await app.inject({ method: "GET", url: "/api/limited", headers: VERSION });
    expectError(res, 429, "rate_limited");
    expect(Number(res.headers["retry-after"])).toBe(60);
    // Общий счётчик гостя: 3 запроса к /api/limited в него не вошли — 5 запросов проходят.
    for (let i = 0; i < 5; i++) expect((await app.inject({ method: "GET", url: "/api/thing", headers: VERSION })).statusCode).toBe(200);
    expectError(await app.inject({ method: "GET", url: "/api/thing", headers: VERSION }), 429, "rate_limited");
  });

  it("registerRoute до installHttp — ошибка при регистрации", () => {
    const app = Fastify();
    opened.push(app);
    expect(() => registerRoute(app, readThing, async () => ({ ok: true }))).toThrow(/installHttp/);
  });

  it("registerRoute с путём вне /api — ошибка при регистрации", async () => {
    const app = Fastify();
    opened.push(app);
    await installHttp(app, { appOrigin: ORIGIN, rateLimitIpPerMin: 10, resolveCaller: stubResolver, time: new ManualTimeSource() });
    expect(() => registerRoute(app, { ...readThing, path: "/thing" }, async () => ({ ok: true }))).toThrow(/not under \/api/);
  });
});
