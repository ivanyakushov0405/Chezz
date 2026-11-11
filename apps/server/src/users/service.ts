// users: User, ник, принятие правил, проекции PublicUser / Me (ARCHITECTURE §7.1; API §4.2, §12.1).
import {
  DEFAULT_USER_SETTINGS,
  isReservedNickname,
  Nickname,
  type Me,
  type PublicUser,
  type UpdateMeBody,
} from "@chezz/protocol";
import type { Database } from "../database.ts";
import type { Db, Trx } from "../platform/db.ts";
import { AppError } from "../platform/errors.ts";
import type { TimeSource } from "../platform/time.ts";
import {
  findById,
  isNicknameConflict,
  lockUsers,
  setOnboarding,
  updateProfile,
  upsertFromGoogle,
  type GoogleProfile,
  type UserRow,
} from "./repo.ts";

export type { UserRow } from "./repo.ts";

/** Аватар — только с домена Google (SECURITY §10, ARCHITECTURE §14); иначе заглушка на клиенте. */
const AVATAR_PREFIX = "https://lh3.googleusercontent.com/";

export interface GoogleIdentity {
  sub: string;
  email: string | null;
  email_verified: boolean;
  name: string | null;
  picture: string | null;
}

/** Части `Me` других модулей (партия E06, вызов E08); до них — null. */
export interface MeExtras {
  active_game_id: string | null;
  open_challenge_id: string | null;
}

const NO_EXTRAS: MeExtras = Object.freeze({ active_game_id: null, open_challenge_id: null });

export interface UsersService {
  /** SECURITY §4 п.5; `locale` — только для нового User (язык браузера). */
  signInWithGoogle(identity: GoogleIdentity, locale: "ru" | "en"): Promise<{ user: UserRow; created: boolean }>;
  getUser(id: string): Promise<UserRow | null>;
  /** Первый вход пройден: есть ник и принятие правил (SECURITY S5). */
  isOnboarded(user: UserRow): boolean;
  completeOnboarding(id: string, nickname: string): Promise<UserRow>;
  updateMe(id: string, patch: UpdateMeBody): Promise<UserRow>;
  toPublicUser(user: UserRow): PublicUser;
  toMe(user: UserRow, extras?: MeExtras): Me;
  /**
   * Первое действие транзакции создания партии, вызова, удаления (ADR-0008 п.1): `FOR UPDATE` строк users
   * по возрастанию `id`. Возвращает признак удалённого; отсутствующий id — ошибка (вызывающий передал чужое).
   */
  lockForGame(trx: Trx, ids: readonly string[]): Promise<{ id: string; deleted: boolean }[]>;
}

export function createUsersService(deps: { db: Db<Database>; time: TimeSource }): UsersService {
  const { db, time } = deps;
  const isOnboarded = (user: UserRow): boolean => user.nickname !== null && user.terms_accepted_at !== null;

  const toPublicUser = (user: UserRow): PublicUser => ({
    id: user.id,
    nickname: user.deleted_at === null ? user.nickname : null,
    avatar_url: user.avatar_url !== null && user.avatar_url.startsWith(AVATAR_PREFIX) ? user.avatar_url : null,
    country: user.country,
    created_at: user.created_at.toISOString(),
  });

  return {
    async signInWithGoogle(identity, locale) {
      const profile: GoogleProfile = {
        google_sub: identity.sub,
        // S19: e-mail — только подтверждённый.
        email: identity.email_verified ? identity.email : null,
        google_name: identity.name,
        avatar_url: identity.picture,
      };
      return upsertFromGoogle(db, profile, { locale, settings: DEFAULT_USER_SETTINGS, created_at: time.wallNow() });
    },

    getUser: (id) => findById(db, id),

    isOnboarded,

    async completeOnboarding(id, nickname) {
      if (!Nickname.safeParse(nickname).success) throw new AppError("nickname_invalid");
      if (isReservedNickname(nickname)) throw new AppError("nickname_reserved");
      let row: UserRow | null;
      try {
        row = await setOnboarding(db, id, nickname, time.wallNow());
      } catch (err) {
        if (isNicknameConflict(err)) throw new AppError("nickname_taken");
        throw err;
      }
      if (row === null) throw new AppError("onboarding_completed");
      return row;
    },

    async updateMe(id, patch) {
      const row = await updateProfile(db, id, {
        ...(patch.country !== undefined ? { country: patch.country } : {}),
        ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
        ...(patch.settings !== undefined ? { settings: patch.settings } : {}),
      });
      if (row === null) throw new AppError("unauthenticated");
      return row;
    },

    toPublicUser,

    async lockForGame(trx, ids) {
      const rows = await lockUsers(trx, ids);
      if (rows.length !== new Set(ids).size) throw new Error("lockForGame: unknown user id");
      return rows.map((r) => ({ id: r.id, deleted: r.deleted_at !== null }));
    },

    toMe(user, extras = NO_EXTRAS) {
      return {
        ...toPublicUser(user),
        email: user.email,
        locale: user.locale,
        settings: { ...DEFAULT_USER_SETTINGS, ...user.settings },
        terms_accepted_at: user.terms_accepted_at?.toISOString() ?? null,
        can_change_nickname: isOnboarded(user) && user.nickname_changed_at === null,
        onboarding_required: !isOnboarded(user),
        active_game_id: extras.active_game_id,
        open_challenge_id: extras.open_challenge_id,
      };
    },
  };
}
