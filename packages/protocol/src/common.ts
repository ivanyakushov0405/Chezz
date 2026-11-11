import { z } from "zod";
import { ErrorCode } from "./errors.ts";

/** Категория контроля времени (GLOSSARY §6). */
export const Category = z.enum(["bullet", "blitz", "rapid"]);
export type Category = z.infer<typeof Category>;

/** Ошибка REST, формат API §5.1. `details`: у `validation_failed` — `{issues}`, у `rate_limited` — `{retry_after_ms}`, иначе `null`. */
export const ErrorResponse = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.unknown(),
    request_id: z.uuid(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

/** Язык интерфейса (ТЗ §5, DESIGN §15). */
export const Locale = z.enum(["ru", "en"]);
export type Locale = z.infer<typeof Locale>;

/** ISO 3166-1 alpha-2, верхний регистр (API §4.2, SECURITY §10: только код из списка). */
export const COUNTRIES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS",
  "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN",
  "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE",
  "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF",
  "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM",
  "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM",
  "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC",
  "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK",
  "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA",
  "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG",
  "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS",
  "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO",
  "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI",
  "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW",
] as const;
export const Country = z.enum(COUNTRIES);
export type Country = z.infer<typeof Country>;

/** Темы доски и наборы фигур (DESIGN U9, U10; API P30). */
export const BOARD_THEMES = ["brown", "blue", "green"] as const;
export const PIECE_SETS = ["cburnett", "merida"] as const;

/** Настройки игрока (API §4.3). `system` в `theme` — нет до ответа на F4-Q8. */
export const UserSettings = z.object({
  theme: z.enum(["light", "dark"]),
  sound: z.boolean(),
  board_theme: z.enum(BOARD_THEMES),
  piece_set: z.enum(PIECE_SETS),
  auto_queen: z.boolean(),
  confirm_move_mobile: z.boolean(),
});
export type UserSettings = z.infer<typeof UserSettings>;

export const DEFAULT_USER_SETTINGS: UserSettings = Object.freeze({
  theme: "light",
  sound: true,
  board_theme: "brown",
  piece_set: "cburnett",
  auto_queen: true,
  confirm_move_mobile: false,
});

/** Публичная проекция User (API §4.2, SECURITY §12). `nickname: null` — удалённый игрок или ещё нет первого входа. */
export const PublicUser = z.object({
  id: z.string(),
  nickname: z.string().nullable(),
  avatar_url: z.string().nullable(),
  country: z.string().nullable(),
  created_at: z.iso.datetime(),
});
export type PublicUser = z.infer<typeof PublicUser>;

/** Своё — только в `Me` (API §4.3, P10). */
export const Me = PublicUser.extend({
  email: z.string().nullable(),
  locale: Locale,
  settings: UserSettings,
  terms_accepted_at: z.iso.datetime().nullable(),
  can_change_nickname: z.boolean(),
  onboarding_required: z.boolean(),
  active_game_id: z.string().nullable(),
  open_challenge_id: z.string().nullable(),
});
export type Me = z.infer<typeof Me>;
