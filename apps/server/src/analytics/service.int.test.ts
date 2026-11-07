// service + repo на реальной PostgreSQL (TESTING §5): параллельные записи, закрытие app.
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { listAnalyticsEvents } from "../../test/support/analytics.ts";
import { startApp, type TestApp } from "../../test/support/app.ts";

const apps: TestApp[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

describe("analytics service", () => {
  it("параллельные user_active одного пользователя за сутки → одна строка", async () => {
    const app = await startApp();
    apps.push(app);
    const userId = randomUUID();
    for (let i = 0; i < 5; i++) app.analytics.record({ name: "user_active", user_id: userId });
    await app.analytics.drain();
    expect((await listAnalyticsEvents()).filter((r) => r.user_id === userId)).toHaveLength(1);
  });

  it("drain без записей не ждёт и не падает", async () => {
    const app = await startApp();
    apps.push(app);
    await expect(app.analytics.drain()).resolves.toBeUndefined();
  });
});
