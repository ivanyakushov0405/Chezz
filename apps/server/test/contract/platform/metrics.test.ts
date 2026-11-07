// Contract: порт метрик (design.md E03, «HTTP», «Конфиг»). AC-1…AC-7, EC-12…EC-17.
import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { captureLog, requestPaths, startMetricsApp, type MetricsTestApp } from "../_helpers/observability.ts";

const apps: MetricsTestApp[] = [];
const blockers: Server[] = [];

async function start(options: Parameters<typeof startMetricsApp>[0] = {}): Promise<MetricsTestApp> {
  const app = await startMetricsApp(options);
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  await Promise.all(blockers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

function get(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(5_000) });
}

function listenOn(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(port, "127.0.0.1", () => resolve(srv));
  });
}

function portOf(url: string): number {
  return Number(new URL(url).port);
}

describe("GET /metrics на порту метрик", () => {
  it('AC-1: APP_VERSION=abc123 → 200, text/plain, строка app_info{version="abc123"} 1', async () => {
    const app = await start({ config: { appVersion: "abc123" } });

    const res = await get(`${app.metricsUrl}/metrics`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await res.text()).toMatch(/^app_info\{version="abc123"\} 1$/m);
  });

  it('EC-12: версия по умолчанию в тестах — test → app_info{version="test"} 1', async () => {
    const app = await start();

    const body = await (await get(`${app.metricsUrl}/metrics`)).text();

    expect(body).toMatch(/^app_info\{version="test"\} 1$/m);
  });

  it("AC-2: в теле есть lag p99 event loop, resident memory и cpu seconds", async () => {
    const app = await start();

    const body = await (await get(`${app.metricsUrl}/metrics`)).text();

    expect(body).toMatch(/^nodejs_eventloop_lag_p99_seconds /m);
    expect(body).toMatch(/^process_resident_memory_bytes /m);
    expect(body).toMatch(/^process_cpu_seconds_total /m);
  });

  it("AC-1: любой другой путь → 404 с пустым телом", async () => {
    const app = await start();

    for (const path of ["/", "/metrics/x", "/api/health", "/metricsx"]) {
      const res = await get(`${app.metricsUrl}${path}`);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toBe("");
    }
  });

  it("AC-1: другой метод на /metrics → 404 с пустым телом", async () => {
    const app = await start();

    for (const method of ["POST", "PUT", "DELETE"]) {
      const res = await get(`${app.metricsUrl}/metrics`, { method });
      expect(res.status, method).toBe(404);
      expect(await res.text(), method).toBe("");
    }
  });

  it("AC-4/EC-14: 400 запросов подряд → все 200; строк лога request от порта метрик нет", async () => {
    const log = captureLog();
    const app = await start({ logDestination: log.stream });

    const statuses = new Set<number>();
    for (let i = 0; i < 400; i++) statuses.add((await get(`${app.metricsUrl}/metrics`)).status);

    expect([...statuses]).toStrictEqual([200]);
    expect(requestPaths(log)).not.toContain("/metrics");
    expect(log.lines().filter((l) => l["msg"] === "request")).toHaveLength(0);
  });

  it("AC-5/EC-16: два startApp в одном процессе → у каждого свой /metrics и своя версия", async () => {
    const a = await start({ config: { appVersion: "v-one" } });
    const b = await start({ config: { appVersion: "v-two" } });

    expect(a.metricsUrl).not.toBe(b.metricsUrl);
    const bodyA = await (await get(`${a.metricsUrl}/metrics`)).text();
    const bodyB = await (await get(`${b.metricsUrl}/metrics`)).text();
    expect(bodyA).toMatch(/^app_info\{version="v-one"\} 1$/m);
    expect(bodyA).not.toContain("v-two");
    expect(bodyB).toMatch(/^app_info\{version="v-two"\} 1$/m);
    expect(bodyB).not.toContain("v-one");
  });

  it("AC-6/EC-18: после close() порт метрик свободен", async () => {
    const app = await startMetricsApp();
    const port = portOf(app.metricsUrl);
    expect((await get(`${app.metricsUrl}/metrics`)).status).toBe(200);

    await app.close();

    const srv = await listenOn(port);
    blockers.push(srv);
    expect(srv.listening).toBe(true);
  });

  it("EC-17: порт метрик занят при старте → startApp отклоняется (app не стартует)", async () => {
    const blocker = await listenOn(0);
    blockers.push(blocker);
    const port = (blocker.address() as { port: number }).port;

    await expect(start({ config: { metrics: { host: "127.0.0.1", port } } })).rejects.toThrow();
  });
});

describe("основной порт", () => {
  it("AC-3/EC-13: GET /metrics на основном порту → нет app_info (404 not_found без SPA)", async () => {
    const app = await start();

    const res = await get(`${app.url}/metrics`);
    const text = await res.text();

    expect(text).not.toContain("app_info");
    expect(res.status).toBe(404);
    expect(JSON.parse(text)).toMatchObject({ error: { code: "not_found" } });
  });

  it('AC-7/EC-15: GET /api/health → ровно {"status":"ok"}, без версии', async () => {
    const app = await start({ config: { appVersion: "abc123" } });

    const res = await get(`${app.url}/api/health`);
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toStrictEqual({ status: "ok" });
    expect(text).not.toContain("abc123");
  });
});
