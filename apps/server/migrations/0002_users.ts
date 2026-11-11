// Таблица users (модуль users, ARCHITECTURE §8; поля — GLOSSARY «Аккаунт», SECURITY §12).
// Ник уникален без учёта регистра (S14) — уникальный индекс по lower(nickname).
import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("users")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // null — после обезличивания (E19, SECURITY §13).
    .addColumn("google_sub", "text", (c) => c.unique())
    .addColumn("email", "text")
    .addColumn("google_name", "text")
    .addColumn("nickname", "text")
    .addColumn("avatar_url", "text")
    .addColumn("country", "text")
    .addColumn("locale", "text", (c) => c.notNull())
    .addColumn("settings", "jsonb", (c) => c.notNull())
    .addColumn("terms_accepted_at", "timestamptz")
    .addColumn("nickname_changed_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (c) => c.notNull())
    .addColumn("deleted_at", "timestamptz")
    .execute();
  await sql`CREATE UNIQUE INDEX users_nickname_lower_key ON users (lower(nickname))`.execute(db);
}
