// Acceptance: `createErrorReporter` сервера (design.md E03, «Публичные интерфейсы для тестов» → «Sentry сервера
// (platform/sentry.ts, T-3)»; SECURITY §15; OPERATIONS §12.4, O22; ADR-0010). Транспорт подменён тестовым (в память),
// сети нет (TESTING §1). Фильтр scrub по полям покрыт в acceptance/protocol/scrub.test.ts (T-1); здесь — что события
// репортёра реально проходят через него и несут контекст запроса.
// AC-10, AC-12 (sendDefaultPii: false — по результату), AC-18, AC-19 (сервер), EC-3…EC-7, EC-10, EC-11, EC-16, EC-18.
import { describe, expect, it } from "vitest";
import { createErrorReporter } from "../../../src/platform/sentry.ts";

type ReporterOptions = Parameters<typeof createErrorReporter>[0];
type Transport = NonNullable<ReporterOptions["transport"]>;

const DSN = "https://public@o0.ingest.sentry.io/0";
const ORIGIN = "https://chezz.example";
const CH = "3f2c9a1e-7b4d-4c2a-9e1f-5a6b7c8d9e0f";
const GAME = "9a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const USER = "0d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6";
const REQ = "5b0e7c1a-2d3f-4a5b-9c6d-7e8f9a0b1c2d";

interface Event {
  environment?: string;
  release?: string;
  transaction?: string;
  message?: string;
  level?: string;
  tags?: Record<string, unknown>;
  user?: Record<string, unknown>;
  request?: Record<string, unknown>;
  exception?: { values?: Array<{ type?: string; value?: string }> };
  [key: string]: unknown;
}

type SendMode = "ok" | "reject" | "throw" | "429" | "hang";

/** Транспорт в память: события из конвертов (item type "event"); режим имитирует недоступный Sentry (EC-11). */
function memoryTransport(mode: SendMode = "ok"): { transport: Transport; events: Event[]; sends: () => number } {
  const events: Event[] = [];
  let sends = 0;
  const transport = ((): unknown => ({
    send(envelope: unknown): Promise<unknown> {
      sends++;
      const items = (envelope as [unknown, Array<[{ type?: string }, unknown]>])[1];
      for (const [header, payload] of items) {
        if (header.type === "event") events.push(payload as Event);
      }
      if (mode === "throw") throw new Error("network down");
      if (mode === "reject") return Promise.reject(new Error("network down"));
      if (mode === "429") return Promise.resolve({ statusCode: 429, headers: { "retry-after": "60", "x-sentry-rate-limits": null } });
      if (mode === "hang") return new Promise<unknown>(() => undefined);
      return Promise.resolve({ statusCode: 200 });
    },
    flush(): Promise<boolean> {
      return Promise.resolve(true);
    },
  })) as unknown as Transport;
  return { transport, events, sends: () => sends };
}

function reporter(overrides: Partial<ReporterOptions> = {}) {
  const mem = memoryTransport();
  const r = createErrorReporter({
    dsn: DSN,
    environment: "staging",
    release: "abc123",
    origin: ORIGIN,
    transport: mem.transport,
    ...overrides,
  });
  return { r, events: mem.events, sends: mem.sends };
}

async function captureOne(error: unknown, ctx?: Parameters<ReturnType<typeof createErrorReporter>["captureException"]>[1]) {
  const { r, events } = reporter();
  r.captureException(error, ctx);
  expect(await r.flush(2_000)).toBe(true);
  expect(events).toHaveLength(1);
  return events[0]!;
}

describe("createErrorReporter: событие 5xx", () => {
  it("AC-10: одна captureException → ровно одно событие; environment = APP_ENV, release = APP_VERSION", async () => {
    const event = await captureOne(new Error("boom"), { request_id: REQ, method: "GET", route: "/api/health", path: "/api/health" });

    expect(event.environment).toBe("staging");
    expect(event.release).toBe("abc123");
  });

  it("AC-10: tags.request_id = request_id из контекста (тот же, что в ответе и в логе)", async () => {
    const event = await captureOne(new Error("boom"), { request_id: REQ, method: "GET", route: "/api/health", path: "/api/health" });

    expect(event.tags?.["request_id"]).toBe(REQ);
  });

  it("AC-10: request.method и request.url = APP_ORIGIN + путь; transaction = \"<METHOD> <шаблон маршрута>\"", async () => {
    const event = await captureOne(new Error("boom"), {
      request_id: REQ,
      method: "POST",
      route: "/api/challenges/:id/accept",
      path: "/api/challenges/:id/accept",
    });

    expect(event.request?.["method"]).toBe("POST");
    expect(event.request?.["url"]).toBe(`${ORIGIN}/api/challenges/:id/accept`);
    expect(event.transaction).toBe("POST /api/challenges/:id/accept");
  });

  it("AC-10: маршрут неизвестен → transaction = \"<METHOD> <маскированный путь>\"", async () => {
    const event = await captureOne(new Error("boom"), { request_id: REQ, method: "GET", path: `/challenge/${CH}` });

    expect(event.transaction).toBe("GET /challenge/:id");
    expect(JSON.stringify(event)).not.toContain(CH);
  });

  it("AC-10: исключение в событии — тип и сообщение ошибки", async () => {
    class BoomError extends Error {
      override name = "BoomError";
    }
    const event = await captureOne(new BoomError("kaboom"), { request_id: REQ, method: "GET", path: "/api/health" });

    const values = event.exception?.values ?? [];
    expect(values.some((v) => v.type === "BoomError" && v.value === "kaboom")).toBe(true);
  });

  it("AC-10: три captureException разных ошибок → три события (по одному на ошибку, без дублей)", async () => {
    const { r, events } = reporter();

    r.captureException(new Error("a"), { request_id: REQ });
    r.captureException(new Error("b"), { request_id: REQ });
    r.captureException(new Error("c"), { request_id: REQ });
    await r.flush(2_000);

    expect(events).toHaveLength(3);
  });

  it("captureMessage(message, level) → одно событие с message и level", async () => {
    const { r, events } = reporter();

    r.captureMessage("something odd", "warning");
    await r.flush(2_000);

    expect(events).toHaveLength(1);
    expect(events[0]!.message ?? (events[0]!["logentry"] as { message?: string } | undefined)?.message).toBe("something odd");
    expect(events[0]!.level).toBe("warning");
  });
});

describe("createErrorReporter: событие проходит фильтр SECURITY §15", () => {
  it("EC-3: путь со строкой запроса и фрагментом → request.url без ?… и #…, id → :id, query_string нет", async () => {
    const event = await captureOne(new Error("boom"), { request_id: REQ, method: "GET", path: `/challenge/${CH}?x=1#y` });

    expect(event.request?.["url"]).toBe(`${ORIGIN}/challenge/:id`);
    expect(event.request).not.toHaveProperty("query_string");
  });

  it("EC-3: /auth/google/callback?code=…&state=… → request.url без code и state", async () => {
    const event = await captureOne(new Error("boom"), {
      request_id: REQ,
      method: "GET",
      route: "/auth/google/callback",
      path: "/auth/google/callback?code=c0de&state=st4te",
    });

    expect(event.request?.["url"]).toBe(`${ORIGIN}/auth/google/callback`);
    expect(event.request).not.toHaveProperty("query_string");
    expect(String(event.request?.["url"])).not.toContain("c0de");
    expect(String(event.request?.["url"])).not.toContain("st4te");
  });

  it("EC-4: id вызова в тексте исключения → exception.values[].value с :id, остальной текст сохранён", async () => {
    const event = await captureOne(new Error(`challenge /challenge/${CH} expired`), { request_id: REQ });

    const values = (event.exception?.values ?? []).map((v) => v.value);
    expect(values).toContain("challenge /challenge/:id expired");
    expect(JSON.stringify(event)).not.toContain(CH);
  });

  it("EC-4: id вызова в captureMessage → message с :id", async () => {
    const { r, events } = reporter();

    r.captureMessage(`bad /api/challenges/${CH}/accept`, "error");
    await r.flush(2_000);

    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0])).not.toContain(CH);
    expect(JSON.stringify(events[0])).toContain("/api/challenges/:id/accept");
  });

  it("EC-4: /game/<id> в пути и тексте не маскируется", async () => {
    const event = await captureOne(new Error(`game /game/${GAME} broke`), { request_id: REQ, method: "GET", path: `/game/${GAME}` });

    expect(event.request?.["url"]).toBe(`${ORIGIN}/game/${GAME}`);
    expect((event.exception?.values ?? []).map((v) => v.value)).toContain(`game /game/${GAME} broke`);
  });

  it("EC-5/AC-12: в событии нет request.cookies, request.headers, request.data, request.query_string, request.env", async () => {
    const event = await captureOne(new Error("boom"), { request_id: REQ, method: "POST", route: "/api/x", path: "/api/x?q=1" });

    for (const field of ["cookies", "headers", "data", "query_string", "env"]) {
      expect(event.request, field).not.toHaveProperty(field);
    }
  });

  it("EC-6/AC-12: user_id в контексте → user = { id } ровно", async () => {
    const event = await captureOne(new Error("boom"), { request_id: REQ, user_id: USER });

    expect(event.user).toStrictEqual({ id: USER });
  });

  it("EC-6/AC-12/AC-19: без user_id (Гость, без Session) → поля user нет, ip_address нет (sendDefaultPii: false)", async () => {
    const event = await captureOne(new Error("boom"), { request_id: REQ, method: "GET", path: "/api/health" });

    expect(event).not.toHaveProperty("user");
    expect(JSON.stringify(event)).not.toContain("ip_address");
    expect(JSON.stringify(event)).not.toContain("{{auto}}");
  });

  it("EC-7: ошибка pg с detail (Key (email)=(…)) → в событии нет detail и e-mail", async () => {
    const err = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      detail: "Key (email)=(a@b.c) already exists.",
      table: "users",
      constraint: "users_email_key",
    });

    const event = await captureOne(err, { request_id: REQ });

    const text = JSON.stringify(event);
    expect(text).not.toContain("a@b.c");
    expect(text).not.toContain("Key (email)");
  });
});

describe("createErrorReporter: без DSN и недоступный Sentry", () => {
  it("AC-18/EC-10: dsn: null → enabled = false; captureException / captureMessage не вызывают транспорт", async () => {
    const mem = memoryTransport();
    const r = createErrorReporter({ dsn: null, environment: "dev", release: "dev", origin: ORIGIN, transport: mem.transport });

    expect(r.enabled).toBe(false);
    r.captureException(new Error("boom"), { request_id: REQ });
    r.captureMessage("x", "error");
    await r.flush(500);

    expect(mem.sends()).toBe(0);
    expect(mem.events).toHaveLength(0);
  });

  it("AC-18/EC-10: dsn: null → flush разрешается (не реджектится, не висит)", async () => {
    const r = createErrorReporter({ dsn: null, environment: "dev", release: "dev", origin: ORIGIN });

    await expect(r.flush(500)).resolves.toEqual(expect.any(Boolean));
  });

  it("DSN задан → enabled = true", () => {
    const { r } = reporter();

    expect(r.enabled).toBe(true);
  });

  for (const mode of ["reject", "throw", "429"] as const) {
    it(`EC-11: транспорт ${mode} → captureException не бросает, flush не реджектится, следующие события отправляются`, async () => {
      const mem = memoryTransport(mode);
      const r = createErrorReporter({ dsn: DSN, environment: "prod", release: "abc123", origin: ORIGIN, transport: mem.transport });

      expect(() => r.captureException(new Error("first"), { request_id: REQ })).not.toThrow();
      await expect(r.flush(2_000)).resolves.toEqual(expect.any(Boolean));
      expect(() => r.captureMessage("second", "error")).not.toThrow();
      await expect(r.flush(2_000)).resolves.toEqual(expect.any(Boolean));

      expect(mem.sends()).toBeGreaterThanOrEqual(1);
    });
  }

  it("EC-11: Sentry «висит» → captureException возвращается сразу (≤ 50 мс), запрос не замедляется", () => {
    const mem = memoryTransport("hang");
    const r = createErrorReporter({ dsn: DSN, environment: "prod", release: "abc123", origin: ORIGIN, transport: mem.transport });

    const started = performance.now();
    for (let i = 0; i < 10; i++) r.captureException(new Error(`e${i}`), { request_id: REQ });

    expect(performance.now() - started).toBeLessThanOrEqual(50);
  });

  it("EC-18/EC-9: Sentry «висит» → flush(300) разрешается в пределах таймаута (≤ 1,5 с), не реджектится", async () => {
    const mem = memoryTransport("hang");
    const r = createErrorReporter({ dsn: DSN, environment: "prod", release: "abc123", origin: ORIGIN, transport: mem.transport });
    r.captureException(new Error("boom"), { request_id: REQ });

    const started = performance.now();
    const result = await r.flush(300);

    expect(typeof result).toBe("boolean");
    expect(performance.now() - started).toBeLessThanOrEqual(1_500);
  });

  it("EC-18: captureException и сразу flush → событие доставлено до разрешения flush, flush = true", async () => {
    const { r, events } = reporter();

    r.captureException(new Error("before close"), { request_id: REQ });
    const ok = await r.flush(2_000);

    expect(ok).toBe(true);
    expect(events).toHaveLength(1);
  });
});

describe("createErrorReporter: экземпляры независимы (ADR-0005 п.2)", () => {
  it("EC-16: два репортёра в одном процессе → у каждого свои события, environment и release", async () => {
    const a = reporter({ environment: "staging", release: "aaa" });
    const b = reporter({ environment: "prod", release: "bbb" });

    a.r.captureException(new Error("from a"), { request_id: REQ });
    b.r.captureException(new Error("from b"), { request_id: REQ });
    b.r.captureException(new Error("from b 2"), { request_id: REQ });
    await Promise.all([a.r.flush(2_000), b.r.flush(2_000)]);

    expect(a.events).toHaveLength(1);
    expect(b.events).toHaveLength(2);
    expect(a.events[0]).toMatchObject({ environment: "staging", release: "aaa" });
    expect(b.events.every((e) => e.environment === "prod" && e.release === "bbb")).toBe(true);
  });

  it("EC-16: контекст одного события (request_id, user) не утекает в следующее", async () => {
    const { r, events } = reporter();

    r.captureException(new Error("first"), { request_id: REQ, user_id: USER, method: "GET", path: "/api/x" });
    r.captureException(new Error("second"));
    await r.flush(2_000);

    expect(events).toHaveLength(2);
    const second = events.find((e) => (e.exception?.values ?? []).some((v) => v.value === "second"));
    expect(second).toBeDefined();
    expect(second?.tags?.["request_id"]).toBeUndefined();
    expect(second).not.toHaveProperty("user");
  });
});
