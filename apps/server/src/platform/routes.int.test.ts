// Маршруты Fastify = REST_ROUTES (API §16, P32; ADR-0009): AC-28. У каждого /api/* — лимит (ADR-0006 п.4): AC-27.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { REST_ROUTES } from "@chezz/protocol";
import type { RouteOptions } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { workerDatabaseUrl } from "../../test/support/db.ts";
import { ManualTimeSource } from "../../test/support/time.ts";
import { buildApp } from "../app.ts";
import type { Database } from "../database.ts";
import type { AppConfig } from "./config.ts";
import { createDb } from "./db.ts";

let routes: RouteOptions[] = [];
let distDir = "";

const methodsOf = (r: RouteOptions): string[] => (Array.isArray(r.method) ? r.method : [r.method]).map(String);
const isApi = (url: string): boolean => url === "/api" || url.startsWith("/api/");

beforeAll(async () => {
  // С собранным SPA: статические маршруты тоже попадают в onRoute и не должны мешать сравнению.
  distDir = await mkdtemp(path.join(tmpdir(), "chezz-routes-"));
  await mkdir(path.join(distDir, "assets"));
  await writeFile(path.join(distDir, "index.html"), "<!doctype html><title>Chezz</title>");
  await writeFile(path.join(distDir, "assets", "app-abc123.js"), "export {};");

  const config: AppConfig = {
    appEnv: "dev",
    appOrigin: "http://127.0.0.1:1",
    rateLimitIpPerMin: 300,
    webDistDir: distDir,
    logLevel: "silent",
  };
  const db = createDb<Database>(workerDatabaseUrl());
  const collected: RouteOptions[] = [];
  try {
    const app = await buildApp(config, { db, time: new ManualTimeSource(), onRoute: (r) => collected.push(r) });
    await app.ready();
    await app.close();
  } finally {
    await db.destroy();
  }
  routes = collected;
});

afterAll(async () => {
  await rm(distDir, { recursive: true, force: true });
});

describe("маршруты app", () => {
  it("AC-28: маршруты /api/* (кроме HEAD) = REST_ROUTES по методу и пути", () => {
    const actual = routes
      .filter((r) => isApi(r.url))
      .flatMap((r) =>
        methodsOf(r)
          .filter((m) => m !== "HEAD")
          .map((m) => `${m} ${r.url}`),
      )
      .sort();
    const expected = Object.values(REST_ROUTES)
      .map((d) => `${d.method} ${d.path}`)
      .sort();
    expect(actual).toEqual(expected);
  });

  it("AC-28: нет DELETE (и PUT); нет пути с /api/v1", () => {
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      expect(methodsOf(r), r.url).not.toContain("DELETE");
      expect(methodsOf(r), r.url).not.toContain("PUT");
      expect(r.url, r.url).not.toMatch(/^\/api\/v\d+(\/|$)/);
    }
  });

  it("AC-27: у каждого маршрута /api/* (включая HEAD) есть config.rateLimit", () => {
    const api = routes.filter((r) => isApi(r.url));
    expect(api.length).toBeGreaterThan(0);
    for (const r of api) {
      const config = r.config as { rateLimit?: unknown } | undefined;
      expect(config?.rateLimit, `${methodsOf(r).join(",")} ${r.url}`).toBeTypeOf("object");
    }
  });

  it("статика — без лимита (SECURITY §9) и без маршрута-шаблона /*", () => {
    const statics = routes.filter((r) => !isApi(r.url));
    expect(statics.map((r) => r.url)).toContain("/assets/app-abc123.js");
    for (const r of statics) {
      expect((r.config as { rateLimit?: unknown } | undefined)?.rateLimit, r.url).toBeUndefined();
      expect(r.url, r.url).not.toContain("*");
    }
  });
});
