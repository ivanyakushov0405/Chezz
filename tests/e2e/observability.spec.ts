import { expect, test, type Page } from "@playwright/test";

const CHALLENGE_PATH = "/challenge/3f2b8c1e-5d4a-4e7b-9a6c-1b2d3e4f5a6b";
const SENTRY_HOST = /(^|\.)sentry\.io$|(^|\.)ingest\.|\.ingest\./;

function trackHosts(page: Page): string[] {
  const hosts: string[] = [];
  page.on("request", (request) => {
    hosts.push(new URL(request.url()).hostname);
  });
  return hosts;
}

for (const [label, path] of [
  ["главная", "/"],
  ["страница вызова", CHALLENGE_PATH],
] as const) {
  test(`AC-20: ${label} без DSN — запросов к хостам Sentry нет`, async ({ page }) => {
    const hosts = trackHosts(page);
    await page.goto(path, { waitUntil: "networkidle" });
    expect(hosts.length).toBeGreaterThan(0);
    expect(hosts.filter((h) => SENTRY_HOST.test(h))).toEqual([]);
  });

  test(`AC-20: ${label} — в HTML есть chezz-release и chezz-environment, нет chezz-sentry-dsn`, async ({
    page,
  }) => {
    // webServer отдаёт SPA через `app` (node apps/server/src/main.ts), не vite dev.
    await page.goto(path);
    const release = page.locator('meta[name="chezz-release"]');
    const environment = page.locator('meta[name="chezz-environment"]');
    await expect(release).toHaveCount(1);
    await expect(environment).toHaveCount(1);
    expect(await release.getAttribute("content")).toBeTruthy();
    expect(await environment.getAttribute("content")).toBeTruthy();
    await expect(page.locator('meta[name="chezz-sentry-dsn"]')).toHaveCount(0);
  });
}
