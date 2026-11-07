// Проверки скелета app и тестовой инфраструктуры (E01 T-2): startApp, «Кто», лог запроса, базы тестов.
import { Writable } from "node:stream";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { startApp, type TestApp } from "../../test/support/app.ts";
import {
  databaseUrlFor,
  ensureWorkerDatabase,
  prepareTemplate,
  withAdmin,
  workerDatabaseName,
  workerDatabaseUrl,
} from "../../test/support/db.ts";
import { ManualTimeSource } from "../../test/support/time.ts";
import { buildApp } from "../app.ts";
import type { Database } from "../database.ts";
import type { AppConfig } from "./config.ts";
import { createDb } from "./db.ts";
import type { Caller } from "./http.ts";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const opened: TestApp[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((a) => a.close()));
});

async function start(...args: Parameters<typeof startApp>): Promise<TestApp> {
  const app = await startApp(...args);
  opened.push(app);
  return app;
}

function captureLog(): { stream: Writable; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk.toString("utf8"));
      cb();
    },
  });
  const lines = () =>
    chunks
      .join("")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  return { stream, lines };
}

describe("startApp", () => {
  it("AC-10 EC-3: два startApp параллельно — разные порты, close() одного не ломает другой", async () => {
    const [a, b] = await Promise.all([start(), start()]);
    expect(a.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(a.wsUrl).toBe(`${a.url.replace("http:", "ws:")}/ws`);
    expect(a.url).not.toBe(b.url);
    expect(a.time).toBeInstanceOf(ManualTimeSource);
    expect(a.time).not.toBe(b.time);

    await a.close();
    opened.splice(opened.indexOf(a), 1);

    const res = await fetch(`${b.url}/api/nothing-here`);
    expect(res.status).toBe(404);
    expect(res.headers.get("x-request-id")).toMatch(UUID_V4);
    await expect(fetch(`${a.url}/api/nothing-here`)).rejects.toThrow();
  });

  it("AC-10: database.block() рвёт соединения app, unblock() — app снова работает с базой без перезапуска", async () => {
    const app = await start();
    const probe = createDb(workerDatabaseUrl(), { max: 1, onPoolError: () => undefined });
    try {
      await app.database.block();
      await expect(probe.connection().execute(async () => undefined)).rejects.toThrow();
      await app.database.unblock();
      await expect(probe.connection().execute(async () => undefined)).resolves.toBeUndefined();
    } finally {
      await probe.destroy();
    }
  });
});

describe("Кто (Caller)", () => {
  it("AC-12 EC-5: запрос с cookie __Host-sid до фичи auth — caller = гость, ошибки нет", async () => {
    const config: AppConfig = {
      appEnv: "dev",
      appOrigin: "http://127.0.0.1:1",
      rateLimitIpPerMin: 300,
      webDistDir: null,
      logLevel: "silent",
    };
    const db = createDb<Database>(workerDatabaseUrl());
    const app = await buildApp(config, { db, time: new ManualTimeSource() });
    // Маршрут только у этого экземпляра теста: показывает request.caller.
    app.get("/probe-caller", (request) => Promise.resolve(request.caller));
    try {
      const res = await app.inject({
        method: "GET",
        url: "/probe-caller",
        headers: { cookie: "__Host-sid=whatever-token-value" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<Caller>()).toEqual({ who: "guest" });
    } finally {
      await app.close();
      await db.destroy();
    }
  });
});

describe("лог запроса", () => {
  it("AC-15 EC-7 EC-8: метод, путь без строки запроса, статус, мс, request_id от сервера; нет query, cookie, Authorization", async () => {
    const log = captureLog();
    const app = await start({ logDestination: log.stream });

    const res = await fetch(`${app.url}/api/health?code=abc&state=xyz`, {
      headers: {
        cookie: "__Host-sid=cookie-secret-value",
        authorization: "Bearer auth-secret-value",
        "x-request-id": "attacker",
      },
    });
    await res.arrayBuffer();
    const requestId = res.headers.get("x-request-id");
    expect(requestId).toMatch(UUID_V4);
    expect(requestId).not.toBe("attacker");

    await expect.poll(() => log.lines().filter((l) => l.msg === "request").length).toBe(1);
    const line = log.lines().find((l) => l.msg === "request");
    expect(line).toMatchObject({
      request_id: requestId,
      req: { method: "GET", path: "/api/health" },
      status: res.status,
      ip: "127.0.0.1",
    });
    expect(typeof line?.ms).toBe("number");
    expect(line).not.toHaveProperty("user_id");

    // request_id (UUID) убираем: в hex может случайно встретиться «abc»; его форма проверена выше.
    const all = log
      .lines()
      .map(({ request_id: _requestId, ...rest }) => JSON.stringify(rest))
      .join("\n");
    for (const forbidden of ["abc", "xyz", "cookie-secret-value", "auth-secret-value", "attacker", "?code"]) {
      expect(all).not.toContain(forbidden);
    }
  });
});

describe("тестовые базы", () => {
  it("AC-9: база воркера — chezz_test_<VITEST_POOL_ID> из шаблона, повторный ensure не падает", async () => {
    expect(workerDatabaseName()).toBe(`chezz_test_${process.env.VITEST_POOL_ID ?? "1"}`);
    await ensureWorkerDatabase();
    await ensureWorkerDatabase();
    const client = new pg.Client({ connectionString: workerDatabaseUrl() });
    await client.connect();
    try {
      const { rows } = await client.query<{ n: string }>("SELECT count(*) AS n FROM kysely_migration");
      expect(Number(rows[0]?.n)).toBe(0);
    } finally {
      await client.end();
    }
  });

  it("AC-9: подготовка шаблона дважды подряд не падает и пересоздаёт базы воркеров", async () => {
    const names = { template: "chezz_selftest_template", workerPrefix: "chezz_selftest_w_" };
    const worker = `${names.workerPrefix}1`;
    const exists = (name: string) =>
      withAdmin(async (admin) => (await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount === 1);
    try {
      await prepareTemplate(names);
      await ensureWorkerDatabase(worker, names.template);
      // Отметка в базе воркера: после повторной подготовки её быть не должно.
      const client = new pg.Client({ connectionString: databaseUrlFor(worker) });
      await client.connect();
      await client.query("CREATE TABLE marker (id int)");
      await client.end();

      await prepareTemplate(names);
      expect(await exists(worker)).toBe(false);
      expect(await exists(names.template)).toBe(true);
      await ensureWorkerDatabase(worker, names.template);
      const again = new pg.Client({ connectionString: databaseUrlFor(worker) });
      await again.connect();
      const { rowCount } = await again.query("SELECT 1 FROM pg_tables WHERE tablename = 'marker'");
      await again.end();
      expect(rowCount).toBe(0);
    } finally {
      await withAdmin(async (admin) => {
        await admin.query(`DROP DATABASE IF EXISTS "${worker}" WITH (FORCE)`);
        await admin.query(`ALTER DATABASE "${names.template}" WITH IS_TEMPLATE false`).catch(() => undefined);
        await admin.query(`DROP DATABASE IF EXISTS "${names.template}" WITH (FORCE)`);
      });
    }
  });
});
