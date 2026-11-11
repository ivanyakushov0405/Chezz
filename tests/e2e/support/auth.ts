// Вход в e2e без Google (TESTING §7.3, §7.6; бриф E04 «Решения»): cookie сида или Игрок/П1 из фабрики.
import type { BrowserContext } from "@playwright/test";
import { createPlayer, randomNickname, type CreatePlayerOptions, type CreatedPlayer } from "../../../apps/server/test/support/factories.ts";
import { LOCAL_SEED_SECRET, seedSessionToken } from "../../../apps/server/test/support/seed-token.ts";
import type { Database } from "../../../apps/server/src/database.ts";
import { createDb, type Db } from "../../../apps/server/src/platform/db.ts";
import { E2E_DATABASE_URL } from "./env.ts";

export const SESSION_COOKIE = "__Host-sid";

/** e2e против staging (E2E_BASE_URL): базы нет, только сид. */
export const isExternal = (): boolean => Boolean(process.env["E2E_BASE_URL"]);

/** Кладёт Session в контекст: `__Host-` — Secure, Path=/, без Domain (SECURITY §5). */
export async function addSessionCookie(context: BrowserContext, baseURL: string, token: string): Promise<void> {
  const url = new URL(baseURL);
  await context.addCookies([{ name: SESSION_COOKIE, value: token, domain: url.hostname, path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
}

/** Токен сид-игрока (`seed_player_01…12`); на staging — SEED_TOKEN_SECRET из окружения. */
export function seedToken(nickname: string): string {
  return seedSessionToken(process.env["SEED_TOKEN_SECRET"] || LOCAL_SEED_SECRET, nickname);
}

let db: Db<Database> | null = null;

/**
 * Теги e2e (playwright.config, grepInvert):
 * - `@local-db` — тест пишет в локальную базу через фабрику; против E2E_BASE_URL не запускается;
 * - `@https-cookie` — нужна Secure-cookie `__Host-sid`: WebKit не шлёт её по http, локальный webkit такие тесты не берёт.
 */
export const TAG_LOCAL_DB = "@local-db";
export const TAG_HTTPS_COOKIE = "@https-cookie";

/** Игрок или П1 (`nickname: null`) прямо в базе e2e (тест с тегом `@local-db`). */
export async function factoryPlayer(options: CreatePlayerOptions = {}): Promise<CreatedPlayer & { token: string }> {
  if (isExternal()) throw new Error("factoryPlayer — только локальная база e2e: пометьте тест тегом @local-db");
  db ??= createDb<Database>(E2E_DATABASE_URL);
  const player = await createPlayer(db, { nickname: randomNickname("e2e"), locale: "ru", ...options });
  if (player.token === null) throw new Error("фабрика вернула Игрока без Session");
  return { ...player, token: player.token };
}

export async function closeFactoryDb(): Promise<void> {
  await db?.destroy();
  db = null;
}
