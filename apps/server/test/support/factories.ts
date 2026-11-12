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

export interface CreateGameRowOptions {
  /** Свой id (по умолчанию — случайный); строка с таким id уже есть — ничего не делается. */
  id?: string;
  white_id: string;
  black_id: string;
  /** Секунды (по умолчанию 3+2, блиц). */
  time_base?: number;
  time_increment?: number;
  rated?: boolean;
  /** Ходы `moves[]` (SAN + остаток после хода); по умолчанию пусто. */
  moves?: { san: string; clock_ms: number }[];
  started_at?: Date;
}

const categoryFor = (base: number, inc: number): "bullet" | "blitz" | "rapid" => {
  const total = base + 40 * inc;
  return total <= 179 ? "bullet" : total <= 479 ? "blitz" : "rapid";
};

/** `active` Game прямо в таблице (TESTING §7.6): комнату app поднимет по первой команде (бриф E06). */
export async function createActiveGame(db: Db<Database>, options: CreateGameRowOptions): Promise<{ game_id: string }> {
  const base = options.time_base ?? 180;
  const inc = options.time_increment ?? 2;
  const row = await db
    .insertInto("games")
    .values({
      white_id: options.white_id,
      black_id: options.black_id,
      category: categoryFor(base, inc),
      time_base: base,
      time_increment: inc,
      rated: options.rated ?? true,
      status: "active",
      result: null,
      termination: null,
      pgn: null,
      moves: JSON.stringify(options.moves ?? []),
      started_at: options.started_at ?? new Date(),
      ended_at: null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { game_id: row.id };
}

/** Законченная Game (история, лидеры, снимок законченной партии). */
export async function createFinishedGame(
  db: Db<Database>,
  options: CreateGameRowOptions & { result?: "white_wins" | "black_wins" | "draw"; termination?: "checkmate" | "timeout"; ended_at?: Date },
): Promise<{ game_id: string }> {
  const base = options.time_base ?? 180;
  const inc = options.time_increment ?? 2;
  const started = options.started_at ?? new Date();
  const row = await db
    .insertInto("games")
    .values({
      ...(options.id === undefined ? {} : { id: options.id }),
      white_id: options.white_id,
      black_id: options.black_id,
      category: categoryFor(base, inc),
      time_base: base,
      time_increment: inc,
      rated: options.rated ?? true,
      status: "finished",
      result: options.result ?? "white_wins",
      termination: options.termination ?? "checkmate",
      pgn: "",
      moves: JSON.stringify(options.moves ?? []),
      started_at: started,
      ended_at: options.ended_at ?? started,
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .returning("id")
    .executeTakeFirst();
  return { game_id: row?.id ?? options.id! };
}
