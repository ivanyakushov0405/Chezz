// Партия в e2e (бриф E06): `active` Game фабрикой, вход двух игроков, ход с клавиатуры и кликом по доске.
import { expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { createActiveGame, createFinishedGame, type CreateGameRowOptions } from "../../../apps/server/test/support/factories.ts";
import { addSessionCookie, factoryDb, factoryPlayer } from "./auth.ts";

export interface E2EPlayer {
  id: string;
  nickname: string;
  context: BrowserContext;
  page: Page;
}

/** Игрок в своём контексте браузера (отдельная Session). */
export async function playerInBrowser(browser: Browser, baseURL: string, locale = "ru"): Promise<E2EPlayer> {
  const player = await factoryPlayer({ locale: locale as "ru" | "en" });
  const context = await browser.newContext({ locale: locale === "en" ? "en-US" : "ru-RU" });
  await addSessionCookie(context, baseURL, player.token);
  return { id: player.user_id, nickname: player.nickname ?? "", context, page: await context.newPage() };
}

export async function activeGame(options: CreateGameRowOptions): Promise<string> {
  return (await createActiveGame(factoryDb(), options)).game_id;
}

export async function finishedGame(options: Parameters<typeof createFinishedGame>[1]): Promise<string> {
  return (await createFinishedGame(factoryDb(), options)).game_id;
}

export function gameScreen(page: Page): Locator {
  return page.locator('[data-screen="game-live"], [data-screen="game-spectator"]');
}

/** Открыть партию и дождаться снимка (не loading). */
export async function openGame(page: Page, gameId: string): Promise<Locator> {
  await page.goto(`/game/${gameId}`);
  const screen = gameScreen(page);
  await expect(screen).toBeVisible();
  await expect(screen).not.toHaveAttribute("data-state", /loading/);
  return screen;
}

/** Ход в поле «Ход» (U19); на `s` поле открывается кнопкой «⌨ Ход» (U30). */
export async function typeMove(page: Page, move: string): Promise<void> {
  const input = page.locator("[data-move-input]");
  if (!(await input.isVisible())) await page.getByRole("button", { name: /⌨/ }).click();
  await input.fill(move);
  await input.press("Enter");
}

/** Клик по полю доски с учётом ориентации (chessground: клик-клик тоже ход). */
export async function clickSquare(page: Page, square: string): Promise<void> {
  const board = page.locator(".cg-wrap");
  const box = await board.boundingBox();
  if (box === null) throw new Error("доска не видна");
  const black = await board.evaluate((el) => el.classList.contains("orientation-black"));
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const col = black ? 7 - file : file;
  const row = black ? rank : 7 - rank;
  const size = box.width / 8;
  await page.mouse.click(box.x + (col + 0.5) * size, box.y + (row + 0.5) * size);
}

/** Число ходов в MoveList. */
export async function expectMoves(page: Page, sans: string[]): Promise<void> {
  await expect(page.locator("[data-move-list] [data-ply]")).toHaveText(sans);
}

/** Показанное значение часов стороны, мс (`m:ss`, `0:08.4`). */
export async function clockMs(page: Page, side: "white" | "black"): Promise<number> {
  const text = (await page.locator(`[data-side="${side}"] [role="timer"]`).innerText()).trim();
  const m = /^(?:(\d+):)?(\d+):(\d{2})(?:\.(\d))?$/u.exec(text);
  if (m === null) throw new Error(`часы: «${text}»`);
  const [, h, min, sec, tenth] = m;
  return ((Number(h ?? 0) * 60 + Number(min)) * 60 + Number(sec)) * 1000 + Number(tenth ?? 0) * 100;
}
