// Фабрики (TESTING §7.6): пишут прямо в таблицы (SQL Kysely), минуя service; правило §7.4 — только для src/.
import { randomBytes, randomUUID } from "node:crypto";
import { DEFAULT_USER_SETTINGS } from "@chezz/protocol";
import type { Database } from "../../src/database.ts";
import { hashToken, SESSION_COOKIE, SESSION_TTL_MS } from "../../src/auth/service.ts";
import type { Db } from "../../src/platform/db.ts";

export interface CreatePlayerOptions {
  /** По умолчанию — случайный допустимый ник; `null` — П1 (первый вход не пройден, SECURITY S5). */
  nickname?: string | null;
  /** Токен Session; по умолчанию — случайный. `null` — без Session. */
  token?: string | null;
  locale?: "ru" | "en";
  /** По умолчанию — случайный (`test-<uuid>`); сид задаёт свой, чтобы повтор находил те же строки. */
  google_sub?: string;
  avatar_url?: string | null;
  /** «Сейчас» для created_at / expires_at (по умолчанию — время процесса). */
  now?: Date;
  /** Срок Session (по умолчанию 30 дней от now). */
  sessionExpiresAt?: Date;
}

export interface CreatedPlayer {
  user_id: string;
  nickname: string | null;
  session_id: string | null;
  token: string | null;
  /** Значение заголовка Cookie: `__Host-sid=<токен>`; null — без Session. */
  cookie: string | null;
}

export function randomNickname(prefix = "p"): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export async function createPlayer(db: Db<Database>, options: CreatePlayerOptions = {}): Promise<CreatedPlayer> {
  const now = options.now ?? new Date();
  const nickname = options.nickname === undefined ? randomNickname() : options.nickname;
  const user = await db
    .insertInto("users")
    .values({
      google_sub: options.google_sub ?? `test-${randomUUID()}`,
      email: null,
      google_name: null,
      nickname,
      avatar_url: options.avatar_url ?? null,
      country: null,
      locale: options.locale ?? "en",
      settings: JSON.stringify(DEFAULT_USER_SETTINGS),
      terms_accepted_at: nickname === null ? null : now,
      nickname_changed_at: null,
      created_at: now,
      deleted_at: null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const token = options.token === undefined ? randomBytes(32).toString("base64url") : options.token;
  if (token === null) return { user_id: user.id, nickname, session_id: null, token: null, cookie: null };
  const session = await db
    .insertInto("sessions")
    .values({
      token_hash: hashToken(token),
      user_id: user.id,
      created_at: now,
      expires_at: options.sessionExpiresAt ?? new Date(now.getTime() + SESSION_TTL_MS),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { user_id: user.id, nickname, session_id: session.id, token, cookie: `${SESSION_COOKIE}=${token}` };
}
