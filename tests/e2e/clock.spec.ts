// E06: часы на экране — по серверным значениям (К-11: показ ≤ 0,5 с от `clock` следующего `game.moved`; API §9.4).
import { expect, test } from "@playwright/test";
import { closeFactoryDb, TAG_HTTPS_COOKIE, TAG_LOCAL_DB } from "./support/auth.ts";
import { activeGame, clockMs, expectMoves, openGame, playerInBrowser, typeMove } from "./support/game.ts";

test.afterAll(closeFactoryDb);

interface MovedClock {
  white_ms: number;
  black_ms: number;
  running: "white" | "black" | null;
}

test("К-11, К-5: часы идут у стороны на ходу; после game.moved показ отличается от серверного ≤ 0,5 с", { tag: [TAG_HTTPS_COOKIE, TAG_LOCAL_DB] }, async ({ browser, baseURL }) => {
  const white = await playerInBrowser(browser, baseURL ?? "");
  const black = await playerInBrowser(browser, baseURL ?? "");
  // Остатки ниже 10 с — показ с десятыми (иначе точность показа 1 с). Часы белых пойдут с загрузки комнаты.
  const gameId = await activeGame({
    white_id: white.id,
    black_id: black.id,
    moves: [
      { san: "e4", clock_ms: 9_500 },
      { san: "e5", clock_ms: 9_000 },
    ],
  });
  const moved: { at: number; clock: MovedClock }[] = [];
  black.page.on("websocket", (ws) =>
    ws.on("framereceived", (frame) => {
      const data = typeof frame.payload === "string" ? frame.payload : frame.payload.toString();
      const msg = JSON.parse(data) as { type?: string; clock?: MovedClock };
      if (msg.type === "game.moved" && msg.clock !== undefined) moved.push({ at: Date.now(), clock: msg.clock });
    }),
  );
  try {
    await openGame(white.page, gameId);
    await openGame(black.page, gameId);

    // Часы белых идут: за ~1 с показ уменьшился на ~1 с; часы чёрных стоят.
    const w1 = await clockMs(black.page, "white");
    const b1 = await clockMs(black.page, "black");
    await black.page.waitForTimeout(1_000);
    const w2 = await clockMs(black.page, "white");
    expect(w1 - w2).toBeGreaterThanOrEqual(700);
    expect(w1 - w2).toBeLessThanOrEqual(1_400);
    expect(await clockMs(black.page, "black")).toBe(b1);
    await expect(black.page.locator('[data-side="white"] [data-clock-active]')).toBeVisible();

    await typeMove(white.page, "Nf3");
    await expectMoves(black.page, ["e4", "e5", "Nf3"]);
    await expect.poll(() => moved.length).toBeGreaterThan(0);
    const last = moved[moved.length - 1]!;
    expect(last.clock.running).toBe("black");
    // Сразу после хода: стоящие часы белых — серверные, идущие чёрных — серверные минус прошедшее.
    const shownWhite = await clockMs(black.page, "white");
    const shownBlack = await clockMs(black.page, "black");
    const elapsed = Date.now() - last.at;
    expect(Math.abs(shownWhite - last.clock.white_ms)).toBeLessThanOrEqual(500);
    expect(Math.abs(shownBlack - (last.clock.black_ms - elapsed))).toBeLessThanOrEqual(500);
    await expect(black.page.locator('[data-side="black"] [data-clock-active]')).toBeVisible();
    // Свои часы ниже порога U11 — low-time.
    await expect(black.page.locator("[data-screen]")).toHaveAttribute("data-state", /(^|\s)low-time(\s|$)/);
  } finally {
    await white.context.close();
    await black.context.close();
  }
});

test("К-6: флаг фиксирует сервер без хода клиента — у обоих итог «время вышло»", { tag: [TAG_HTTPS_COOKIE, TAG_LOCAL_DB] }, async ({ browser, baseURL }) => {
  const white = await playerInBrowser(browser, baseURL ?? "");
  const black = await playerInBrowser(browser, baseURL ?? "");
  const gameId = await activeGame({
    white_id: white.id,
    black_id: black.id,
    moves: [
      { san: "e4", clock_ms: 2_000 },
      { san: "e5", clock_ms: 60_000 },
    ],
  });
  try {
    await openGame(white.page, gameId);
    await openGame(black.page, gameId);
    for (const page of [white.page, black.page]) {
      await expect(page.locator("[data-game-result] h2")).toHaveText("Победа чёрных · время вышло", { timeout: 10_000 });
    }
  } finally {
    await white.context.close();
    await black.context.close();
  }
});
