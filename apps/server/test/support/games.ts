// Чтение и правка games / users для int-тестов партии (SQL вне apps/server/src — ARCHITECTURE §7.4, TESTING §7.6).
import type { Selectable } from "kysely";
import type { Database } from "../../src/database.ts";
import type { GamesTable } from "../../src/games/tables.ts";
import type { Db } from "../../src/platform/db.ts";

export async function readGame(db: Db<Database>, id: string): Promise<Selectable<GamesTable> | undefined> {
  return db.selectFrom("games").selectAll().where("id", "=", id).executeTakeFirst();
}

export async function listGamesOf(db: Db<Database>, userId: string): Promise<Selectable<GamesTable>[]> {
  return db
    .selectFrom("games")
    .selectAll()
    .where((eb) => eb.or([eb("white_id", "=", userId), eb("black_id", "=", userId)]))
    .execute();
}

/** Признак удалённого аккаунта (SECURITY S16) без сценария удаления (E19). */
export async function markUserDeleted(db: Db<Database>, userId: string): Promise<void> {
  await db.updateTable("users").set({ deleted_at: new Date(), nickname: null }).where("id", "=", userId).execute();
}
