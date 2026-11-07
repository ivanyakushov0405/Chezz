// Подготовка базы из DATABASE_URL для e2e и локального запуска (ARCHITECTURE §13.1; design.md E01):
//   node apps/server/scripts/prepare-db.ts [--recreate]
// Без флага — создаёт базу, если её нет, и применяет миграции; --recreate — удаляет и создаёт заново.
// Отказ (код ≠ 0, ничего не меняется): APP_ENV = prod или staging; имя базы не начинается с chezz_.
import pg from "pg";
import { createDb, migrateToLatest } from "../src/platform/db.ts";

function fail(message: string, code: number): never {
  process.stderr.write(`prepare-db: ${message}\n`);
  process.exit(code);
}

const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

async function main(): Promise<void> {
  const appEnv = process.env.APP_ENV;
  if (appEnv === "prod" || appEnv === "staging") fail(`refused: APP_ENV=${appEnv}`, 1);

  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--recreate");
  if (unknown.length > 0) fail("usage: node apps/server/scripts/prepare-db.ts [--recreate]", 2);
  const recreate = args.includes("--recreate");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail("DATABASE_URL is not set", 2);
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    fail("DATABASE_URL is not a valid URL", 2);
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/^chezz_[a-z0-9_]+$/.test(name)) fail("refused: database name must start with chezz_", 1);

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    if (recreate) await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (rowCount === 0) await admin.query(`CREATE DATABASE ${quoteIdent(name)}`);
  } finally {
    await admin.end();
  }

  const db = createDb(databaseUrl, { max: 1 });
  try {
    await migrateToLatest(db);
  } finally {
    await db.destroy();
  }
  process.stdout.write(`prepare-db: ${name} ready\n`);
}

main().catch((err: unknown) => {
  const e = err instanceof Error ? err : new Error(String(err));
  fail(`${e.name}: ${e.message}`, 1);
});
