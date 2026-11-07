// CORS нет совсем (API §3, §16; SECURITY §6): EC-11, AC-29.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { REST_ROUTES } from "@chezz/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp, type TestApp } from "../../test/support/app.ts";
import { REPO_ROOT } from "./config.ts";

const EVIL = "https://evil.example";

let app: TestApp;
beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});

function corsHeaders(res: Response): string[] {
  return [...res.headers.keys()].filter((h) => h.startsWith("access-control-"));
}

describe("нет CORS", () => {
  it("EC-11 AC-29: GET, POST и OPTIONS (preflight) с Origin: https://evil.example — нет Access-Control-Allow-*", async () => {
    const requests: [string, RequestInit][] = [
      [REST_ROUTES.getHealth.path, { method: "GET", headers: { origin: EVIL } }],
      [REST_ROUTES.getHealth.path, { method: "OPTIONS", headers: { origin: EVIL, "access-control-request-method": "GET" } }],
      [
        "/api/anything",
        {
          method: "OPTIONS",
          headers: {
            origin: EVIL,
            "access-control-request-method": "POST",
            "access-control-request-headers": "content-type, x-protocol-version",
          },
        },
      ],
      ["/api/anything", { method: "POST", headers: { origin: EVIL, "content-type": "application/json" }, body: "{}" }],
      ["/", { method: "GET", headers: { origin: EVIL } }],
    ];
    for (const [url, init] of requests) {
      const res = await fetch(`${app.url}${url}`, init);
      await res.arrayBuffer();
      expect(corsHeaders(res), `${init.method} ${url}`).toEqual([]);
    }
  });

  it("AC-29: @fastify/cors нет в корневом и всех apps/*, packages/* package.json", async () => {
    const files = [path.join(REPO_ROOT, "package.json")];
    for (const group of ["apps", "packages"]) {
      for (const entry of await readdir(path.join(REPO_ROOT, group), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const file = path.join(REPO_ROOT, group, entry.name, "package.json");
        if (await readFile(file).then(() => true, () => false)) files.push(file);
      }
    }
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const file of files) {
      const pkg = JSON.parse(await readFile(file, "utf8")) as Record<string, Record<string, string> | undefined>;
      for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
        expect(Object.keys(pkg[field] ?? {}), `${file} ${field}`).not.toContain("@fastify/cors");
      }
    }
  });
});
