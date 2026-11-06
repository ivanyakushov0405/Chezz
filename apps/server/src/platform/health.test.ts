// Проверка БД для GET /api/health: таймаут 2 с по TimeSource, таймер не остаётся (design.md E01).
import { describe, expect, it } from "vitest";
import { ManualTimeSource } from "../../test/support/time.ts";
import { databaseAvailable, HEALTH_DB_TIMEOUT_MS } from "./health.ts";

describe("databaseAvailable", () => {
  it("AC-24: ответ БД → true, таймер снят", async () => {
    const time = new ManualTimeSource();
    expect(await databaseAvailable(() => Promise.resolve(), time)).toBe(true);
    expect(time.pendingTimers()).toBe(0);
  });

  it("AC-24 EC-9: ошибка БД → false, таймер снят", async () => {
    const time = new ManualTimeSource();
    expect(await databaseAvailable(() => Promise.reject(new Error("refused")), time)).toBe(false);
    expect(await databaseAvailable(() => { throw new Error("sync"); }, time)).toBe(false);
    expect(time.pendingTimers()).toBe(0);
  });

  it("AC-24: БД молчит → false ровно через 2 с, не раньше", async () => {
    expect(HEALTH_DB_TIMEOUT_MS).toBe(2_000);
    const time = new ManualTimeSource();
    let settled: boolean | undefined;
    const pending = databaseAvailable(() => new Promise<void>(() => undefined), time).then((v) => (settled = v));
    await time.advance(1_999);
    expect(settled).toBeUndefined();
    await time.advance(1);
    await pending;
    expect(settled).toBe(false);
    expect(time.pendingTimers()).toBe(0);
  });
});
