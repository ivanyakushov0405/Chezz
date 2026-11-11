// SQL модуля users (ARCHITECTURE §7.4): единственное место, где читается и пишется users.
import type { UserSettings } from "@chezz/protocol";
import { sql, type Selectable } from "kysely";
import { forTables, type Db, type Trx } from "../platform/db.ts";
import type { UsersTable, UsersTables } from "./tables.ts";

export type UserRow = Selectable<UsersTable>;

export interface GoogleProfile {
  google_sub: string;
  email: string | null;
  google_name: string | null;
  avatar_url: string | null;
}

/**
 * Вход (SECURITY §4 п.5): нет строки с этим `sub` — создать, есть — обновить email, google_name, avatar_url.
 * Одним запросом: два одновременных первых входа одного `sub` не создают двух User.
 */
export async function upsertFromGoogle(
  db: Db | Trx,
  profile: GoogleProfile,
  onCreate: { locale: "ru" | "en"; settings: UserSettings; created_at: Date },
): Promise<{ user: UserRow; created: boolean }> {
  const row = await forTables<UsersTables>(db)
    .insertInto("users")
    .values({ ...profile, ...onCreate, settings: JSON.stringify(onCreate.settings) })
    .onConflict((oc) =>
      oc.column("google_sub").doUpdateSet((eb) => ({
        email: eb.ref("excluded.email"),
        google_name: eb.ref("excluded.google_name"),
        avatar_url: eb.ref("excluded.avatar_url"),
      })),
    )
    .returningAll()
    // xmax = 0 у только что вставленной строки (на конфликте — UPDATE, xmax ≠ 0).
    .returning(sql<boolean>`(xmax = 0)`.as("inserted"))
    .executeTakeFirstOrThrow();
  const { inserted, ...user } = row;
  return { user, created: inserted };
}

export async function findById(db: Db | Trx, id: string): Promise<UserRow | null> {
  return (await forTables<UsersTables>(db).selectFrom("users").selectAll().where("id", "=", id).executeTakeFirst()) ?? null;
}

/** Первый вход: ник и принятие правил одним UPDATE, только если ника ещё нет. null — строки нет или первый вход уже был. */
export async function setOnboarding(db: Db | Trx, id: string, nickname: string, acceptedAt: Date): Promise<UserRow | null> {
  return (
    (await forTables<UsersTables>(db)
      .updateTable("users")
      .set({ nickname, terms_accepted_at: acceptedAt })
      .where("id", "=", id)
      .where("nickname", "is", null)
      .where("deleted_at", "is", null)
      .returningAll()
      .executeTakeFirst()) ?? null
  );
}

export interface ProfilePatch {
  country?: string | null;
  locale?: "ru" | "en";
  settings?: Partial<UserSettings>;
}

/** `PATCH /api/me`: `settings` сливается с сохранёнными (jsonb ||). */
export async function updateProfile(db: Db | Trx, id: string, patch: ProfilePatch): Promise<UserRow | null> {
  const set: Record<string, unknown> = {};
  if (patch.country !== undefined) set["country"] = patch.country;
  if (patch.locale !== undefined) set["locale"] = patch.locale;
  if (patch.settings !== undefined) set["settings"] = sql`settings || ${JSON.stringify(patch.settings)}::jsonb`;
  const q = forTables<UsersTables>(db).updateTable("users").where("id", "=", id).where("deleted_at", "is", null);
  if (Object.keys(set).length === 0) {
    return (await forTables<UsersTables>(db).selectFrom("users").selectAll().where("id", "=", id).where("deleted_at", "is", null).executeTakeFirst()) ?? null;
  }
  return (await q.set(set).returningAll().executeTakeFirst()) ?? null;
}

/** Нарушение уникальности ника (индекс users_nickname_lower_key). */
export function isNicknameConflict(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string } | null;
  return e?.code === "23505" && e.constraint === "users_nickname_lower_key";
}
