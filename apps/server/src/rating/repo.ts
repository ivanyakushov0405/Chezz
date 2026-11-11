// SQL модуля rating (ARCHITECTURE §7.4, §8): единственное место, где читаются и пишутся ratings и rating_history.
import type { Category } from "@chezz/protocol";
import type { Insertable, Selectable } from "kysely";
import { forTables, type Db, type Trx } from "../platform/db.ts";
import type { RatingHistoryTable, RatingsTable, RatingTables } from "./tables.ts";

export type RatingRow = Selectable<RatingsTable>;

export async function findRatings(db: Db | Trx, userIds: readonly string[], category: Category): Promise<RatingRow[]> {
  if (userIds.length === 0) return [];
  return forTables<RatingTables>(db)
    .selectFrom("ratings")
    .selectAll()
    .where("user_id", "in", userIds)
    .where("category", "=", category)
    .execute();
}

/**
 * Строки игроков партии под `FOR UPDATE` (ARCHITECTURE §9.1 п.7). Нет строки — создаётся из `initial`
 * (`ON CONFLICT DO NOTHING`), затем блокировка по возрастанию `user_id`, как `lockForGame` (§9.1 п.1).
 */
export async function lockRatings(
  trx: Trx,
  userIds: readonly string[],
  category: Category,
  initial: Omit<RatingRow, "user_id" | "category">,
): Promise<RatingRow[]> {
  const t = forTables<RatingTables>(trx);
  const sorted = [...userIds].sort();
  await t
    .insertInto("ratings")
    .values(sorted.map((user_id) => ({ user_id, category, ...initial })))
    .onConflict((oc) => oc.columns(["user_id", "category"]).doNothing())
    .execute();
  return t
    .selectFrom("ratings")
    .selectAll()
    .where("user_id", "in", sorted)
    .where("category", "=", category)
    .orderBy("user_id")
    .forUpdate()
    .execute();
}

export async function updateRating(trx: Trx, row: RatingRow): Promise<void> {
  const { user_id, category, ...values } = row;
  await forTables<RatingTables>(trx)
    .updateTable("ratings")
    .set(values)
    .where("user_id", "=", user_id)
    .where("category", "=", category)
    .execute();
}

export async function hasHistoryForGame(db: Db | Trx, gameId: string): Promise<boolean> {
  const row = await forTables<RatingTables>(db)
    .selectFrom("rating_history")
    .select("game_id")
    .where("game_id", "=", gameId)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

export async function insertHistory(trx: Trx, rows: Insertable<RatingHistoryTable>[]): Promise<void> {
  await forTables<RatingTables>(trx).insertInto("rating_history").values(rows).execute();
}
