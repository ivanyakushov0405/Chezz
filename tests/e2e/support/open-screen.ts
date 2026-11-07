import { expect, type Locator, type Page } from "@playwright/test";

/** DESIGN §17: ждёт экран, проверяет непустой data-state и отсутствие горизонтальной прокрутки. */
export async function openScreen(page: Page, path: string, id: string): Promise<Locator> {
  await page.goto(path);
  const screen = page.locator(`[data-screen="${id}"]`);
  await expect(screen).toBeVisible();
  await expect(screen).toHaveAttribute("data-state", /\S/);
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  return screen;
}
