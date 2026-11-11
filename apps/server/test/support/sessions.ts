// Чтение users / sessions для тестов (SQL вне apps/server/src — ARCHITECTURE §7.4, TESTING §7.6).
import type { Database } from "../../src/database.ts";
import type { Db } from "../../src/platform/db.ts";

export interface SessionInfo {
  id: string;
  token_hash: string;
  expires_at: Date;
}

export async function listUserSessions(db: Db<Database>, userId: string): Promise<SessionInfo[]> {
  return db.selectFrom("sessions").select(["id", "token_hash", "expires_at"]).where("user_id", "=", userId).execute();
}

export interface PlayerSessionInfo {
  nickname: string | null;
  terms_accepted_at: Date | null;
  token_hash: string;
  expires_at: Date;
}

/** Session игроков по нику (сид --demo). */
export async function listSessionsByNickname(db: Db<Database>, nicknames: readonly string[]): Promise<PlayerSessionInfo[]> {
  return db
    .selectFrom("users")
    .innerJoin("sessions", "sessions.user_id", "users.id")
    .select(["users.nickname", "users.terms_accepted_at", "sessions.token_hash", "sessions.expires_at"])
    .where("users.nickname", "in", [...nicknames])
    .execute();
}
