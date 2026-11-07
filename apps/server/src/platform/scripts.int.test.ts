// Скрипты сервера: сид (TESTING §7.6) и prepare-db (design.md E01).
import { spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { databaseUrlFor, withAdmin, workerDatabaseUrl } from "../../test/support/db.ts";

const SCRIPTS = path.resolve(import.meta.dirname, "../../scripts");

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runScript(file: string, args: string[], env: Record<string, string | undefined>): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(SCRIPTS, file), ...args], {
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function databaseExists(name: string): Promise<boolean> {
  return withAdmin(async (admin) => (await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount === 1);
}

describe("seed.ts", () => {
  it("AC-13: --demo на пустой схеме — код 0", async () => {
    const run = await runScript("seed.ts", ["--demo"], { DATABASE_URL: workerDatabaseUrl() });
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
  });

  it("AC-13 EC-15: APP_ENV=prod — код ≠ 0 до подключения к БД, ничего не записано", async () => {
    // Порт 1 недоступен: если бы сид подключался, ошибка была бы другой (ECONNREFUSED).
    const run = await runScript("seed.ts", ["--demo"], {
      APP_ENV: "prod",
      DATABASE_URL: "postgres://chezz:chezz@127.0.0.1:1/chezz_never",
    });
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("APP_ENV=prod");
    expect(run.stderr).not.toContain("ECONNREFUSED");

    const real = await runScript("seed.ts", ["--demo"], { APP_ENV: "prod", DATABASE_URL: workerDatabaseUrl() });
    expect(real.code).not.toBe(0);
  });

  it("без режима и с --load (E21) — код ≠ 0", async () => {
    expect((await runScript("seed.ts", [], { DATABASE_URL: workerDatabaseUrl() })).code).not.toBe(0);
    expect((await runScript("seed.ts", ["--load", "1"], { DATABASE_URL: workerDatabaseUrl() })).code).not.toBe(0);
  });
});

describe("prepare-db.ts", () => {
  const name = `chezz_prepare_selftest_${process.env.VITEST_POOL_ID ?? "1"}`;

  it("создаёт базу и применяет миграции; --recreate пересоздаёт; повтор без флага не падает", async () => {
    try {
      const first = await runScript("prepare-db.ts", [], { DATABASE_URL: databaseUrlFor(name) });
      expect(first.stderr).toBe("");
      expect(first.code).toBe(0);
      expect(await databaseExists(name)).toBe(true);
      expect((await runScript("prepare-db.ts", [], { DATABASE_URL: databaseUrlFor(name) })).code).toBe(0);
      expect((await runScript("prepare-db.ts", ["--recreate"], { DATABASE_URL: databaseUrlFor(name) })).code).toBe(0);
      expect(await databaseExists(name)).toBe(true);
    } finally {
      await withAdmin((admin) => admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
    }
  });

  it("отказ при APP_ENV=prod/staging и при имени базы не с chezz_ — ничего не создано", async () => {
    for (const appEnv of ["prod", "staging"]) {
      const run = await runScript("prepare-db.ts", ["--recreate"], { APP_ENV: appEnv, DATABASE_URL: databaseUrlFor(name) });
      expect(run.code).not.toBe(0);
    }
    expect(await databaseExists(name)).toBe(false);

    const foreign = await runScript("prepare-db.ts", ["--recreate"], { DATABASE_URL: databaseUrlFor("postgres") });
    expect(foreign.code).not.toBe(0);
    expect(foreign.stderr).toContain("chezz_");
    expect(await databaseExists("postgres")).toBe(true);
  });
});
