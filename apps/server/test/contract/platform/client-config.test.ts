// Contract: конфигурация Sentry клиента через <meta> в index.html (design.md E03, «HTTP» — основной порт, SPA собран;
// «Клиент (T-5)» — <meta> единственный вход; SECURITY §6 — inline-скриптов нет). T-3, AC-20 (серверная часть), EC-10.
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startSentryApp, TEST_SENTRY_DSN, type SentryAppOptions, type SentryTestApp } from "../_helpers/observability.ts";

const INDEX_HTML =
  '<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<title>Chezz</title>\n' +
  '<script type="module" src="/assets/index-abc.js"></script>\n</head>\n<body><div id="root"></div></body>\n</html>\n';

let distDir: string;
const apps: SentryTestApp[] = [];

beforeAll(async () => {
  distDir = await mkdtemp(join(tmpdir(), "chezz-web-dist-"));
  await mkdir(join(distDir, "assets"));
  await writeFile(join(distDir, "index.html"), INDEX_HTML);
  await writeFile(join(distDir, "assets", "index-abc.js"), "export {};\n");
});

afterAll(async () => {
  await rm(distDir, { recursive: true, force: true });
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function start(options: SentryAppOptions = {}): Promise<SentryTestApp> {
  const app = await startSentryApp({ ...options, config: { webDistDir: distDir, ...options.config } });
  apps.push(app);
  return app;
}

async function html(app: SentryTestApp, path: string): Promise<string> {
  const res = await fetch(`${app.url}${path}`, { signal: AbortSignal.timeout(5_000) });
  expect(res.status, path).toBe(200);
  expect(res.headers.get("content-type"), path).toMatch(/^text\/html/);
  return res.text();
}

function headOf(page: string): string {
  const end = page.indexOf("</head>");
  expect(end).toBeGreaterThan(-1);
  return page.slice(0, end);
}

const PAGES = ["/", "/index.html", `/challenge/${randomUUID()}`];

describe("<meta> конфигурации клиента в index.html", () => {
  for (const path of PAGES) {
    it(`AC-20: GET ${path.replace(/[0-9a-f-]{36}/, "<uuid>")} → перед </head> chezz-environment = APP_ENV, chezz-release = APP_VERSION`, async () => {
      const app = await start({ config: { appEnv: "staging", appVersion: "abc123" } });

      const head = headOf(await html(app, path));

      expect(head).toContain('<meta name="chezz-environment" content="staging">');
      expect(head).toContain('<meta name="chezz-release" content="abc123">');
    });
  }

  for (const path of PAGES) {
    it(`AC-18/EC-10: без DSN — GET ${path.replace(/[0-9a-f-]{36}/, "<uuid>")} без meta chezz-sentry-dsn`, async () => {
      const app = await start();

      const page = await html(app, path);

      expect(page).not.toContain("chezz-sentry-dsn");
      expect(page).not.toContain("sentry.io");
    });
  }

  for (const path of PAGES) {
    it(`AC-20: DSN задан — GET ${path.replace(/[0-9a-f-]{36}/, "<uuid>")} → перед </head> chezz-sentry-dsn = DSN`, async () => {
      const app = await start({ sentry: true });

      const head = headOf(await html(app, path));

      expect(head).toContain(`<meta name="chezz-sentry-dsn" content="${TEST_SENTRY_DSN}">`);
    });
  }

  it("AC-20: значения по умолчанию startApp → chezz-environment = dev, chezz-release = test", async () => {
    const app = await start();

    const head = headOf(await html(app, "/"));

    expect(head).toContain('<meta name="chezz-environment" content="dev">');
    expect(head).toContain('<meta name="chezz-release" content="test">');
  });

  it("AC-20: каждый <meta> вставлен ровно один раз; исходный HTML сохранён", async () => {
    const app = await start({ sentry: true });

    const page = await html(app, "/");

    for (const name of ["chezz-environment", "chezz-release", "chezz-sentry-dsn"]) {
      expect(page.split(`name="${name}"`).length - 1, name).toBe(1);
    }
    expect(page).toContain('<script type="module" src="/assets/index-abc.js"></script>');
    expect(page).toContain('<div id="root"></div>');
  });

  it("SECURITY §6: в отданном HTML нет inline-скриптов (только <script src>)", async () => {
    const app = await start({ sentry: true });

    const page = await html(app, "/");

    const scripts = page.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag).toMatch(/\bsrc=/);
  });

  it("два app в одном процессе → у каждого свои chezz-release и chezz-environment (EC-16)", async () => {
    const a = await start({ config: { appEnv: "staging", appVersion: "aaa" } });
    const b = await start({ config: { appEnv: "prod", appVersion: "bbb" } });

    const headA = headOf(await html(a, "/"));
    const headB = headOf(await html(b, "/"));

    expect(headA).toContain('<meta name="chezz-release" content="aaa">');
    expect(headA).toContain('<meta name="chezz-environment" content="staging">');
    expect(headB).toContain('<meta name="chezz-release" content="bbb">');
    expect(headB).toContain('<meta name="chezz-environment" content="prod">');
  });

  it("EC-13: GET /metrics на основном порту при собранном SPA → index.html без app_info", async () => {
    const app = await start();

    const page = await html(app, "/metrics");

    expect(page).not.toContain("app_info");
  });
});
