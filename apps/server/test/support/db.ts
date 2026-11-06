// Тестовые базы (TESTING §7.1): chezz_template с миграциями — один раз за прогон (globalSetup),
// база воркера chezz_test_<VITEST_POOL_ID> — копия шаблона. Тестовые утилиты читают только TEST_DATABASE_URL.
import pg from "pg";
import { createDb, migrateToLatest } from "../../src/platform/db.ts";

export const DEFAULT_TEST_DATABASE_URL = "postgres://chezz:chezz@127.0.0.1:54329/postgres";
export const TEMPLATE_DB = "chezz_template";
const WORKER_DB_PREFIX = "chezz_test_";
// Ключ pg_advisory_lock: сериализует создание баз из шаблона между воркерами и проектами Vitest.
const LOCK_KEY = 0x63_68_65_7a; // "chez"

export function adminDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}

export function databaseUrlFor(name: string): string {
  const url = new URL(adminDatabaseUrl());
  url.pathname = `/${name}`;
  return url.toString();
}

export function workerDatabaseName(): string {
  const id = process.env.VITEST_POOL_ID ?? "1";
  if (!/^\d+$/.test(id)) throw new Error("VITEST_POOL_ID must be a number");
  return `${WORKER_DB_PREFIX}${id}`;
}

export function workerDatabaseUrl(): string {
  return databaseUrlFor(workerDatabaseName());
}

const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** Подключение к служебной базе (postgres) на время fn. */
export async function withAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminDatabaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function withLock<T>(client: pg.Client, fn: () => Promise<T>): Promise<T> {
  await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
  try {
    return await fn();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
  }
}

/** Шаблон заново (миграции могли измениться) и удаление баз воркеров прошлого прогона. */
export async function prepareTemplate(
  names: { template: string; workerPrefix: string } = { template: TEMPLATE_DB, workerPrefix: WORKER_DB_PREFIX },
): Promise<void> {
  const template = names.template;
  const workerLike = `${names.workerPrefix.replace(/[\\_%]/g, (c) => `\\${c}`)}%`;
  await withAdmin((admin) =>
    withLock(admin, async () => {
      const { rows } = await admin.query<{ datname: string }>(
        "SELECT datname FROM pg_database WHERE datname LIKE $1 OR datname = $2",
        [workerLike, template],
      );
      for (const { datname } of rows) {
        if (datname === template) {
          await admin.query(`ALTER DATABASE ${quoteIdent(datname)} WITH IS_TEMPLATE false`);
        }
        await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(datname)} WITH (FORCE)`);
      }
      await admin.query(`CREATE DATABASE ${quoteIdent(template)}`);
      const db = createDb(databaseUrlFor(template), { max: 1 });
      try {
        await migrateToLatest(db);
      } finally {
        await db.destroy();
      }
      await admin.query(`ALTER DATABASE ${quoteIdent(template)} WITH IS_TEMPLATE true`);
    }),
  );
}

/** База воркера из шаблона, если её ещё нет в этом прогоне. */
export async function ensureWorkerDatabase(name: string = workerDatabaseName(), template: string = TEMPLATE_DB): Promise<void> {
  await withAdmin((admin) =>
    withLock(admin, async () => {
      const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
      if (rowCount === 0) {
        await admin.query(`CREATE DATABASE ${quoteIdent(name)} TEMPLATE ${quoteIdent(template)}`);
      } else {
        // Прошлый файл мог оставить базу заблокированной (database.block() без unblock()).
        await admin.query(`ALTER DATABASE ${quoteIdent(name)} WITH ALLOW_CONNECTIONS true`);
      }
    }),
  );
}

/** Доступность базы для app (TestApp.database): запрет новых соединений и разрыв текущих. */
export async function setDatabaseAllowConnections(name: string, allow: boolean): Promise<void> {
  await withAdmin(async (admin) => {
    await admin.query(`ALTER DATABASE ${quoteIdent(name)} WITH ALLOW_CONNECTIONS ${allow ? "true" : "false"}`);
    if (!allow) {
      await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [name]);
    }
  });
}

/** TRUNCATE всех таблиц базы воркера, кроме таблиц миграций (TESTING §7.1). */
export async function truncateWorkerDatabase(): Promise<void> {
  const client = new pg.Client({ connectionString: workerDatabaseUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ name: string }>(
      `SELECT quote_ident(schemaname) || '.' || quote_ident(tablename) AS name
         FROM pg_tables
        WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
          AND tablename NOT IN ('kysely_migration', 'kysely_migration_lock')`,
    );
    if (rows.length > 0) {
      await client.query(`TRUNCATE ${rows.map((r) => r.name).join(", ")} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await client.end();
  }
}

// Vitest вызывает globalSetup каждого проекта (int, contract) в одном главном процессе:
// шаблон готовится один раз за прогон.
const SETUP_KEY = Symbol.for("chezz.test.templateReady");
type GlobalWithSetup = typeof globalThis & { [SETUP_KEY]?: Promise<void> };

export default async function globalSetup(): Promise<void> {
  const g = globalThis as GlobalWithSetup;
  g[SETUP_KEY] ??= prepareTemplate();
  await g[SETUP_KEY];
}
