// Sentry сервера сквозь buildApp (design.md E03, «Sentry сервера»; API §5.1; SECURITY §15): AC-10, AC-11, EC-7.
// Маршруты-ловушки добавляются на экземпляр buildApp до ready; транспорт — в память (сети нет, TESTING §1).
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { memorySentryTransport, TEST_SENTRY_DSN, type MemorySentryTransport } from "../../test/support/sentry.ts";
import { workerDatabaseUrl } from "../../test/support/db.ts";
import { ManualTimeSource } from "../../test/support/time.ts";
import { buildApp } from "../app.ts";
import type { Database } from "../database.ts";
import type { AppConfig } from "./config.ts";
import { createDb } from "./db.ts";
import { AppError, validationError } from "./errors.ts";
import { createErrorReporter, type ErrorReporter } from "./sentry.ts";

const ORIGIN = "https://chezz.example";
const CH = "3f2c9a1e-7b4d-4c2a-9e1f-5a6b7c8d9e0f";

interface Harness {
  app: FastifyInstance;
  reporter: ErrorReporter;
  memory: MemorySentryTransport;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

async function harness(): Promise<Harness> {
  const config: AppConfig = {
    appEnv: "staging",
    appOrigin: ORIGIN,
    rateLimitIpPerMin: 300,
    webDistDir: null,
    logLevel: "silent",
    appVersion: "abc123",
    sentryDsn: TEST_SENTRY_DSN,
    metrics: null,
    google: null,
    cookieSecret: "test-cookie-secret-not-a-secret-000000",
  };
  const memory = memorySentryTransport();
  const reporter = createErrorReporter({
    dsn: config.sentryDsn,
    environment: config.appEnv,
    release: config.appVersion,
    origin: config.appOrigin,
    transport: memory.transport,
  });
  const db = createDb<Database>(workerDatabaseUrl(), { onPoolError: () => undefined });
  const app = await buildApp(config, { db, time: new ManualTimeSource(), reporter });

  app.get("/api/test/boom/:id", async () => {
    throw new Error("boom");
  });
  app.get("/api/test/pg", async () => {
    throw Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      detail: "Key (email)=(a@b.c) already exists.",
    });
  });
  app.get("/api/test/validation", async () => {
    throw validationError([{ path: "x", rule: "type" }]);
  });
  app.get("/api/test/zod", async () => {
    z.object({ x: z.string() }).parse({});
    return {};
  });
  app.get("/api/test/forbidden", async () => {
    throw new AppError("forbidden");
  });
  app.get("/api/test/ws-only", async () => {
    // Код только WebSocket в REST — 500 internal (errors.ts classify) → событие.
    throw new AppError("illegal_move");
  });

  cleanups.push(async () => {
    await app.close();
    await db.destroy();
  });
  return { app, reporter, memory };
}

async function eventsAfterFlush(h: Harness): Promise<Array<Record<string, unknown>>> {
  expect(await h.reporter.flush(2_000)).toBe(true);
  return h.memory.events();
}

describe("buildApp + Sentry: 5xx", () => {
  it("AC-10: бросающий маршрут → 500 internal и ровно одно событие с request_id ответа", async () => {
    const h = await harness();

    const res = await h.app.inject({ method: "GET", url: `/api/test/boom/${CH}?token=secret#frag` });

    expect(res.statusCode).toBe(500);
    const body = res.json<{ error: { code: string; request_id: string; details: unknown } }>();
    expect(body.error.code).toBe("internal");
    expect(body.error.details).toBeNull();
    expect(res.headers["x-request-id"]).toBe(body.error.request_id);

    const events = await eventsAfterFlush(h);
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event["tags"]).toMatchObject({ request_id: body.error.request_id });
    expect(event["environment"]).toBe("staging");
    expect(event["release"]).toBe("abc123");
    expect(event["transaction"]).toBe("GET /api/test/boom/:id");
    expect(event["request"]).toStrictEqual({ method: "GET", url: `${ORIGIN}/api/test/boom/${CH}` });
    // Путь /api/test/… не маршрут вызова: маскируется только /api/challenges/<id>; строки запроса нет.
    const text = JSON.stringify(event);
    expect(text).not.toContain("secret");
    expect(text).not.toContain("frag");
    expect(event).not.toHaveProperty("user");
  });

  it("AC-10: код только WebSocket в REST → 500 и одно событие", async () => {
    const h = await harness();

    const res = await h.app.inject({ method: "GET", url: "/api/test/ws-only" });

    expect(res.statusCode).toBe(500);
    expect(await eventsAfterFlush(h)).toHaveLength(1);
  });

  it("EC-7: ошибка pg с detail (e-mail) → событие без detail и e-mail", async () => {
    const h = await harness();

    const res = await h.app.inject({ method: "GET", url: "/api/test/pg" });

    expect(res.statusCode).toBe(500);
    const events = await eventsAfterFlush(h);
    expect(events).toHaveLength(1);
    const text = JSON.stringify(events[0]);
    expect(text).not.toContain("a@b.c");
    expect(text).not.toContain("detail");
    expect(text).not.toContain("Key (email)");
  });

  it("два 5xx подряд → два события, у каждого свой request_id", async () => {
    const h = await harness();

    const a = await h.app.inject({ method: "GET", url: "/api/test/boom/1" });
    const b = await h.app.inject({ method: "GET", url: "/api/test/boom/2" });

    const events = await eventsAfterFlush(h);
    expect(events.map((e) => (e["tags"] as Record<string, unknown>)["request_id"]).sort()).toStrictEqual(
      [a.json<{ error: { request_id: string } }>().error.request_id, b.json<{ error: { request_id: string } }>().error.request_id].sort(),
    );
  });
});

describe("buildApp + Sentry: 4xx не отправляются (AC-11)", () => {
  for (const [url, status, code] of [
    ["/api/test/validation", 400, "validation_failed"],
    ["/api/test/zod", 400, "validation_failed"],
    ["/api/test/forbidden", 403, "forbidden"],
    ["/api/test/no-such", 404, "not_found"],
  ] as const) {
    it(`${code} (${url}) → событий 0`, async () => {
      const h = await harness();

      const res = await h.app.inject({ method: "GET", url });

      expect(res.statusCode).toBe(status);
      expect(res.json<{ error: { code: string } }>().error.code).toBe(code);
      expect(await eventsAfterFlush(h)).toStrictEqual([]);
    });
  }
});

describe("buildApp + Sentry: остановка", () => {
  it("EC-18: событие перед app.close() доставлено (onClose → close с flush)", async () => {
    const h = await harness();
    await h.app.inject({ method: "GET", url: "/api/test/boom/x" });

    await h.app.close();

    expect(h.memory.events()).toHaveLength(1);
  });
});
