// Contract: маскировка id вызова в логе запросов (SECURITY §15; design.md E03). AC-8, EC-1, EC-2.
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { captureLog, requestPaths, startMetricsApp, type LogCapture, type MetricsTestApp } from "../_helpers/observability.ts";

let app: MetricsTestApp;
let log: LogCapture;

afterEach(async () => {
  await app.close();
});

async function setup(): Promise<void> {
  log = captureLog();
  app = await startMetricsApp({ logDestination: log.stream });
}

async function call(path: string, method = "GET"): Promise<Response> {
  return fetch(`${app.url}${path}`, { method, signal: AbortSignal.timeout(5_000) });
}

async function pathsAfter(count: number): Promise<string[]> {
  await expect.poll(() => requestPaths(log).length, { timeout: 5_000 }).toBeGreaterThanOrEqual(count);
  return requestPaths(log);
}

describe("лог запроса: путь без id вызова", () => {
  it("AC-8: GET /challenge/<uuid> → path /challenge/:id, uuid в логе нет", async () => {
    await setup();
    const id = randomUUID();

    await call(`/challenge/${id}`);

    expect(await pathsAfter(1)).toContain("/challenge/:id");
    expect(log.raw()).not.toContain(id);
  });

  it("AC-8: POST /api/challenges/<uuid>/accept → path /api/challenges/:id/accept", async () => {
    await setup();
    const id = randomUUID();

    await call(`/api/challenges/${id}/accept`, "POST");

    expect(await pathsAfter(1)).toContain("/api/challenges/:id/accept");
    expect(log.raw()).not.toContain(id);
  });

  it("AC-8/EC-2: GET /api/challenges/<uuid>?x=1 (404) → path /api/challenges/:id, ответ not_found", async () => {
    await setup();
    const id = randomUUID();

    const res = await call(`/api/challenges/${id}?x=1`);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
    expect(await pathsAfter(1)).toContain("/api/challenges/:id");
    expect(log.raw()).not.toContain(id);
  });

  it("AC-8/EC-1: GET /game/<uuid> не меняется", async () => {
    await setup();
    const id = randomUUID();

    await call(`/game/${id}`);

    expect(await pathsAfter(1)).toContain(`/game/${id}`);
  });

  it("EC-1: /api/challenges без id не меняется", async () => {
    await setup();

    await call("/api/challenges");

    expect(await pathsAfter(1)).toContain("/api/challenges");
  });
});
