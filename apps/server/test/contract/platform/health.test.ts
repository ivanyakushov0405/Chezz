// Contract: GET /api/health (API §12.6; design.md E01, «HTTP-контракты app»). AC-24, EC-9, EC-10.
import { GetHealthResponse, PROTOCOL_VERSION, REST_ROUTES } from "@chezz/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startApp, type TestApp } from "../../support/app.ts";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEALTH = REST_ROUTES.getHealth.path;

let app: TestApp;

beforeEach(async () => {
  app = await startApp();
});

afterEach(async () => {
  await app.close();
});

function getHealth(headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${app.url}${HEALTH}`, { headers, signal: AbortSignal.timeout(5_000) });
}

describe("GET /api/health", () => {
  it("AC-24: путь операции getHealth в протоколе — GET /api/health", () => {
    expect(REST_ROUTES.getHealth.method).toBe("GET");
    expect(HEALTH).toBe("/api/health");
  });

  it("AC-24: БД доступна → 200, тело ровно {\"status\":\"ok\"}, Cache-Control: no-store, JSON utf-8", async () => {
    const res = await getHealth({ "X-Protocol-Version": String(PROTOCOL_VERSION) });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const body: unknown = await res.json();
    expect(body).toStrictEqual({ status: "ok" });
    expect(GetHealthResponse.parse(body)).toStrictEqual({ status: "ok" });
  });

  it("AC-24: ответ несёт X-Request-Id — UUID v4, сгенерированный сервером", async () => {
    const res = await getHealth();

    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toMatch(UUID_V4);
  });

  it("AC-24: БД недоступна → 503, тело ровно {\"status\":\"unavailable\"}, ответ ≤ 3 с", async () => {
    await app.database.block();

    const started = performance.now();
    const res = await fetch(`${app.url}${HEALTH}`, { signal: AbortSignal.timeout(3_000) });
    const elapsed = performance.now() - started;

    expect(res.status).toBe(503);
    expect(await res.json()).toStrictEqual({ status: "unavailable" });
    expect(elapsed).toBeLessThanOrEqual(3_000);
  });

  it("EC-9: БД упала → 503 unavailable; поднялась без перезапуска app → снова 200 ok", async () => {
    const before = await getHealth();
    expect(before.status).toBe(200);
    expect(await before.json()).toStrictEqual({ status: "ok" });

    await app.database.block();
    const down = await getHealth();
    expect(down.status).toBe(503);
    expect(await down.json()).toStrictEqual({ status: "unavailable" });

    await app.database.unblock();
    const up = await getHealth();
    expect(up.status).toBe(200);
    expect(await up.json()).toStrictEqual({ status: "ok" });
  });

  it("EC-10: без X-Protocol-Version → 200 {\"status\":\"ok\"}, проверки версии нет", async () => {
    const res = await getHealth();

    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ status: "ok" });
  });

  it("EC-10: с чужим X-Protocol-Version → 200 {\"status\":\"ok\"}, не 409 client_outdated", async () => {
    for (const version of [String(PROTOCOL_VERSION + 1), "0", "garbage"]) {
      const res = await getHealth({ "X-Protocol-Version": version });

      expect(res.status, `X-Protocol-Version: ${version}`).toBe(200);
      expect(await res.json()).toStrictEqual({ status: "ok" });
    }
  });

  it("EC-10: БД недоступна и чужой X-Protocol-Version → 503 unavailable (не client_outdated)", async () => {
    await app.database.block();

    const res = await fetch(`${app.url}${HEALTH}`, {
      headers: { "X-Protocol-Version": String(PROTOCOL_VERSION + 1) },
      signal: AbortSignal.timeout(3_000),
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toStrictEqual({ status: "unavailable" });
  });
});
