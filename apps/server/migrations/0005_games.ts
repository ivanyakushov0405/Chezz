// Таблица games (модуль games, ARCHITECTURE §8, §9; поля и значения — GLOSSARY §8).
// moves — массив Move ({san, clock_ms}); pgn — только у законченной, без ников (SECURITY S13).
// Внешний ключ rating_history.game_id → games.id, отложенный в 0004 (E05).
import { sql, type Kysely } from "kysely";

const TERMINATIONS = [
  "checkmate",
  "resignation",
  "stalemate",
  "threefold_repetition",
  "fifty_moves",
  "insufficient_material",
  "timeout",
  "timeout_insufficient_material",
  "draw_agreement",
  "abandonment",
  "no_first_move",
  "aborted_by_player",
];

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("games")
    // UUID v4 (SECURITY S9): gen_random_uuid() — случайный v4.
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("white_id", "uuid", (c) => c.notNull().references("users.id"))
    .addColumn("black_id", "uuid", (c) => c.notNull().references("users.id"))
    .addColumn("category", "text", (c) => c.notNull().check(sql`category IN ('bullet', 'blitz', 'rapid')`))
    .addColumn("time_base", "integer", (c) => c.notNull().check(sql`time_base >= 0`))
    .addColumn("time_increment", "integer", (c) => c.notNull().check(sql`time_increment >= 0`))
    .addColumn("rated", "boolean", (c) => c.notNull())
    .addColumn("status", "text", (c) => c.notNull().check(sql`status IN ('active', 'finished', 'aborted')`))
    .addColumn("result", "text", (c) => c.check(sql`result IN ('white_wins', 'black_wins', 'draw')`))
    .addColumn("termination", "text", (c) => c.check(sql`termination IN (${sql.join(TERMINATIONS.map((t) => sql.lit(t)))})`))
    .addColumn("pgn", "text")
    .addColumn("moves", "jsonb", (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn("started_at", "timestamptz", (c) => c.notNull())
    .addColumn("ended_at", "timestamptz")
    .addCheckConstraint("games_players_differ", sql`white_id <> black_id`)
    // active — без итога; finished — с результатом; aborted — без результата (GLOSSARY §8).
    .addCheckConstraint(
      "games_status_result",
      sql`(status = 'active' AND result IS NULL AND termination IS NULL AND ended_at IS NULL)
        OR (status = 'finished' AND result IS NOT NULL AND termination IS NOT NULL AND ended_at IS NOT NULL)
        OR (status = 'aborted' AND result IS NULL AND termination IS NOT NULL AND ended_at IS NOT NULL)`,
    )
    .execute();

  // «1 активная партия» проверяет createGame под блокировкой users (A25); индексы — для этой проверки и /api/me.
  await db.schema.createIndex("games_white_active_idx").on("games").column("white_id").where(sql.ref("status"), "=", "active").execute();
  await db.schema.createIndex("games_black_active_idx").on("games").column("black_id").where(sql.ref("status"), "=", "active").execute();
  // История партий игрока (E12) и последние пары подбора (E10).
  await db.schema.createIndex("games_white_started_idx").on("games").columns(["white_id", "started_at"]).execute();
  await db.schema.createIndex("games_black_started_idx").on("games").columns(["black_id", "started_at"]).execute();

  await db.schema
    .alterTable("rating_history")
    .addForeignKeyConstraint("rating_history_game_id_fkey", ["game_id"], "games", ["id"])
    .execute();
}
