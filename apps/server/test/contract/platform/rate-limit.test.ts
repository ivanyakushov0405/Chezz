// Contract: rate limit /api/* по IP для гостя (ADR-0006; SECURITY §9; API §5).
// AC-26, EC-6, EC-7, EC-12. Лимит по умолчанию startApp — 300/мин (design.md E01).
// Каждый тест поднимает свой app: состояние лимита не делится между тестами (ADR-0005 п.2).
import { ErrorResponse, REST_ROUTES } from "@chezz/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startApp, type TestApp } from "../../support/app.ts";

const LIMIT = 300;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEALTH = REST_ROUTES.getHealth.path;

let app: TestApp;

beforeEach(async () => {
  app = await startApp();
});

afterEach(async () => {
  await app.close();
});

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${app.url}${path}`, { headers, signal: AbortSignal.timeout(5_000) });
}

/** Отправляет n запросов подряд; возвращает статусы. Тела вычитываются, чтобы не держать соединения. */
async function burst(n: number, path: string, headers: (i: number) => Record<string, string> = () => ({})): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < n; i++) {
    const res = await get(path, headers(i));
    await res.arrayBuffer();
    statuses.push(res.status);
  }
  return statuses;
}

/** Проверяет ответ 429 по API §5.1 и design.md («HTTP-контракты app»); возвращает тело. */
async function expectRateLimited(res: Response): Promise<ErrorResponse> {
  expect(res.status).toBe(429);

  const retryAfter = res.headers.get("retry-after");
  expect(retryAfter).not.toBeNull();
  expect(retryAfter).toMatch(/^\d+$/);
  expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
  expect(Number(retryAfter)).toBeLessThanOrEqual(60);

  const raw: unknown = await res.json();
  const body = ErrorResponse.parse(raw);
  expect(Object.keys(raw as object)).toStrictEqual(["error"]);
  expect(Object.keys(body.error).sort()).toStrictEqual(["code", "details", "message", "request_id"]);
  expect(body.error.code).toBe("rate_limited");
  expect(typeof body.error.message).toBe("string");
  expect(body.error.message.length).toBeGreaterThan(0);

  expect(body.error.details).toStrictEqual({ retry_after_ms: expect.any(Number) });
  const retryAfterMs = (body.error.details as { retry_after_ms: number }).retry_after_ms;
  expect(Number.isInteger(retryAfterMs)).toBe(true);
  expect(retryAfterMs).toBeGreaterThan(0);
  expect(retryAfterMs).toBeLessThanOrEqual(60_000);

  expect(body.error.request_id).toMatch(UUID_V4);
  expect(res.headers.get("x-request-id")).toBe(body.error.request_id);
  return body;
}

describe("rate limit /api/* (гость, ключ ip:<адрес сокета>)", () => {
  it("AC-26: 300 запросов гостя к /api/health с одного IP — все 200; 301-й → 429 rate_limited с Retry-After", async () => {
    const statuses = await burst(LIMIT, HEALTH);
    expect(statuses.filter((s) => s !== 200)).toStrictEqual([]);

    await expectRateLimited(await get(HEALTH));
  });

  it("AC-26: после 301-го лимит держится — 302-й тоже 429 rate_limited", async () => {
    await burst(LIMIT + 1, HEALTH);

    await expectRateLimited(await get(HEALTH));
  });

  it("AC-26: несуществующий /api/<путь> тоже лимитируется — 301-й → 429 rate_limited", async () => {
    const statuses = await burst(LIMIT, "/api/no-such-operation");
    expect(statuses.filter((s) => s !== 404)).toStrictEqual([]);

    await expectRateLimited(await get("/api/no-such-operation"));
  });

  it("AC-26: лимит одного app не влияет на другой app (своё состояние у каждого buildApp)", async () => {
    await burst(LIMIT + 1, HEALTH);
    const other = await startApp();
    try {
      const res = await fetch(`${other.url}${HEALTH}`, { signal: AbortSignal.timeout(5_000) });
      expect(res.status).toBe(200);
      expect(await res.json()).toStrictEqual({ status: "ok" });
    } finally {
      await other.close();
    }
  });

  it("EC-6: клиент шлёт свой X-Forwarded-For, каждый раз разный — ключ остаётся адресом сокета, 301-й → 429", async () => {
    const xff = (i: number): Record<string, string> => ({
      "X-Forwarded-For": `203.0.${Math.floor(i / 250)}.${(i % 250) + 1}`,
    });
    const statuses = await burst(LIMIT, HEALTH, xff);
    expect(statuses.filter((s) => s !== 200)).toStrictEqual([]);

    await expectRateLimited(await get(HEALTH, { "X-Forwarded-For": "198.51.100.77" }));
  });

  it("EC-7: входящий X-Request-Id: attacker игнорируется — в 429 request_id и заголовок — серверный UUID", async () => {
    await burst(LIMIT, HEALTH, () => ({ "X-Request-Id": "attacker" }));

    const res = await get(HEALTH, { "X-Request-Id": "attacker" });
    const body = await expectRateLimited(res);
    expect(body.error.request_id).not.toBe("attacker");
    expect(res.headers.get("x-request-id")).not.toBe("attacker");
  });

  it("EC-7: X-Request-Id: attacker на успешном ответе тоже игнорируется — заголовок UUID v4", async () => {
    const res = await get(HEALTH, { "X-Request-Id": "attacker" });

    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toMatch(UUID_V4);
  });

  it("EC-7: у разных ответов разные request_id", async () => {
    await burst(LIMIT, HEALTH);

    const first = await expectRateLimited(await get(HEALTH, { "X-Request-Id": "attacker" }));
    const second = await expectRateLimited(await get(HEALTH, { "X-Request-Id": "attacker" }));
    expect(second.error.request_id).not.toBe(first.error.request_id);
  });

  it("EC-12: частые обращения к /api/health считаются в лимит (не исключены) — 300 проходят, 301-й → 429", async () => {
    const statuses = await burst(LIMIT, HEALTH);
    expect(statuses).toHaveLength(LIMIT);
    expect(statuses.every((s) => s === 200)).toBe(true);

    const res = await get(HEALTH);
    expect(res.status).not.toBe(200);
    await expectRateLimited(res);
  });

  it("EC-12: лимит из config — RATE_LIMIT_IP_PER_MIN = 5: 5 запросов к /api/health проходят, 6-й → 429", async () => {
    const small = await startApp({ config: { rateLimitIpPerMin: 5 } });
    try {
      for (let i = 0; i < 5; i++) {
        const res = await fetch(`${small.url}${HEALTH}`, { signal: AbortSignal.timeout(5_000) });
        await res.arrayBuffer();
        expect(res.status, `запрос ${i + 1}`).toBe(200);
      }
      await expectRateLimited(await fetch(`${small.url}${HEALTH}`, { signal: AbortSignal.timeout(5_000) }));
    } finally {
      await small.close();
    }
  });
});
