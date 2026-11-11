// users.service на реальной PostgreSQL (TESTING §5): вход из Google, первый вход, updateMe, проекции.
import { randomUUID } from "node:crypto";
import { DEFAULT_USER_SETTINGS, Me } from "@chezz/protocol";
import { afterAll, describe, expect, it } from "vitest";
import { workerDatabaseUrl } from "../../test/support/db.ts";
import { ManualTimeSource } from "../../test/support/time.ts";
import type { Database } from "../database.ts";
import { createDb } from "../platform/db.ts";
import { AppError } from "../platform/errors.ts";
import { createUsersService, type GoogleIdentity } from "./service.ts";

const db = createDb<Database>(workerDatabaseUrl());
const time = new ManualTimeSource({ wall: new Date("2026-11-10T12:00:00.000Z") });
const users = createUsersService({ db, time });
afterAll(() => db.destroy());

const AVATAR = "https://lh3.googleusercontent.com/a/abc";

function identity(over: Partial<GoogleIdentity> = {}): GoogleIdentity {
  return { sub: `sub-${randomUUID()}`, email: "p@example.test", email_verified: true, name: "Pat", picture: AVATAR, ...over };
}

/** Уникальный допустимый ник (≤ 20 символов). */
function nick(prefix = "p"): string {
  return `${prefix}_${randomUUID().slice(0, 12)}`;
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof AppError) return err.code;
    throw err;
  }
  return "ok";
}

describe("users.service", () => {
  it("К-3: новый sub → User с locale браузера и настройками по умолчанию; повтор — тот же User, обновлены email, имя, аватар", async () => {
    const id = identity();
    const first = await users.signInWithGoogle(id, "ru");
    expect(first.created).toBe(true);
    expect(first.user).toMatchObject({ google_sub: id.sub, email: "p@example.test", google_name: "Pat", locale: "ru", nickname: null });
    expect(first.user.settings).toEqual(DEFAULT_USER_SETTINGS);

    const second = await users.signInWithGoogle({ ...id, email: "new@example.test", name: "Pat 2", picture: `${AVATAR}2` }, "en");
    expect(second.created).toBe(false);
    expect(second.user.id).toBe(first.user.id);
    expect(second.user).toMatchObject({ email: "new@example.test", google_name: "Pat 2", avatar_url: `${AVATAR}2`, locale: "ru" });
  });

  it("К-3: email без email_verified не сохраняется (S19)", async () => {
    const { user } = await users.signInWithGoogle(identity({ email_verified: false }), "en");
    expect(user.email).toBeNull();
  });

  it("К-3: два одновременных первых входа одного sub — один User", async () => {
    const id = identity();
    const [a, b] = await Promise.all([users.signInWithGoogle(id, "en"), users.signInWithGoogle(id, "en")]);
    expect(a.user.id).toBe(b.user.id);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
  });

  it("К-4: toMe П1 — onboarding_required, ник null, can_change_nickname false; Игрок — полный Me", async () => {
    const { user } = await users.signInWithGoogle(identity(), "en");
    const p1 = users.toMe(user);
    expect(Me.parse(p1)).toBeTruthy();
    expect(p1).toMatchObject({ nickname: null, onboarding_required: true, can_change_nickname: false, terms_accepted_at: null });
    expect(users.isOnboarded(user)).toBe(false);

    const done = await users.completeOnboarding(user.id, nick());
    const me = users.toMe(done);
    expect(me).toMatchObject({
      onboarding_required: false,
      can_change_nickname: true,
      active_game_id: null,
      open_challenge_id: null,
      terms_accepted_at: "2026-11-10T12:00:00.000Z",
      avatar_url: AVATAR,
    });
    expect(users.isOnboarded(done)).toBe(true);
  });

  it("К-4: аватар не с lh3.googleusercontent.com — в проекции null (SECURITY §10)", async () => {
    const { user } = await users.signInWithGoogle(identity({ picture: "https://evil.example/a.png" }), "en");
    expect(users.toPublicUser(user).avatar_url).toBeNull();
    expect(Object.keys(users.toPublicUser(user)).sort()).toEqual(["avatar_url", "country", "created_at", "id", "nickname"]);
  });

  it("К-5: неверный формат → nickname_invalid, резерв в любом регистре → nickname_reserved; ник не записан", async () => {
    const { user } = await users.signInWithGoogle(identity(), "en");
    for (const bad of ["ab", "a".repeat(21), "имя", "with space", "a.b"]) {
      expect(await codeOf(users.completeOnboarding(user.id, bad)), bad).toBe("nickname_invalid");
    }
    for (const reserved of ["Admin", "SYSTEM", "deleted_player", "Null"]) {
      expect(await codeOf(users.completeOnboarding(user.id, reserved)), reserved).toBe("nickname_reserved");
    }
    expect((await users.getUser(user.id))?.nickname).toBeNull();
  });

  it("К-5: повторный первый вход → onboarding_completed, ник не меняется", async () => {
    const { user } = await users.signInWithGoogle(identity(), "en");
    const name = nick();
    await users.completeOnboarding(user.id, name);
    expect(await codeOf(users.completeOnboarding(user.id, nick()))).toBe("onboarding_completed");
    expect((await users.getUser(user.id))?.nickname).toBe(name);
  });

  it("К-5 E-1: ник занят без учёта регистра → nickname_taken", async () => {
    const a = await users.signInWithGoogle(identity(), "en");
    const b = await users.signInWithGoogle(identity(), "en");
    const name = nick("magnus");
    await users.completeOnboarding(a.user.id, name);
    expect(await codeOf(users.completeOnboarding(b.user.id, name.toUpperCase()))).toBe("nickname_taken");
    expect((await users.getUser(b.user.id))?.nickname).toBeNull();
  });

  it("К-5 E-1: гонка двух одинаковых ников — один успех, второй nickname_taken", async () => {
    const a = await users.signInWithGoogle(identity(), "en");
    const b = await users.signInWithGoogle(identity(), "en");
    const name = nick("race");
    const codes = await Promise.all([codeOf(users.completeOnboarding(a.user.id, name)), codeOf(users.completeOnboarding(b.user.id, name))]);
    expect(codes.sort()).toEqual(["nickname_taken", "ok"]);
  });

  it("К-7: updateMe — locale, country, частичные settings сливаются с сохранёнными", async () => {
    const { user } = await users.signInWithGoogle(identity(), "en");
    await users.completeOnboarding(user.id, nick());
    await users.updateMe(user.id, { settings: { sound: false } });
    const row = await users.updateMe(user.id, { locale: "ru", country: "RU", settings: { board_theme: "green" } });
    expect(row).toMatchObject({ locale: "ru", country: "RU" });
    expect(users.toMe(row).settings).toEqual({ ...DEFAULT_USER_SETTINGS, sound: false, board_theme: "green" });
    const cleared = await users.updateMe(user.id, { country: null });
    expect(cleared.country).toBeNull();
    const same = await users.updateMe(user.id, {});
    expect(same.locale).toBe("ru");
  });
});
