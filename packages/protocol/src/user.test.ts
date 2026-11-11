import { describe, expect, it } from "vitest";
import {
  BOARD_THEMES,
  COUNTRIES,
  CompleteOnboardingBody,
  Country,
  DEFAULT_USER_SETTINGS,
  GetMeResponse,
  isReservedNickname,
  Locale,
  Me,
  MeResponse,
  Nickname,
  NICKNAME_RE,
  PIECE_SETS,
  PublicUser,
  RESERVED_NICKNAMES,
  UpdateMeBody,
  UserSettings,
} from "./index.ts";

/** Список S14 (SECURITY §12). */
const S14 = ["admin", "administrator", "moderator", "support", "system", "deleted", "deleted_player", "null", "undefined"];

const SETTINGS = {
  theme: "dark",
  sound: false,
  board_theme: "blue",
  piece_set: "merida",
  auto_queen: false,
  confirm_move_mobile: true,
};

/** П1 после первого входа через Google (API §12.1, пример): ника нет, первый вход не пройден. */
const ONBOARDING_ME = {
  id: "5b0c1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4",
  nickname: null,
  avatar_url: null,
  country: null,
  created_at: "2026-11-10T12:00:00.000Z",
  email: null,
  locale: "ru",
  settings: {
    theme: "light",
    sound: true,
    board_theme: "brown",
    piece_set: "cburnett",
    auto_queen: true,
    confirm_move_mobile: false,
  },
  terms_accepted_at: null,
  can_change_nickname: true,
  onboarding_required: true,
  active_game_id: null,
  open_challenge_id: null,
};

/** Игрок после `completeOnboarding`. */
const PLAYER_ME = {
  ...ONBOARDING_ME,
  nickname: "knight_rider-7",
  avatar_url: "https://lh3.googleusercontent.com/a/x",
  country: "RU",
  email: "player@example.com",
  locale: "en",
  settings: SETTINGS,
  terms_accepted_at: "2026-11-10T12:01:00.000Z",
  onboarding_required: false,
};

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown): boolean => schema.safeParse(v).success;

describe("ник (К-5, ТЗ §4.1 п.3)", () => {
  it("К-5: 3 и 20 символов [A-Za-z0-9_-] — допустимы", () => {
    for (const n of ["abc", "a".repeat(20), "knight_rider-7", "ABC", "a_b", "a-b", "123", "___", "Z9-_x"]) {
      expect(ok(Nickname, n), n).toBe(true);
      expect(NICKNAME_RE.test(n), n).toBe(true);
    }
  });

  it("К-5: 2 и 21 символ — недопустимы", () => {
    for (const n of ["ab", "a".repeat(21), "", "a"]) {
      expect(ok(Nickname, n), n).toBe(false);
      expect(NICKNAME_RE.test(n), n).toBe(false);
    }
  });

  it("К-5: пробел, кириллица, точка, @ и прочие символы — недопустимы", () => {
    for (const n of ["a b", " abc", "abc ", "ник", "Магнус", "abcё", "a.b", "a@b", "a+b", "a/b", "a\tb", "abc\n", "émile"]) {
      expect(ok(Nickname, n), JSON.stringify(n)).toBe(false);
      expect(NICKNAME_RE.test(n), JSON.stringify(n)).toBe(false);
    }
  });

  it("К-5: не строка — не ник", () => {
    for (const v of [null, undefined, 123, ["abc"]]) expect(ok(Nickname, v), String(v)).toBe(false);
  });
});

describe("резерв ников (К-5, S14)", () => {
  it("К-5: RESERVED_NICKNAMES — ровно список S14 в нижнем регистре", () => {
    expect([...RESERVED_NICKNAMES].sort()).toEqual([...S14].sort());
    for (const n of RESERVED_NICKNAMES) expect(n).toBe(n.toLowerCase());
  });

  it("К-5: каждая строка S14 зарезервирована", () => {
    for (const n of S14) expect(isReservedNickname(n), n).toBe(true);
  });

  it("К-5: резерв без учёта регистра", () => {
    for (const n of S14) {
      expect(isReservedNickname(n.toUpperCase()), n.toUpperCase()).toBe(true);
      const cap = n[0]!.toUpperCase() + n.slice(1);
      expect(isReservedNickname(cap), cap).toBe(true);
    }
    for (const n of ["Admin", "NULL", "Deleted_Player", "SuPpOrT", "unDefined"]) expect(isReservedNickname(n), n).toBe(true);
  });

  it("К-5: обычные ники не зарезервированы", () => {
    for (const n of ["magnus", "Magnus", "knight_rider-7", "queen_b"]) expect(isReservedNickname(n), n).toBe(false);
  });
});

describe("CompleteOnboardingBody (К-5, API §12.1)", () => {
  it("К-5: {nickname, terms_accepted: true} принимается", () => {
    expect(ok(CompleteOnboardingBody, { nickname: "knight_rider-7", terms_accepted: true })).toBe(true);
  });

  it("К-5: формат ника схема не проверяет — это делает сервер (nickname_invalid)", () => {
    for (const n of ["ab", "a b", "ник", "a".repeat(21)]) {
      expect(ok(CompleteOnboardingBody, { nickname: n, terms_accepted: true }), n).toBe(true);
    }
  });

  it("К-5: ник до 64 символов; 65 — отказ схемы", () => {
    expect(ok(CompleteOnboardingBody, { nickname: "a".repeat(64), terms_accepted: true })).toBe(true);
    expect(ok(CompleteOnboardingBody, { nickname: "a".repeat(65), terms_accepted: true })).toBe(false);
  });

  it("К-5: terms_accepted: false или не true — отказ схемы", () => {
    for (const t of [false, "true", 1, null]) {
      expect(ok(CompleteOnboardingBody, { nickname: "knight_rider-7", terms_accepted: t }), String(t)).toBe(false);
    }
  });

  it("К-5: нет terms_accepted или нет nickname — отказ схемы", () => {
    expect(ok(CompleteOnboardingBody, { nickname: "knight_rider-7" })).toBe(false);
    expect(ok(CompleteOnboardingBody, { terms_accepted: true })).toBe(false);
    expect(ok(CompleteOnboardingBody, {})).toBe(false);
  });

  it("К-5: ник не строка — отказ схемы", () => {
    for (const n of [null, 123, ["abc"]]) {
      expect(ok(CompleteOnboardingBody, { nickname: n, terms_accepted: true }), String(n)).toBe(false);
    }
  });

  it("К-5: лишнее поле — отказ (.strict())", () => {
    expect(ok(CompleteOnboardingBody, { nickname: "knight_rider-7", terms_accepted: true, locale: "en" })).toBe(false);
    expect(ok(CompleteOnboardingBody, { nickname: "knight_rider-7", terms_accepted: true, user_id: "x" })).toBe(false);
  });
});

describe("страны и язык (К-7)", () => {
  it("К-7: COUNTRIES — 249 уникальных кодов ^[A-Z]{2}$", () => {
    expect(COUNTRIES).toHaveLength(249);
    expect(new Set(COUNTRIES).size).toBe(249);
    for (const c of COUNTRIES) expect(c, c).toMatch(/^[A-Z]{2}$/);
  });

  it("К-7: COUNTRIES включает известные коды ISO 3166-1 alpha-2", () => {
    for (const c of ["RU", "US", "GB", "DE", "FR", "UA", "KZ", "BY", "JP", "AQ"]) {
      expect(COUNTRIES, c).toContain(c);
    }
  });

  it("К-7: Country принимает только коды из COUNTRIES", () => {
    for (const c of COUNTRIES) expect(ok(Country, c), c).toBe(true);
    for (const c of ["ru", "Ru", "XX", "RUS", "UK", "", " RU", "R", 1, null]) expect(ok(Country, c), String(c)).toBe(false);
  });

  it("К-7: Locale — только ru и en", () => {
    expect(ok(Locale, "ru")).toBe(true);
    expect(ok(Locale, "en")).toBe(true);
    for (const l of ["RU", "de", "en-US", ""]) expect(ok(Locale, l), l).toBe(false);
  });
});

describe("UserSettings (К-7, API §4.3)", () => {
  it("К-7: BOARD_THEMES и PIECE_SETS — значения API §4.3", () => {
    expect([...BOARD_THEMES]).toEqual(["brown", "blue", "green"]);
    expect([...PIECE_SETS]).toEqual(["cburnett", "merida"]);
  });

  it("К-7: DEFAULT_USER_SETTINGS — значения по умолчанию API §4.3 и проходят UserSettings", () => {
    expect(DEFAULT_USER_SETTINGS).toEqual({
      theme: "light",
      sound: true,
      board_theme: "brown",
      piece_set: "cburnett",
      auto_queen: true,
      confirm_move_mobile: false,
    });
    expect(ok(UserSettings, DEFAULT_USER_SETTINGS)).toBe(true);
  });

  it("К-7: полный UserSettings принимается; каждая тема доски и набор фигур — тоже", () => {
    expect(ok(UserSettings, SETTINGS)).toBe(true);
    for (const b of BOARD_THEMES) expect(ok(UserSettings, { ...SETTINGS, board_theme: b }), b).toBe(true);
    for (const p of PIECE_SETS) expect(ok(UserSettings, { ...SETTINGS, piece_set: p }), p).toBe(true);
  });

  it("К-7: theme system, неизвестная board_theme, piece_set, не boolean — отказ", () => {
    expect(ok(UserSettings, { ...SETTINGS, theme: "system" })).toBe(false);
    expect(ok(UserSettings, { ...SETTINGS, board_theme: "red" })).toBe(false);
    expect(ok(UserSettings, { ...SETTINGS, piece_set: "alpha" })).toBe(false);
    expect(ok(UserSettings, { ...SETTINGS, sound: "true" })).toBe(false);
  });

  it("К-7: в UserSettings все поля обязательны", () => {
    for (const key of Object.keys(SETTINGS)) {
      const partial: Record<string, unknown> = { ...SETTINGS };
      delete partial[key];
      expect(ok(UserSettings, partial), key).toBe(false);
    }
  });
});

describe("UpdateMeBody (К-7, API §12.1)", () => {
  it("К-7: страна из COUNTRIES и null принимаются", () => {
    expect(ok(UpdateMeBody, { country: "RU" })).toBe(true);
    expect(ok(UpdateMeBody, { country: null })).toBe(true);
  });

  it("К-7: неизвестная страна и нижний регистр — отказ", () => {
    for (const c of ["XX", "ru", "RUS", ""]) expect(ok(UpdateMeBody, { country: c }), c).toBe(false);
  });

  it("К-7: locale ru/en принимается; другой — отказ", () => {
    expect(ok(UpdateMeBody, { locale: "en" })).toBe(true);
    expect(ok(UpdateMeBody, { locale: "ru" })).toBe(true);
    expect(ok(UpdateMeBody, { locale: "de" })).toBe(false);
    expect(ok(UpdateMeBody, { locale: null })).toBe(false);
  });

  it("К-7: частичные settings принимаются (одно поле, несколько, все)", () => {
    expect(ok(UpdateMeBody, { settings: { sound: false } })).toBe(true);
    expect(ok(UpdateMeBody, { settings: { board_theme: "green", piece_set: "merida" } })).toBe(true);
    expect(ok(UpdateMeBody, { settings: SETTINGS })).toBe(true);
    expect(ok(UpdateMeBody, { country: "DE", locale: "en", settings: { theme: "dark" } })).toBe(true);
  });

  it("К-7: лишний ключ в settings — отказ (.strict())", () => {
    expect(ok(UpdateMeBody, { settings: { sound: false, volume: 3 } })).toBe(false);
  });

  it("К-7: неизвестная board_theme и theme system в settings — отказ", () => {
    expect(ok(UpdateMeBody, { settings: { board_theme: "red" } })).toBe(false);
    expect(ok(UpdateMeBody, { settings: { theme: "system" } })).toBe(false);
  });

  it("К-7: лишнее поле верхнего уровня — отказ (ник, email и т.п. не меняются этим маршрутом)", () => {
    for (const extra of [{ nickname: "magnus" }, { email: "a@example.com" }, { terms_accepted: true }, { foo: 1 }]) {
      expect(ok(UpdateMeBody, extra), JSON.stringify(extra)).toBe(false);
    }
  });
});

describe("PublicUser, Me, ответы getMe (К-4)", () => {
  it("К-4: PublicUser принимает П1 (nickname null) и Игрока", () => {
    const pick = ({ id, nickname, avatar_url, country, created_at }: typeof PLAYER_ME | typeof ONBOARDING_ME) => ({
      id,
      nickname,
      avatar_url,
      country,
      created_at,
    });
    expect(ok(PublicUser, pick(ONBOARDING_ME))).toBe(true);
    expect(ok(PublicUser, pick(PLAYER_ME))).toBe(true);
  });

  it("К-4: Me принимает пример API §12.1 — П1 с nickname: null, onboarding_required: true", () => {
    expect(ok(Me, ONBOARDING_ME)).toBe(true);
  });

  it("К-4: Me принимает Игрока (can_change_nickname: true, active_game_id и open_challenge_id = null)", () => {
    expect(ok(Me, PLAYER_ME)).toBe(true);
    expect(ok(Me, { ...PLAYER_ME, settings: DEFAULT_USER_SETTINGS })).toBe(true);
  });

  it("К-4: Me без обязательного поля — отказ", () => {
    for (const key of ["id", "locale", "settings", "can_change_nickname", "onboarding_required", "terms_accepted_at"]) {
      const m: Record<string, unknown> = { ...PLAYER_ME };
      delete m[key];
      expect(ok(Me, m), key).toBe(false);
    }
  });

  it("К-4: Me с неверными типами — отказ", () => {
    expect(ok(Me, { ...PLAYER_ME, locale: "de" })).toBe(false);
    expect(ok(Me, { ...PLAYER_ME, onboarding_required: "false" })).toBe(false);
    expect(ok(Me, { ...PLAYER_ME, settings: { ...SETTINGS, theme: "system" } })).toBe(false);
  });

  it("К-4: GetMeResponse — {user: null} у гостя и {user: Me}", () => {
    expect(ok(GetMeResponse, { user: null })).toBe(true);
    expect(ok(GetMeResponse, { user: ONBOARDING_ME })).toBe(true);
    expect(ok(GetMeResponse, { user: PLAYER_ME })).toBe(true);
    expect(ok(GetMeResponse, {})).toBe(false);
  });

  it("К-5: MeResponse — {user: Me}; null — отказ", () => {
    expect(ok(MeResponse, { user: PLAYER_ME })).toBe(true);
    expect(ok(MeResponse, { user: null })).toBe(false);
    expect(ok(MeResponse, {})).toBe(false);
  });
});
