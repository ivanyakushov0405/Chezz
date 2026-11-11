import path from "node:path";
import { expect, test } from "@playwright/test";
import { addSessionCookie, closeFactoryDb, factoryPlayer, TAG_HTTPS_COOKIE, TAG_LOCAL_DB } from "./support/auth.ts";
import { activeGame, finishedGame } from "./support/game.ts";
import { openScreen } from "./support/open-screen.ts";
import { LOBBY_STRINGS, TRANSLATION_KEY_RE, visibleLines, type Lang } from "./support/strings.ts";

const LOCALES: { lang: Lang; locale: string }[] = [
  { lang: "ru", locale: "ru-RU" },
  { lang: "en", locale: "en-US" },
];

for (const { lang, locale } of LOCALES) {
  test.describe(`экраны, ${lang}`, () => {
    test.use({ locale });

    test(`AC-45: lobby / default / ${lang}`, async ({ page }, testInfo) => {
      const screen = await openScreen(page, "/", "lobby");
      await expect(screen).toHaveAttribute("data-state", /(^|\s)default(\s|$)/);
      expect(await page.evaluate(() => document.documentElement.lang)).toBe(lang);
      await expect(screen.getByText(LOBBY_STRINGS[lang].comingSoon, { exact: true })).toBeVisible();

      const bodyText = await page.locator("body").innerText();
      for (const line of visibleLines(bodyText)) {
        expect(line).not.toMatch(TRANSLATION_KEY_RE);
      }

      expect(await page.context().cookies()).toEqual([]);
      await page.screenshot({
        path: path.join(import.meta.dirname, "screens", `lobby-default-${lang}-${testInfo.project.name}.png`),
      });
    });
  });
}

// E04: новые экраны (DESIGN §16.2, §17): shell Игрока, welcome (П1), legal, login-failed, not-found.
const E04_SCREENS: { name: string; path: string; id: string; as?: "player" | "p1" }[] = [
  { name: "shell-default", path: "/", id: "lobby", as: "player" },
  { name: "welcome-default", path: "/welcome", id: "welcome", as: "p1" },
  { name: "legal-default", path: "/terms", id: "legal" },
  { name: "login-failed-default", path: "/auth/google/callback", id: "login-failed" },
  { name: "not-found-default", path: "/no-such-page", id: "not-found" },
];

for (const { lang, locale } of LOCALES) {
  test.describe(`экраны E04, ${lang}`, () => {
    test.use({ locale });
    test.afterAll(closeFactoryDb);

    for (const s of E04_SCREENS) {
      const tag = s.as !== undefined ? [TAG_HTTPS_COOKIE, TAG_LOCAL_DB] : [];
      test(`К-9: ${s.name} / ${lang}`, { tag }, async ({ page, context, baseURL }, testInfo) => {
        if (s.as !== undefined) {
          const player = await factoryPlayer({ locale: lang, ...(s.as === "p1" ? { nickname: null } : {}) });
          await addSessionCookie(context, baseURL ?? "", player.token);
        }
        const screen = await openScreen(page, s.path, s.id);
        await expect(screen).toHaveAttribute("data-state", /(^|\s)default(\s|$)/);
        expect(await page.evaluate(() => document.documentElement.lang)).toBe(lang);
        for (const line of visibleLines(await page.locator("body").innerText())) {
          expect(line).not.toMatch(TRANSLATION_KEY_RE);
        }
        await page.screenshot({
          path: path.join(import.meta.dirname, "screens", `${s.name}-${lang}-${testInfo.project.name}.png`),
        });
      });
    }
  });
}

// E06: game-live default и ended (DESIGN §16.2; Figma 9:209, 9:391, 9:581, 9:1150, 9:1333).
for (const { lang, locale } of LOCALES) {
  test.describe(`экраны E06, ${lang}`, () => {
    test.use({ locale });
    test.afterAll(closeFactoryDb);

    for (const kind of ["default", "ended"] as const) {
      test(`К-9: game-live-${kind} / ${lang}`, { tag: [TAG_HTTPS_COOKIE, TAG_LOCAL_DB] }, async ({ page, context, baseURL }, testInfo) => {
        const me = await factoryPlayer({ locale: lang });
        const opponent = await factoryPlayer({ locale: lang });
        await addSessionCookie(context, baseURL ?? "", me.token);
        const moves = ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", ...(kind === "ended" ? ["Qxf7#"] : [])].map((san, i) => ({ san, clock_ms: 170_000 - i * 1_000 }));
        const options = { white_id: me.user_id, black_id: opponent.user_id, moves };
        const gameId = kind === "ended" ? await finishedGame({ ...options, result: "white_wins", termination: "checkmate" }) : await activeGame(options);
        const screen = await openScreen(page, `/game/${gameId}`, "game-live");
        await expect(screen).toHaveAttribute("data-state", kind === "ended" ? /(^|\s)ended(\s|$)/ : /(^|\s)default(\s|$)/);
        for (const line of visibleLines(await page.locator("body").innerText())) {
          expect(line).not.toMatch(TRANSLATION_KEY_RE);
        }
        await page.screenshot({
          path: path.join(import.meta.dirname, "screens", `game-live-${kind}-${lang}-${testInfo.project.name}.png`),
        });
      });
    }
  });
}
