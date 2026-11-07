// Раздача SPA в app.ts (design.md E01, «HTTP-контракты app»): index.html no-cache, /assets/* immutable,
// фолбэк index.html вне /api, /auth, /ws; статика и HTML без лимита (SECURITY §9).
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp, type TestApp } from "../../test/support/app.ts";
import { injectClientConfig } from "./client-config.ts";

const INDEX = "<!doctype html><head><title>Chezz</title></head><div id=root></div>";
// Отдаётся с <meta> конфига клиента (E03, ADR-0010 п.3); startApp: APP_ENV dev, APP_VERSION test, без DSN.
const SERVED = injectClientConfig(INDEX, { environment: "dev", release: "test", sentryDsn: null });
let distDir = "";
let app: TestApp;

beforeAll(async () => {
  distDir = await mkdtemp(path.join(tmpdir(), "chezz-spa-"));
  await mkdir(path.join(distDir, "assets"));
  await writeFile(path.join(distDir, "index.html"), INDEX);
  await writeFile(path.join(distDir, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  await writeFile(path.join(distDir, "assets", "index-abc123.js"), "console.log(1);");
  app = await startApp({ config: { webDistDir: distDir, rateLimitIpPerMin: 3 } });
});

afterAll(async () => {
  await app.close();
  await rm(distDir, { recursive: true, force: true });
});

async function get(url: string): Promise<{ res: Response; text: string }> {
  const res = await fetch(`${app.url}${url}`);
  return { res, text: await res.text() };
}

describe("SPA", () => {
  it("GET / → 200 text/html, index.html, Cache-Control: no-cache", async () => {
    const { res, text } = await get("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(text).toBe(SERVED);
  });

  it("/assets/* → public, max-age=31536000, immutable", async () => {
    const { res } = await get("/assets/index-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("путь без файла вне /api, /auth, /ws → тот же index.html; /auth, /ws без маршрута — 404 not_found", async () => {
    for (const url of ["/player/magnus", "/game/abc?x=1", "/welcome"]) {
      const { res, text } = await get(url);
      expect(res.status, url).toBe(200);
      expect(res.headers.get("cache-control"), url).toBe("no-cache");
      expect(text, url).toBe(SERVED);
    }
    for (const url of ["/auth/nothing", "/ws"]) {
      const { res, text } = await get(url);
      expect(res.status, url).toBe(404);
      expect(JSON.parse(text)).toMatchObject({ error: { code: "not_found" } });
    }
  });

  it("статика и HTML — без лимита: десятки запросов при лимите 3/мин проходят, /api — в своём счётчике", async () => {
    for (let i = 0; i < 10; i++) {
      for (const url of ["/", "/favicon.svg", "/assets/index-abc123.js", "/player/x"]) {
        expect((await get(url)).res.status, url).toBe(200);
      }
    }
    expect((await get("/api/health")).res.status).toBe(200);
  });
});
