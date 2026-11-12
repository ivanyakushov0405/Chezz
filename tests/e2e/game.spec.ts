// E06: партия от первого хода до мата в двух браузерах, зритель (К-11; DESIGN §9.3).
import { expect, test } from "@playwright/test";
import { closeFactoryDb, TAG_HTTPS_COOKIE, TAG_LOCAL_DB } from "./support/auth.ts";
import { activeGame, clickSquare, expectMoves, openGame, playerInBrowser, squareShade, typeMove } from "./support/game.ts";

test.afterAll(closeFactoryDb);

const SCHOLAR = ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"];

test("К-11, К-9: двое доводят партию до мата — у обоих GameResultPanel, зритель видит те же ходы", { tag: [TAG_HTTPS_COOKIE, TAG_LOCAL_DB] }, async ({ browser, baseURL }) => {
  const white = await playerInBrowser(browser, baseURL ?? "");
  const black = await playerInBrowser(browser, baseURL ?? "");
  const gameId = await activeGame({ white_id: white.id, black_id: black.id, rated: true });
  const spectatorContext = await browser.newContext({ locale: "ru-RU" });
  const spectator = await spectatorContext.newPage();
  try {
    await openGame(white.page, gameId);
    await openGame(black.page, gameId);
    const watch = await openGame(spectator, gameId);
    await expect(watch).toHaveAttribute("data-screen", "game-spectator");
    await expect(spectator.getByText("Вы зритель", { exact: true })).toBeVisible();
    await expect(spectator.locator("[data-move-input]")).toHaveCount(0);

    // Первый ход белых — кликом по доске (клик-клик), остальные — с клавиатуры.
    await clickSquare(white.page, "e2");
    await clickSquare(white.page, "e4");
    await expectMoves(black.page, ["e4"]);
    for (const [i, san] of SCHOLAR.entries()) {
      if (i === 0) continue;
      const mover = i % 2 === 0 ? white : black;
      await typeMove(mover.page, san);
      await expectMoves(mover.page, SCHOLAR.slice(0, i + 1));
    }

    for (const page of [white.page, black.page, spectator]) {
      const panel = page.locator("[data-game-result]");
      await expect(panel).toBeVisible();
      await expect(panel.locator("h2")).toHaveText("Победа белых · мат");
      await expect(page.locator("[data-screen]")).toHaveAttribute("data-state", /(^|\s)ended(\s|$)/);
      await expectMoves(page, SCHOLAR);
    }
    // Рейтинговая: изменение рейтинга у обоих, «Новая игра» → главная.
    await expect(white.page.locator("[data-rating-side='white']")).toContainText("+");
    await expect(white.page.locator("[data-rating-side='black']")).toContainText("−");
    await white.page.getByRole("link", { name: "Новая игра" }).click();
    await expect(white.page).toHaveURL(/\/$/);
  } finally {
    await white.context.close();
    await black.context.close();
    await spectatorContext.close();
  }
});

test("К-9: недопустимый ход и ход не в свою очередь — ошибка под полем, ход не отправлен", { tag: [TAG_HTTPS_COOKIE, TAG_LOCAL_DB] }, async ({ browser, baseURL }) => {
  const white = await playerInBrowser(browser, baseURL ?? "");
  const black = await playerInBrowser(browser, baseURL ?? "");
  const gameId = await activeGame({ white_id: white.id, black_id: black.id });
  try {
    await openGame(white.page, gameId);
    await openGame(black.page, gameId);
    await typeMove(white.page, "Ke2");
    await expect(white.page.getByText("Нет такого хода")).toBeVisible();
    await typeMove(black.page, "e5");
    await expect(black.page.getByText("Нет такого хода")).toBeVisible();
    await expectMoves(white.page, []);
  } finally {
    await white.context.close();
    await black.context.close();
  }
});

test("К-9, К-3: ←/→ листают ходы, «К текущему» возвращает; перезагрузка — тот же снимок с сервера", { tag: [TAG_HTTPS_COOKIE, TAG_LOCAL_DB] }, async ({ browser, baseURL }) => {
  const white = await playerInBrowser(browser, baseURL ?? "");
  const black = await playerInBrowser(browser, baseURL ?? "");
  const sans = ["e4", "e5", "Nf3", "Nc6"];
  const gameId = await activeGame({ white_id: white.id, black_id: black.id, moves: sans.map((san) => ({ san, clock_ms: 180_000 })) });
  try {
    const page = white.page;
    await openGame(page, gameId);
    await expectMoves(page, sans);
    await page.locator("body").press("ArrowLeft");
    await page.locator("body").press("ArrowLeft");
    await expect(page.locator("[data-move-list] [aria-current='true']")).toHaveText("e5");
    await page.locator("[data-to-current]").click();
    await expect(page.locator("[data-move-list] [aria-current='true']")).toHaveText("Nc6");
    await page.reload();
    await openGame(page, gameId);
    await expectMoves(page, sans);
  } finally {
    await white.context.close();
    await black.context.close();
  }
});

test("К-9: a1 тёмная, h1 светлая при любой ориентации (DESIGN §6)", { tag: [TAG_HTTPS_COOKIE, TAG_LOCAL_DB] }, async ({ browser, baseURL }) => {
  const white = await playerInBrowser(browser, baseURL ?? "");
  const black = await playerInBrowser(browser, baseURL ?? "");
  const gameId = await activeGame({ white_id: white.id, black_id: black.id });
  try {
    for (const [page, orientation] of [
      [white.page, "orientation-white"],
      [black.page, "orientation-black"],
    ] as const) {
      await openGame(page, gameId);
      await expect(page.locator(".cg-wrap")).toHaveClass(new RegExp(orientation));
      expect(await squareShade(page, "a1")).toBe("dark");
      expect(await squareShade(page, "h1")).toBe("light");
      expect(await squareShade(page, "a8")).toBe("light");
      expect(await squareShade(page, "h8")).toBe("dark");
    }
  } finally {
    await white.context.close();
    await black.context.close();
  }
});
