// Сборка и содержимое образов app/tools (E02 T-2; OPERATIONS §6.2; design П9, A1). Проект deploy-image:
// нужен Docker-демон, сеть (базовые образы, npm) и `npm run db:test:up` (AC-5).
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTempDir, REPO_ROOT, runCmd, tail, type CmdResult } from "./support/index.ts";

const SUFFIX = randomBytes(4).toString("hex");
const TAG_APP = `chezz-deploy-test-app:${SUFFIX}`;
const TAG_APP_NOVERSION = `chezz-deploy-test-app-nover:${SUFFIX}`;
const TAG_TOOLS = `chezz-deploy-test-tools:${SUFFIX}`;
const BUILD_TIMEOUT = 600_000;

const ADMIN_URL = process.env["TEST_DATABASE_URL"] ?? "postgres://chezz:chezz@127.0.0.1:54329/postgres";

let sha = "";
const builds: Record<string, CmdResult> = {};
let cleanupContext: (() => Promise<void>) | null = null;

/** «Чистый клон»: отслеживаемые и новые неигнорируемые файлы рабочего дерева — без node_modules, .env, сборок. */
async function cleanCloneContext(): Promise<string> {
  const { dir, cleanup } = await makeTempDir("chezz-image-ctx-");
  cleanupContext = cleanup;
  const ls = await runCmd("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  if (ls.code !== 0) throw new Error(`git ls-files: ${ls.stderr}`);
  for (const rel of ls.stdout.split("\0").filter(Boolean)) {
    const src = join(REPO_ROOT, rel);
    if (!existsSync(src)) continue;
    const dst = join(dir, rel);
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(src, dst);
  }
  return dir;
}

async function build(ctx: string, target: "app" | "tools", tag: string, version: string | null): Promise<CmdResult> {
  const args = ["build", "-f", "deploy/Dockerfile", "--target", target, "-t", tag];
  if (version !== null) args.push("--build-arg", `APP_VERSION=${version}`);
  args.push(".");
  return await runCmd("docker", args, { cwd: ctx, timeoutMs: BUILD_TIMEOUT });
}

function requireBuilt(key: string): void {
  const b = builds[key];
  expect(b, `сборка ${key} не выполнялась`).toBeDefined();
  expect(b!.code, `сборка ${key} упала:\n${tail(b!.stderr)}`).toBe(0);
}

async function inspect(tag: string): Promise<{
  User?: string;
  ExposedPorts?: Record<string, unknown>;
  Env?: string[];
  Labels?: Record<string, string>;
  Cmd?: string[];
}> {
  const r = await runCmd("docker", ["image", "inspect", "--format", "{{json .Config}}", tag]);
  expect(r.code, r.stderr).toBe(0);
  return JSON.parse(r.stdout) as Awaited<ReturnType<typeof inspect>>;
}

/** Выполняет sh-скрипт в контейнере образа, возвращает строки `ключ=значение`. */
async function probe(tag: string, script: string): Promise<Record<string, string>> {
  const r = await runCmd("docker", ["run", "--rm", "--entrypoint", "sh", tag, "-c", script], { timeoutMs: 120_000 });
  expect(r.code, `probe:\n${tail(r.stderr)}`).toBe(0);
  const out: Record<string, string> = {};
  for (const l of r.stdout.split(/\r?\n/)) {
    const i = l.indexOf("=");
    if (i > 0) out[l.slice(0, i)] = l.slice(i + 1).trim();
  }
  return out;
}

const exists = (key: string, path: string, kind: "-e" | "-d" | "-f" = "-e"): string =>
  `if [ ${kind} '${path}' ]; then echo ${key}=yes; else echo ${key}=no; fi`;

beforeAll(async () => {
  const head = await runCmd("git", ["rev-parse", "HEAD"]);
  sha = head.stdout.trim();
  const ctx = await cleanCloneContext();
  builds["app"] = await build(ctx, "app", TAG_APP, sha);
  builds["tools"] = await build(ctx, "tools", TAG_TOOLS, sha);
  builds["app-noversion"] = await build(ctx, "app", TAG_APP_NOVERSION, null);
}, 3 * BUILD_TIMEOUT);

afterAll(async () => {
  await runCmd("docker", ["image", "rm", "-f", TAG_APP, TAG_APP_NOVERSION, TAG_TOOLS]);
  await cleanupContext?.();
});

describe("образ app/tools — сборка", () => {
  it("AC-1: docker build --target app --build-arg APP_VERSION=<sha> из чистого клона — успех", () => {
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    requireBuilt("app");
  });

  it("AC-1: docker build --target tools из чистого клона — успех", () => {
    requireBuilt("tools");
  });
});

describe("образ app — метаданные и содержимое", () => {
  it("AC-2: пользователь node (uid 1000), не root", async () => {
    requireBuilt("app");
    const cfg = await inspect(TAG_APP);
    expect(["node", "1000", "node:node", "1000:1000"]).toContain(cfg.User ?? "");
    const p = await probe(TAG_APP, "echo uid=$(id -u); echo user=$(id -un)");
    expect(p).toMatchObject({ uid: "1000", user: "node" });
  });

  it("AC-2: EXPOSE 3000 9464; ENV HOST=0.0.0.0, METRICS_HOST=0.0.0.0, APP_VERSION=<sha>", async () => {
    requireBuilt("app");
    const cfg = await inspect(TAG_APP);
    expect(Object.keys(cfg.ExposedPorts ?? {}).sort()).toEqual(["3000/tcp", "9464/tcp"]);
    expect(cfg.Env ?? []).toEqual(expect.arrayContaining(["HOST=0.0.0.0", "METRICS_HOST=0.0.0.0", `APP_VERSION=${sha}`]));
  });

  it("AC-2: метка org.opencontainers.image.revision=<sha>; CMD начинается с node --enable-source-maps", async () => {
    requireBuilt("app");
    const cfg = await inspect(TAG_APP);
    expect(cfg.Labels?.["org.opencontainers.image.revision"]).toBe(sha);
    expect((cfg.Cmd ?? []).slice(0, 2)).toEqual(["node", "--enable-source-maps"]);
  });

  it("AC-2 (П9): /data/screenshots — 1000:1000, права 700", async () => {
    requireBuilt("app");
    const p = await probe(TAG_APP, "echo st=$(stat -c '%u:%g:%a' /data/screenshots 2>/dev/null || echo none)");
    expect(p["st"]).toBe("1000:1000:700");
  });

  it("AC-3: есть собранный apps/web (/app/apps/web/dist) с файлами .map", async () => {
    requireBuilt("app");
    const p = await probe(
      TAG_APP,
      [
        exists("dist", "/app/apps/web/dist", "-d"),
        exists("index", "/app/apps/web/dist/index.html", "-f"),
        "echo maps=$(find /app/apps/web/dist -name '*.map' -type f 2>/dev/null | wc -l)",
      ].join("; "),
    );
    expect(p["dist"]).toBe("yes");
    expect(p["index"]).toBe("yes");
    expect(Number(p["maps"])).toBeGreaterThan(0);
  });

  it("AC-3: нет tests/, apps/server/test/, apps/server/scripts/, .git, docs, .claude, .env*", async () => {
    requireBuilt("app");
    const p = await probe(
      TAG_APP,
      [
        exists("tests", "/app/tests"),
        exists("server_test", "/app/apps/server/test"),
        exists("server_scripts", "/app/apps/server/scripts"),
        exists("git", "/app/.git"),
        exists("docs", "/app/docs"),
        exists("claude", "/app/.claude"),
        "echo envfiles=$(find /app -path /app/node_modules -prune -o -name '.env*' -print 2>/dev/null | wc -l)",
      ].join("; "),
    );
    expect(p).toMatchObject({
      tests: "no",
      server_test: "no",
      server_scripts: "no",
      git: "no",
      docs: "no",
      claude: "no",
      envfiles: "0",
    });
  });

  it("AC-3: нет dev-зависимостей (vitest, @playwright/test)", async () => {
    requireBuilt("app");
    const p = await probe(
      TAG_APP,
      [
        "echo vitest=$(find /app -type d -path '*/node_modules/vitest' 2>/dev/null | wc -l)",
        "echo playwright=$(find /app -type d -path '*/node_modules/@playwright/test' 2>/dev/null | wc -l)",
      ].join("; "),
    );
    expect(p).toMatchObject({ vitest: "0", playwright: "0" });
  });
});

describe("образ tools", () => {
  it("AC-4: есть apps/server/scripts/seed.ts и dev-зависимости (vitest); пользователь node", async () => {
    requireBuilt("tools");
    const p = await probe(
      TAG_TOOLS,
      [
        exists("seed", "/app/apps/server/scripts/seed.ts", "-f"),
        exists("vitest", "/app/node_modules/vitest", "-d"),
        "echo user=$(id -un)",
        "echo uid=$(id -u)",
      ].join("; "),
    );
    expect(p).toMatchObject({ seed: "yes", vitest: "yes", user: "node", uid: "1000" });
  });
});

describe("образ app — запуск с тестовой БД", () => {
  const dbName = `chezz_deploy_img_${SUFFIX}`;
  const containers: string[] = [];

  const withAdmin = async <T>(fn: (c: pg.Client) => Promise<T>): Promise<T> => {
    const c = new pg.Client({ connectionString: ADMIN_URL });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  };

  const containerDbUrl = (): string => {
    const u = new URL(ADMIN_URL);
    u.hostname = "host.docker.internal";
    u.pathname = `/${dbName}`;
    return u.toString();
  };

  beforeAll(async () => {
    await withAdmin((c) => c.query(`CREATE DATABASE "${dbName}"`));
  });

  afterAll(async () => {
    if (containers.length > 0) await runCmd("docker", ["rm", "-f", ...containers]);
    await withAdmin((c) => c.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`));
  });

  const baseRunArgs = (name: string): string[] => [
    "run",
    "--name",
    name,
    "--add-host",
    "host.docker.internal:host-gateway",
    "-e",
    "APP_ENV=prod",
    "-e",
    "APP_ORIGIN=https://chezz.test",
    "-e",
    `DATABASE_URL=${containerDbUrl()}`,
  ];

  it("AC-5 / EC-37: образ без --build-arg APP_VERSION, APP_ENV=prod — app не стартует (код ≠ 0)", async () => {
    requireBuilt("app-noversion");
    const name = `chezz-deploy-test-nover-${SUFFIX}`;
    containers.push(name);
    const cfg = await inspect(TAG_APP_NOVERSION);
    const ver = (cfg.Env ?? []).find((e) => e.startsWith("APP_VERSION="));
    expect(ver === undefined || ver === "APP_VERSION=").toBe(true);
    const r = await runCmd("docker", [...baseRunArgs(name), TAG_APP_NOVERSION], { timeoutMs: 120_000 });
    expect(r.code, "app не завершился за 120 с — значит, стартовал без APP_VERSION").not.toBe(-1);
    expect(r.code).not.toBe(0);
  });

  it("AC-5: с APP_VERSION — GET /api/health = {status:ok}, /metrics содержит app_info{version=<sha>} 1", async () => {
    requireBuilt("app");
    const name = `chezz-deploy-test-app-${SUFFIX}`;
    containers.push(name);
    const run = await runCmd("docker", [
      ...baseRunArgs(name).slice(0, 1),
      "-d",
      ...baseRunArgs(name).slice(1),
      "-p",
      "127.0.0.1::3000",
      "-p",
      "127.0.0.1::9464",
      TAG_APP,
    ]);
    expect(run.code, run.stderr).toBe(0);
    const port = async (p: number): Promise<number> => {
      const r = await runCmd("docker", ["port", name, `${p}/tcp`]);
      const m = /:(\d+)\s*$/m.exec(r.stdout);
      expect(m, `docker port ${p}: ${r.stdout} ${r.stderr}`).not.toBeNull();
      return Number(m![1]);
    };
    const httpPort = await port(3000);
    const metricsPort = await port(9464);

    // Старт контейнера и миграции: опрос с крайним сроком (событие — ответ app, не таймер).
    const deadline = Date.now() + 120_000;
    let health: { status: number; body: unknown } | null = null;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${httpPort}/api/health`);
        health = { status: res.status, body: (await res.json()) as unknown };
        if (res.status === 200) break;
      } catch {
        // ещё не слушает
      }
      const state = await runCmd("docker", ["inspect", "--format", "{{.State.Running}}", name]);
      if (state.stdout.trim() !== "true") break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const logs = await runCmd("docker", ["logs", "--tail", "15", name]);
    expect(health?.status, `app не ответил:\n${tail(logs.stdout + logs.stderr)}`).toBe(200);
    expect(health?.body).toEqual({ status: "ok" });

    const metrics = await (await fetch(`http://127.0.0.1:${metricsPort}/metrics`)).text();
    expect(metrics).toContain(`app_info{version="${sha}"} 1`);
  });
});
