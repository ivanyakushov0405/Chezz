// Таблица analytics_events (модуль analytics, ARCHITECTURE §8). Только добавляющая; FK и CHECK по имени нет (ADR-0010).
import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("analytics_events")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("user_id", "uuid")
    .addColumn("game_id", "uuid")
    .addColumn("props", "jsonb", (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn("created_at", "timestamptz", (c) => c.notNull())
    .execute();
  await db.schema.createIndex("analytics_events_name_created_at_idx").on("analytics_events").columns(["name", "created_at"]).execute();
}
