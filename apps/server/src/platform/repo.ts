// SQL модуля platform (ARCHITECTURE §7.4: SQL — только в repo.ts). Своих таблиц у platform нет.
import { sql } from "kysely";
import type { Db } from "./db.ts";

/** Проверка связи с PostgreSQL для GET /api/health: SELECT 1. */
export async function pingDatabase(db: Db): Promise<void> {
  await sql`SELECT 1`.execute(db);
}
