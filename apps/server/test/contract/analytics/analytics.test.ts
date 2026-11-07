// Contract: модуль analytics снаружи `app` (design.md E03, «analytics», «Тестовая инфраструктура»; ARCHITECTURE §7.5; SECURITY §15).
// AC-23…AC-29, EC-19…EC-25. AC-30, AC-31 — проверки check-скриптов и routes.int.test.ts, не здесь.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { workerDatabaseUrl } from "../../support/db.ts";
import { listAnalyticsEvents } from "../../support/analytics.ts";
import {
  captureLog,
  startAnalyticsApp,
  type AnalyticsEventInput,
  type AnalyticsRow,
  type AnalyticsTestApp,
  type LogCapture,
  type SentryAppOptions,
} from "../_helpers/observability.ts";

const apps: AnalyticsTestApp[] = [];
const clients: pg.Client[] = [];
let renamed = false;

async function start(options: SentryAppOptions = {}): Promise<AnalyticsTestApp> {
  const app = await startAnalyticsApp(options);
  apps.push(app);
  return app;
}

async function sql(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: workerDatabaseUrl() });
  await client.connect();
  clients.push(client);
  return client;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  if (renamed) {
    const c = await sql();
    await c.query("ALTER TABLE IF EXISTS analytics_events_broken RENAME TO analytics_events");
    renamed = false;
  }
  await Promise.all(clients.splice(0).map((c) => c.end().catch(() => undefined)));
});

async function breakTable(): Promise<void> {
  const c = await sql();
  await c.query("ALTER TABLE analytics_events RENAME TO analytics_events_broken");
  renamed = true;
}

async function allRows(): Promise<AnalyticsRow[]> {
  return (await listAnalyticsEvents()) as unknown as AnalyticsRow[];
}

async function rowsOf(userId: string): Promise<AnalyticsRow[]> {
  return (await allRows()).filter((r) => r.user_id === userId);
}

async function recordAndDrain(app: AnalyticsTestApp, event: AnalyticsEventInput): Promise<void> {
  app.analytics.record(event);
  await app.analytics.drain();
}

function logOf(log: LogCapture, msg: string): Array<Record<string, unknown>> {
  return log.lines().filter((l) => l["msg"] === msg);
}

describe("схема analytics_events", () => {
  it("AC-23: колонки id, name, user_id (NULL), game_id (NULL), props (jsonb NOT NULL, default {}), created_at", async () => {
    await start();
    const c = await sql();
    const { rows } = await c.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'analytics_events'",
    );
    const col = Object.fromEntries(rows.map((r) => [r.column_name, r]));

    expect(Object.keys(col).sort()).toStrictEqual(["created_at", "game_id", "id", "name", "props", "user_id"]);
    expect(col["id"]?.data_type).toBe("uuid");
    expect(col["name"]?.is_nullable).toBe("NO");
    expect(col["user_id"]?.is_nullable).toBe("YES");
    expect(col["game_id"]?.is_nullable).toBe("YES");
    expect(col["props"]?.data_type).toBe("jsonb");
    expect(col["props"]?.is_nullable).toBe("NO");
    expect(col["props"]?.column_default).toContain("{}");
    expect(col["created_at"]?.data_type).toBe("timestamp with time zone");
    expect(col["created_at"]?.is_nullable).toBe("NO");
  });
});

describe("запись события", () => {
  it("AC-24: game_finished с props → одна строка с теми же значениями, created_at = wallNow", async () => {
    const app = await start({ time: { wall: new Date("2026-03-05T10:20:30.123Z") } });
    const userId = randomUUID();
    const gameId = randomUUID();

    await recordAndDrain(app, {
      name: "game_finished",
      user_id: userId,
      game_id: gameId,
      props: { termination: "checkmate", after_restart: false },
    });

    const rows = await rowsOf(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "game_finished",
      user_id: userId,
      game_id: gameId,
      props: { termination: "checkmate", after_restart: false },
    });
    expect(new Date(rows[0]!.created_at).toISOString()).toBe(app.time.wallNow().toISOString());
  });

  it("AC-24: seek_started без props → props = {}", async () => {
    const app = await start();
    const userId = randomUUID();

    await recordAndDrain(app, { name: "seek_started", user_id: userId });

    const rows = await rowsOf(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.props).toStrictEqual({});
    expect(rows[0]?.game_id).toBeNull();
  });

  it("AC-24: seek_matched с wait_ms → props {wait_ms}", async () => {
    const app = await start();
    const userId = randomUUID();

    await recordAndDrain(app, { name: "seek_matched", user_id: userId, props: { wait_ms: 1500 } });

    expect((await rowsOf(userId))[0]?.props).toStrictEqual({ wait_ms: 1500 });
  });

  it("EC-23: Гость — analysis_opened с user_id null → строка с user_id NULL, событий Sentry нет", async () => {
    const app = await start({ sentry: true });
    const gameId = randomUUID();

    await recordAndDrain(app, { name: "analysis_opened", user_id: null, game_id: gameId });

    const rows = (await allRows()).filter((r) => r.game_id === gameId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBeNull();
    expect(rows[0]?.name).toBe("analysis_opened");
    expect(await app.sentryEvents()).toStrictEqual([]);
  });
});

describe("проверка props и имени", () => {
  it.each(["email", "nickname", "ip", "user_agent", "anything_else"])(
    "AC-25/EC-21: props с ключом %s → строки нет, исключения нет, warn без значения",
    async (key) => {
      const log = captureLog();
      const app = await start({ logDestination: log.stream });
      const userId = randomUUID();
      const secret = `secret-value-${randomUUID()}`;
      const event = {
        name: "game_finished",
        user_id: userId,
        game_id: randomUUID(),
        props: { termination: "checkmate", after_restart: false, [key]: secret },
      };

      expect(() => app.analytics.record(event as unknown as AnalyticsEventInput)).not.toThrow();
      await expect(app.analytics.drain()).resolves.toBeUndefined();

      expect(await rowsOf(userId)).toStrictEqual([]);
      const warns = logOf(log, "analytics event rejected");
      expect(warns).toHaveLength(1);
      expect(warns[0]?.["level"]).toBe(40);
      expect(warns[0]?.["name"]).toBe("game_finished");
      expect(JSON.stringify(warns[0]?.["keys"])).toContain(key);
      expect(log.raw()).not.toContain(secret);
    },
  );

  it("EC-22: имя события вне набора (as any) → строки нет, warn, исключения нет", async () => {
    const log = captureLog();
    const app = await start({ logDestination: log.stream });
    const userId = randomUUID();

    expect(() => app.analytics.record({ name: "page_viewed", user_id: userId } as unknown as AnalyticsEventInput)).not.toThrow();
    await app.analytics.drain();

    expect(await rowsOf(userId)).toStrictEqual([]);
    const warns = logOf(log, "analytics event rejected");
    expect(warns).toHaveLength(1);
    expect(warns[0]?.["name"]).toBe("page_viewed");
  });

  it.each([-1, 1.5, "10"])("AC-25: wait_ms = %j → строки нет, warn", async (waitMs) => {
    const log = captureLog();
    const app = await start({ logDestination: log.stream });
    const userId = randomUUID();

    app.analytics.record({ name: "seek_matched", user_id: userId, props: { wait_ms: waitMs } } as unknown as AnalyticsEventInput);
    await app.analytics.drain();

    expect(await rowsOf(userId)).toStrictEqual([]);
    expect(logOf(log, "analytics event rejected")).toHaveLength(1);
  });

  it.each(["Checkmate", "", "a".repeat(33), "mate-1"])("AC-25: termination = %j → строки нет, warn", async (termination) => {
    const log = captureLog();
    const app = await start({ logDestination: log.stream });
    const userId = randomUUID();

    app.analytics.record({
      name: "game_finished",
      user_id: userId,
      game_id: randomUUID(),
      props: { termination, after_restart: false },
    });
    await app.analytics.drain();

    expect(await rowsOf(userId)).toStrictEqual([]);
    expect(logOf(log, "analytics event rejected")).toHaveLength(1);
  });

  it("AC-25: user_id не uuid → строки нет, warn, исключения нет", async () => {
    const log = captureLog();
    const app = await start({ logDestination: log.stream });

    expect(() => app.analytics.record({ name: "seek_started", user_id: "not-a-uuid" })).not.toThrow();
    await app.analytics.drain();

    expect(logOf(log, "analytics event rejected")).toHaveLength(1);
    expect((await allRows()).filter((r) => r.user_id === "not-a-uuid")).toStrictEqual([]);
  });
});

describe("сбой записи не ломает вызывающего", () => {
  it("AC-26: таблица переименована → record не бросает, drain не реджектится, error в логе", async () => {
    const log = captureLog();
    const app = await start({ logDestination: log.stream });
    await breakTable();

    expect(() => app.analytics.record({ name: "seek_started", user_id: randomUUID() })).not.toThrow();
    await expect(app.analytics.drain()).resolves.toBeUndefined();

    const errors = logOf(log, "analytics event write failed");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.["level"]).toBe(50);
    expect(errors[0]?.["err"]).toBeDefined();
  });

  it("AC-26: база недоступна (database.block) → record не бросает, drain не реджектится, error в логе", async () => {
    const log = captureLog();
    const app = await start({ logDestination: log.stream });
    await app.database.block();

    try {
      expect(() => app.analytics.record({ name: "seek_started", user_id: randomUUID() })).not.toThrow();
      await expect(app.analytics.drain()).resolves.toBeUndefined();
    } finally {
      await app.database.unblock();
    }

    expect(logOf(log, "analytics event write failed")).toHaveLength(1);
  });

  it("AC-27/EC-20: record внутри транзакции вызывающего при падающей вставке → транзакция коммитится, данные сохранены", async () => {
    const log = captureLog();
    const app = await start({ logDestination: log.stream });
    const table = `tx_probe_${randomUUID().replaceAll("-", "")}`;
    const c = await sql();
    await c.query(`CREATE TABLE ${table} (v int)`);
    await breakTable();

    try {
      await c.query("BEGIN");
      await c.query(`INSERT INTO ${table} (v) VALUES (42)`);
      app.analytics.record({ name: "seek_started", user_id: randomUUID() });
      await app.analytics.drain();
      await c.query(`INSERT INTO ${table} (v) VALUES (43)`);
      await c.query("COMMIT");

      const { rows } = await c.query<{ v: number }>(`SELECT v FROM ${table} ORDER BY v`);
      expect(rows.map((r) => r.v)).toStrictEqual([42, 43]);
      expect(logOf(log, "analytics event write failed")).toHaveLength(1);
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      await c.query(`DROP TABLE IF EXISTS ${table}`);
    }
  });
});

describe("user_active: сутки UTC", () => {
  const userActive = (userId: string): AnalyticsEventInput => ({ name: "user_active", user_id: userId });

  it("AC-28: три события за сутки → одна строка; после 00:00 UTC → вторая; другой user_id — своя", async () => {
    const app = await start({ time: { wall: new Date("2026-04-10T12:00:00.000Z") } });
    const a = randomUUID();
    const b = randomUUID();

    await recordAndDrain(app, userActive(a));
    await recordAndDrain(app, userActive(a));
    await recordAndDrain(app, userActive(a));
    expect(await rowsOf(a)).toHaveLength(1);

    await recordAndDrain(app, userActive(b));
    expect(await rowsOf(b)).toHaveLength(1);
    expect(await rowsOf(a)).toHaveLength(1);

    await app.time.advance(12 * 60 * 60 * 1000);
    await recordAndDrain(app, userActive(a));
    await recordAndDrain(app, userActive(a));

    const rows = await rowsOf(a);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.name === "user_active")).toBe(true);
  });

  it("EC-25: 23:59:59.999 и 00:00:00.000 UTC → две строки", async () => {
    const app = await start({ time: { wall: new Date("2026-04-10T23:59:59.999Z") } });
    const userId = randomUUID();

    await recordAndDrain(app, userActive(userId));
    await app.time.advance(1);
    await recordAndDrain(app, userActive(userId));

    const rows = await rowsOf(userId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => new Date(r.created_at).toISOString())).toStrictEqual(["2026-04-10T23:59:59.999Z", "2026-04-11T00:00:00.000Z"]);
  });

  it("EC-25: 00:00:00.000 и 23:59:59.999 одних суток UTC → одна строка", async () => {
    const app = await start({ time: { wall: new Date("2026-04-10T00:00:00.000Z") } });
    const userId = randomUUID();

    await recordAndDrain(app, userActive(userId));
    await app.time.advance(24 * 60 * 60 * 1000 - 1);
    await recordAndDrain(app, userActive(userId));

    expect(await rowsOf(userId)).toHaveLength(1);
  });

  it("AC-29/EC-16: два app — дедупликация у каждого своя, user_active пишется дважды", async () => {
    const first = await start();
    const second = await start();
    const userId = randomUUID();

    await recordAndDrain(first, userActive(userId));
    await recordAndDrain(second, userActive(userId));
    await recordAndDrain(first, userActive(userId));
    await recordAndDrain(second, userActive(userId));

    expect(await rowsOf(userId)).toHaveLength(2);
  });

  it("EC-19: перезапуск сервера → второй user_active за сутки допустим, прежние строки на месте", async () => {
    const userId = randomUUID();
    const gameId = randomUUID();
    const before = await start();
    await recordAndDrain(before, userActive(userId));
    await recordAndDrain(before, { name: "game_started", user_id: userId, game_id: gameId });
    await before.close();
    apps.splice(apps.indexOf(before), 1);

    const after = await start();
    await recordAndDrain(after, userActive(userId));

    const rows = await rowsOf(userId);
    expect(rows.filter((r) => r.name === "user_active")).toHaveLength(2);
    expect(rows.filter((r) => r.name === "game_started")).toHaveLength(1);
  });
});
