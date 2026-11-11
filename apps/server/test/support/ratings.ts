// Чтение ratings / rating_history для тестов (SQL вне apps/server/src — ARCHITECTURE §7.4, TESTING §7.6).
import type { Database } from "../../src/database.ts";
import type { Db } from "../../src/platform/db.ts";

export async function listRatingHistory(db: Db<Database>, gameId: string) {
  return db.selectFrom("rating_history").selectAll().where("game_id", "=", gameId).orderBy("user_id").execute();
}

export async function countRatingRows(db: Db<Database>, userId: string): Promise<number> {
  const rows = await db.selectFrom("ratings").select("user_id").where("user_id", "=", userId).execute();
  return rows.length;
}
