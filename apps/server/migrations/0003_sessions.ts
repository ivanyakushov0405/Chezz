// Таблица sessions (модуль auth, ARCHITECTURE §8; SECURITY §5). В БД — только SHA-256 токена (S3).
import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("sessions")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("token_hash", "text", (c) => c.notNull().unique())
    .addColumn("user_id", "uuid", (c) => c.notNull().references("users.id").onDelete("cascade"))
    .addColumn("created_at", "timestamptz", (c) => c.notNull())
    .addColumn("expires_at", "timestamptz", (c) => c.notNull())
    .execute();
  await db.schema.createIndex("sessions_user_id_idx").on("sessions").column("user_id").execute();
  await db.schema.createIndex("sessions_expires_at_idx").on("sessions").column("expires_at").execute();
}
