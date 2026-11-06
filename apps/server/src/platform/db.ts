// Пул PostgreSQL, Kysely, транзакции и миграции (ADR-0005 п.5; ARCHITECTURE §5, §8).
// platform не импортирует модули: общий Database собирает apps/server/src/database.ts,
// а repo модуля сужает Db до своих таблиц через forTables<XTables>(db).
import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Kysely, PostgresDialect, type Transaction } from "kysely";
import { Migrator, type Migration, type MigrationProvider } from "kysely/migration";
import pg from "pg";

// Тип таблиц по умолчанию открыт: конкретику задают app.ts (Database) и repo (XTables).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTables = any;

export type Db<Tables = AnyTables> = Kysely<Tables>;
export type Trx<Tables = AnyTables> = Transaction<Tables>;

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations");

export interface CreateDbOptions {
  /** Ошибка простаивающего соединения (обрыв, перезапуск БД). Без обработчика pg роняет процесс. */
  onPoolError?: (err: Error) => void;
  max?: number;
}

export function createDb<Tables = AnyTables>(databaseUrl: string, options: CreateDbOptions = {}): Db<Tables> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: options.max ?? 10 });
  pool.on("error", (err) => {
    options.onPoolError?.(err);
  });
  return new Kysely<Tables>({ dialect: new PostgresDialect({ pool }) });
}

/** Сужение Db до таблиц своего модуля: чужая таблица в запросе repo — ошибка компиляции. */
export function forTables<Tables>(db: Db | Trx): Db<Tables> {
  return db as Db<Tables>;
}

export function withTransaction<T, Tables = AnyTables>(db: Db<Tables>, fn: (trx: Trx<Tables>) => Promise<T>): Promise<T> {
  return db.transaction().execute(fn);
}

/** Миграции из apps/server/migrations (*.ts). Свой провайдер: import() по file:// работает и в Windows. */
class DirMigrationProvider implements MigrationProvider {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async getMigrations(): Promise<Record<string, Migration>> {
    const files = (await readdir(this.dir)).filter((f) => /\.(ts|js|mjs)$/.test(f) && !f.endsWith(".d.ts")).sort();
    const migrations: Record<string, Migration> = {};
    for (const file of files) {
      const mod = (await import(pathToFileURL(path.join(this.dir, file)).href)) as Migration;
      migrations[file.replace(/\.(ts|js|mjs)$/, "")] = { up: mod.up, ...(mod.down ? { down: mod.down } : {}) };
    }
    return migrations;
  }
}

export async function migrateToLatest(db: Db): Promise<void> {
  const migrator = new Migrator({ db, provider: new DirMigrationProvider(MIGRATIONS_DIR) });
  const { error, results } = await migrator.migrateToLatest();
  const failed = results?.find((r) => r.status === "Error");
  if (error !== undefined || failed !== undefined) {
    const name = failed?.migrationName ?? "unknown";
    throw new Error(`migration failed: ${name}`, { cause: error });
  }
}
