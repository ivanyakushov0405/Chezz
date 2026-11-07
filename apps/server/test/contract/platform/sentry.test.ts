// Contract: Sentry сервера снаружи `app` (design.md E03, «Тестовая инфраструктура» — startApp({ sentry }), sentryEvents();
// «Sentry сервера (platform/sentry.ts, T-3)»; API §5.1 — в Sentry только `internal`). AC-11, AC-18, EC-8, EC-10.
// Каждый тест поднимает свой app: транспорт в память и счётчик лимита не делятся (ADR-0005 п.2).
import { randomUUID } from "node:crypto";
import { ErrorResponse, REST_ROUTES } from "@chezz/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { captureLog, requestPaths, startSentryApp, type SentryAppOptions, type SentryTestApp } from "../_helpers/observability.ts";

const HEALTH = REST_ROUTES.getHealth.path;
const apps: SentryTestApp[] = [];

async function start(options: SentryAppOptions = {}): Promise<SentryTestApp> {
  const app = await startSentryApp(options);
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function call(app: SentryTestApp, path: string, method = "GET"): Promise<Response> {
  const res = await fetch(`${app.url}${path}`, { method, signal: AbortSignal.timeout(5_000) });
  await res.clone().arrayBuffer();
  return res;
}

describe("Sentry сервера: 4xx не отправляются (API §5.1)", () => {
  it("AC-11/EC-8: not_found по /api/<нет маршрута> → 404 not_found, событий Sentry 0", async () => {
    const app = await start({ sentry: true });

    const res = await call(app, "/api/no-such-route");

    expect(res.status).toBe(404);
    expect(ErrorResponse.parse(await res.json()).error.code).toBe("not_found");
    expect(await app.sentryEvents()).toStrictEqual([]);
  });

  it("AC-11/EC-8: not_found по /api/challenges/<uuid> (маршрута нет) → событий Sentry 0", async () => {
    const app = await start({ sentry: true });

    const res = await call(app, `/api/challenges/${randomUUID()}/accept`, "POST");

    expect(res.status).toBe(404);
    expect(ErrorResponse.parse(await res.json()).error.code).toBe("not_found");
    expect(await app.sentryEvents()).toStrictEqual([]);
  });

  it("AC-11/EC-8: not_found вне /api без SPA (webDistDir: null) → событий Sentry 0", async () => {
    const app = await start({ sentry: true });

    const res = await call(app, `/challenge/${randomUUID()}`);

    expect(res.status).toBe(404);
    expect(await app.sentryEvents()).toStrictEqual([]);
  });

  it("AC-11/EC-8: rate_limited → 429, событий Sentry 0", async () => {
    const app = await start({ sentry: true, config: { rateLimitIpPerMin: 2 } });

    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await call(app, HEALTH)).status);
    const limited = await call(app, HEALTH);

    expect(statuses).toContain(429);
    expect(limited.status).toBe(429);
    expect(ErrorResponse.parse(await limited.json()).error.code).toBe("rate_limited");
    expect(await app.sentryEvents()).toStrictEqual([]);
  });

  it("EC-8: строка лога 4xx — как в E01 (одна строка request на запрос), Sentry не трогается", async () => {
    const log = captureLog();
    const app = await start({ sentry: true, logDestination: log.stream });

    await call(app, "/api/no-such-route");

    await expect.poll(() => requestPaths(log).length, { timeout: 5_000 }).toBe(1);
    expect(requestPaths(log)).toStrictEqual(["/api/no-such-route"]);
    expect(await app.sentryEvents()).toStrictEqual([]);
  });

  it("EC-8: успешный запрос (200) → событий Sentry 0", async () => {
    const app = await start({ sentry: true });

    const res = await call(app, HEALTH);

    expect(res.status).toBe(200);
    expect(await app.sentryEvents()).toStrictEqual([]);
  });
});

describe("Sentry сервера: включение и выключение", () => {
  it("AC-18/EC-10: без SENTRY_DSN (startApp по умолчанию) → app стартует, /api/health 200, sentryEvents() = []", async () => {
    const app = await start();

    const res = await call(app, HEALTH);

    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ status: "ok" });
    expect(await app.sentryEvents()).toStrictEqual([]);
  });

  it("AC-18/EC-10: sentryDsn: null явно и sentry не задан → после 4xx и 2xx событий нет", async () => {
    const app = await start({ config: { sentryDsn: null } });

    await call(app, "/api/no-such-route");
    await call(app, HEALTH);

    expect(await app.sentryEvents()).toStrictEqual([]);
  });

  it("EC-11: sentry: true (DSN задан, транспорт в память) → app стартует и отвечает как без Sentry", async () => {
    const app = await start({ sentry: true });

    const res = await call(app, HEALTH);

    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ status: "ok" });
  });

  it("EC-16: два app с sentry: true в одном процессе → у каждого свой транспорт, оба стартуют, событий нет", async () => {
    const a = await start({ sentry: true, config: { appVersion: "aaa" } });
    const b = await start({ sentry: true, config: { appVersion: "bbb" } });

    expect((await call(a, HEALTH)).status).toBe(200);
    expect((await call(b, HEALTH)).status).toBe(200);
    expect(await a.sentryEvents()).toStrictEqual([]);
    expect(await b.sentryEvents()).toStrictEqual([]);
  });

  it("EC-18: close() после работы с sentry: true → завершается без ошибки и в пределах 5 с", async () => {
    const app = await startSentryApp({ sentry: true });
    await call(app, HEALTH);

    const started = performance.now();
    await app.close();

    expect(performance.now() - started).toBeLessThan(5_000);
  });
});
