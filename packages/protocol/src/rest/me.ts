import { z } from "zod";
import { Country, Locale, Me, UserSettings } from "../common.ts";

/** Ник: 3–20 символов, латиница, цифры, «_» и «-» (ТЗ §4.1 п.3). */
export const NICKNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
export const Nickname = z.string().regex(NICKNAME_RE);

/** Зарезервированные ники (SECURITY S14), в нижнем регистре. */
export const RESERVED_NICKNAMES = [
  "admin",
  "administrator",
  "moderator",
  "support",
  "system",
  "deleted",
  "deleted_player",
  "null",
  "undefined",
] as const;

const RESERVED = new Set<string>(RESERVED_NICKNAMES);

/** Резерв — без учёта регистра, как и уникальность (S14). */
export function isReservedNickname(nickname: string): boolean {
  return RESERVED.has(nickname.toLowerCase());
}

/** `GET /api/me` (API §12.1, P10): гостю — `null`. */
export const GetMeResponse = z.object({ user: Me.nullable() });
export type GetMeResponse = z.infer<typeof GetMeResponse>;

export const MeResponse = z.object({ user: Me });
export type MeResponse = z.infer<typeof MeResponse>;

/** `POST /api/me/onboarding`: формат ника проверяет сервер (`nickname_invalid`), схема — только длину сверху. */
export const CompleteOnboardingBody = z.strictObject({
  nickname: z.string().max(64),
  terms_accepted: z.literal(true),
});
export type CompleteOnboardingBody = z.infer<typeof CompleteOnboardingBody>;

/** `PATCH /api/me`: `settings` — частичный UserSettings, `.strict()` (API §4.3). */
export const UpdateMeBody = z.strictObject({
  country: Country.nullable().optional(),
  locale: Locale.optional(),
  settings: UserSettings.partial().strict().optional(),
});
export type UpdateMeBody = z.infer<typeof UpdateMeBody>;
