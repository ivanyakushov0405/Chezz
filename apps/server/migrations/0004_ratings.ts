// Таблицы ratings и rating_history (модуль rating, ARCHITECTURE §8, §11; поля — GLOSSARY «Рейтинг», «История рейтинга»).
// Значения хранятся без округления: округление — только при выдаче (ТЗ §4.7).
// rating_history.game_id — пока без внешнего ключа: таблицы games ещё нет, ключ добавит её миграция (E06).
import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("ratings")
    .addColumn("user_id", "uuid", (c) => c.notNull().references("users.id"))
    .addColumn("category", "text", (c) => c.notNull().check(sql`category IN ('bullet', 'blitz', 'rapid')`))
    .addColumn("rating", "double precision", (c) => c.notNull())
    .addColumn("rd", "double precision", (c) => c.notNull())
    .addColumn("volatility", "double precision", (c) => c.notNull())
    .addColumn("games_count", "integer", (c) => c.notNull().defaultTo(0))
    // Время последней рейтинговой партии в категории — от него считается рост RD (ARCHITECTURE §11).
    .addColumn("updated_at", "timestamptz", (c) => c.notNull())
    .addPrimaryKeyConstraint("ratings_pkey", ["user_id", "category"])
    .execute();

  await db.schema
    .createTable("rating_history")
    .addColumn("user_id", "uuid", (c) => c.notNull().references("users.id"))
    .addColumn("category", "text", (c) => c.notNull().check(sql`category IN ('bullet', 'blitz', 'rapid')`))
    .addColumn("game_id", "uuid", (c) => c.notNull())
    .addColumn("rating_before", "double precision", (c) => c.notNull())
    .addColumn("rating_after", "double precision", (c) => c.notNull())
    .addColumn("created_at", "timestamptz", (c) => c.notNull())
    // Одна строка на игрока и партию: повторный пересчёт партии невозможен (бриф E05, E-1).
    .addPrimaryKeyConstraint("rating_history_pkey", ["game_id", "user_id"])
    .execute();
  // График рейтинга (E11) и изменение за 7 дней (E14): по игроку и категории во времени.
  await db.schema
    .createIndex("rating_history_user_category_created_idx")
    .on("rating_history")
    .columns(["user_id", "category", "created_at"])
    .execute();
}
