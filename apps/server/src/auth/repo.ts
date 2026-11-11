// SQL модуля auth (ARCHITECTURE §7.4): единственное место, где читается и пишется sessions.
import type { Selectable } from "kysely";
import { forTables, type Db, type Trx } from "../platform/db.ts";
import type { AuthTables, SessionsTable } from "./tables.ts";

export type SessionRow = Selectable<SessionsTable>;

export async function insertSession(
  db: Db | Trx,
  row: { token_hash: string; user_id: string; created_at: Date; expires_at: Date },
): Promise<SessionRow> {
  return forTables<AuthTables>(db).insertInto("sessions").values(row).returningAll().executeTakeFirstOrThrow();
}

/** Действующая Session по хэшу токена: `expires_at > now` (SECURITY §5, ARCHITECTURE A20). */
export async function findValidSession(db: Db | Trx, tokenHash: string, now: Date): Promise<SessionRow | null> {
  return (
    (await forTables<AuthTables>(db)
      .selectFrom("sessions")
      .selectAll()
      .where("token_hash", "=", tokenHash)
      .where("expires_at", ">", now)
      .executeTakeFirst()) ?? null
  );
}

/** Действующие Session из списка (перепроверка realtime, S6): id → expires_at; одним запросом. */
export async function findValidSessionsByIds(db: Db | Trx, ids: readonly string[], now: Date): Promise<Map<string, Date>> {
  if (ids.length === 0) return new Map();
  const rows = await forTables<AuthTables>(db)
    .selectFrom("sessions")
    .select(["id", "expires_at"])
    .where("id", "=", (eb) => eb.fn.any(eb.val([...ids])))
    .where("expires_at", ">", now)
    .execute();
  return new Map(rows.map((r) => [r.id, r.expires_at]));
}

/** «Выйти»: удаляет одну Session; возвращает удалённые id (пусто — её уже нет). */
export async function deleteSession(db: Db | Trx, id: string): Promise<string[]> {
  const rows = await forTables<AuthTables>(db).deleteFrom("sessions").where("id", "=", id).returning("id").execute();
  return rows.map((r) => r.id);
}

/** «Выйти со всех устройств»: все Session User. */
export async function deleteUserSessions(db: Db | Trx, userId: string): Promise<string[]> {
  const rows = await forTables<AuthTables>(db).deleteFrom("sessions").where("user_id", "=", userId).returning("id").execute();
  return rows.map((r) => r.id);
}

/** Чистка истёкших (SECURITY §5): при старте и раз в сутки. */
export async function deleteExpiredSessions(db: Db | Trx, now: Date): Promise<number> {
  const res = await forTables<AuthTables>(db).deleteFrom("sessions").where("expires_at", "<=", now).executeTakeFirst();
  return Number(res.numDeletedRows);
}
