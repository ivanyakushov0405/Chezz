// `caddy validate` для deploy/Caddyfile в образе caddy:2 (E02 T-2; design П9). Проект deploy-image: нужен Docker-демон.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRepoFile, REPO_ROOT, runCmd, tail } from "./support/index.ts";

describe("deploy/Caddyfile — caddy validate", () => {
  it("AC-14: caddy validate (caddy:2) проходит при APP_DOMAIN, ACME_EMAIL, SENTRY_INGEST", async () => {
    await readRepoFile("deploy/Caddyfile");
    const caddyfile = join(REPO_ROOT, "deploy", "Caddyfile");
    const r = await runCmd(
      "docker",
      [
        "run",
        "--rm",
        "-e",
        "APP_DOMAIN=chezz.test",
        "-e",
        "ACME_EMAIL=ops@chezz.test",
        "-e",
        "SENTRY_INGEST=o0.ingest.sentry.io",
        "-v",
        `${caddyfile}:/etc/caddy/Caddyfile:ro`,
        "caddy:2",
        "caddy",
        "validate",
        "--config",
        "/etc/caddy/Caddyfile",
        "--adapter",
        "caddyfile",
      ],
      { timeoutMs: 300_000 },
    );
    expect(r.code, `caddy validate:\n${tail(r.stdout + r.stderr)}`).toBe(0);
  });

  it("AC-15 (адаптер): JSON-конфиг содержит оба хоста и upstream app:3000, app-staging:3000, без 9464", async () => {
    await readRepoFile("deploy/Caddyfile");
    const caddyfile = join(REPO_ROOT, "deploy", "Caddyfile");
    const r = await runCmd(
      "docker",
      [
        "run",
        "--rm",
        "-e",
        "APP_DOMAIN=chezz.test",
        "-e",
        "ACME_EMAIL=ops@chezz.test",
        "-e",
        "SENTRY_INGEST=o0.ingest.sentry.io",
        "-v",
        `${caddyfile}:/etc/caddy/Caddyfile:ro`,
        "caddy:2",
        "caddy",
        "adapt",
        "--config",
        "/etc/caddy/Caddyfile",
        "--adapter",
        "caddyfile",
      ],
      { timeoutMs: 300_000 },
    );
    expect(r.code, `caddy adapt:\n${tail(r.stderr)}`).toBe(0);
    const json = r.stdout;
    expect(json).toContain('"chezz.test"');
    expect(json).toContain('"staging.chezz.test"');
    expect(json).toContain('"dial":"app:3000"');
    expect(json).toContain('"dial":"app-staging:3000"');
    expect(json).not.toContain("9464");
    expect(json).toContain("wss://{http.request.host}");
    expect(json).toContain("https://o0.ingest.sentry.io");
  });
});
