import path from "node:path";
import { expect, test } from "@playwright/test";
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
