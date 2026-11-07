import { expect, test } from "@playwright/test";
import { openScreen } from "./support/open-screen.ts";

test("AC-44: @smoke главная открывается как lobby в состоянии default", { tag: "@smoke" }, async ({ page }) => {
  const screen = await openScreen(page, "/", "lobby");
  await expect(screen).toHaveAttribute("data-state", /(^|\s)default(\s|$)/);
});
