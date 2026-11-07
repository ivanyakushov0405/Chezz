import { expect, test, type Page } from "@playwright/test";
import { openScreen } from "./support/open-screen.ts";
import { LOBBY_STRINGS, LOCALE_STORAGE_KEY, TRANSLATION_KEY_RE, visibleLines, type Lang } from "./support/strings.ts";

async function htmlLang(page: Page): Promise<string> {
  return page.evaluate(() => document.documentElement.lang);
}

test.describe("главная, RU по умолчанию", () => {
  test.use({ locale: "ru-RU" });

  test("AC-35, EC-29: один lobby, data-state ровно default, состав заглушки", async ({ page }) => {
    const screen = await openScreen(page, "/", "lobby");
    await expect(page.locator("[data-screen]")).toHaveCount(1);
    await expect(page.locator('[data-screen="lobby"]')).toHaveCount(1);
    expect(await screen.getAttribute("data-state")).toBe("default");

    const link = screen.getByRole("link", { name: "Chezz" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/");
    await expect(screen.getByText(LOBBY_STRINGS.ru.beta, { exact: true })).toBeVisible();
    await expect(screen.getByText(LOBBY_STRINGS.ru.comingSoon, { exact: true })).toBeVisible();

    await expect(page.getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("link")).toHaveCount(1);
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.getByRole("list")).toHaveCount(0);

    const lines = visibleLines(await screen.innerText());
    expect(lines).toEqual([LOBBY_STRINGS.ru.name, LOBBY_STRINGS.ru.beta, LOBBY_STRINGS.ru.comingSoon]);
  });

  test("AC-35: title Chezz и favicon /favicon.svg", async ({ page }) => {
    await openScreen(page, "/", "lobby");
    await expect(page).toHaveTitle("Chezz");
    const icon = page.locator('link[rel="icon"]');
    await expect(icon).toHaveAttribute("href", "/favicon.svg");
    await expect(icon).toHaveAttribute("type", "image/svg+xml");
    const res = await page.request.get("/favicon.svg");
    expect(res.status()).toBe(200);
  });

  test("AC-36: ru-RU → html lang=ru", async ({ page }) => {
    await openScreen(page, "/", "lobby");
    expect(await htmlLang(page)).toBe("ru");
  });

  test("AC-37, EC-22: нет горизонтальной прокрутки, нет текста вида ключа", async ({ page }) => {
    const screen = await openScreen(page, "/", "lobby");
    const width = page.viewportSize()?.width ?? 0;
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
    for (const line of visibleLines(await screen.innerText())) {
      expect(line).not.toMatch(TRANSLATION_KEY_RE);
    }
  });

  test("AC-38, EC-28: все запросы страницы на свой origin", async ({ page, baseURL }) => {
    const origin = new URL(baseURL ?? "").origin;
    const foreign: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (url.startsWith("data:") || url.startsWith("blob:") || url === "about:blank") return;
      if (new URL(url).origin !== origin) foreign.push(url);
    });
    await openScreen(page, "/", "lobby");
    await page.waitForLoadState("networkidle");
    expect(foreign).toEqual([]);
  });

  test("AC-39: ссылка Logo достижима по Tab, фокус виден (--focus-width, --color-focus)", async ({ page, browserName }) => {
    const screen = await openScreen(page, "/", "lobby");
    const link = screen.getByRole("link", { name: "Chezz" });
    if (browserName === "webkit") {
      // WebKit/Safari не фокусирует ссылки по Tab (tabsToLinks), Option+Tab в Playwright WebKit на Windows не воспроизводится.
      test.info().annotations.push({ type: "note", description: "webkit: tabsToLinks / Option+Tab; достижимость по Tab не проверяется, только стиль фокуса" });
      await page.keyboard.press("Shift");
      await link.focus();
    } else {
      await page.keyboard.press("Tab");
    }
    await expect(link).toBeFocused();
    const outline = await link.evaluate((el) => {
      const cs = getComputedStyle(el);
      const root = getComputedStyle(document.documentElement);
      const probe = document.createElement("span");
      probe.style.color = "var(--color-focus)";
      document.body.append(probe);
      const focusColor = getComputedStyle(probe).color;
      probe.remove();
      return {
        style: cs.outlineStyle,
        width: cs.outlineWidth,
        color: cs.outlineColor,
        focusColor,
        focusWidth: root.getPropertyValue("--focus-width").trim(),
      };
    });
    expect(outline.style).toBe("solid");
    expect(outline.focusWidth).toBe("2px");
    expect(outline.width).toBe("2px");
    expect(outline.color).toBe(outline.focusColor);
  });
});

test.describe("тема гостя", () => {
  test("AC-37, EC-21: тёмная тема системы — нет data-theme, цвета меняются", async ({ browser, baseURL }) => {
    const colors: Record<string, string> = {};
    for (const scheme of ["light", "dark"] as const) {
      const context = await browser.newContext({ baseURL: baseURL ?? "", colorScheme: scheme });
      const page = await context.newPage();
      await openScreen(page, "/", "lobby");
      expect(await page.evaluate(() => document.documentElement.hasAttribute("data-theme"))).toBe(false);
      colors[scheme] = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      await context.close();
    }
    expect(colors["dark"]).not.toBe(colors["light"]);
  });
});

test.describe("EC-20: выбор языка", () => {
  const cases: { name: string; locale: string; stored?: string; expected: Lang }[] = [
    { name: "ru-UA → ru", locale: "ru-UA", expected: "ru" },
    { name: "de-DE → en", locale: "de-DE", expected: "en" },
    { name: "en-US → en", locale: "en-US", expected: "en" },
    { name: "localStorage en при браузере ru-RU → en", locale: "ru-RU", stored: "en", expected: "en" },
    { name: "localStorage ru при браузере en-US → ru", locale: "en-US", stored: "ru", expected: "ru" },
    { name: "мусор fr в localStorage игнорируется (ru-RU → ru)", locale: "ru-RU", stored: "fr", expected: "ru" },
    { name: "мусор fr в localStorage игнорируется (en-US → en)", locale: "en-US", stored: "fr", expected: "en" },
  ];

  for (const c of cases) {
    test(`AC-36, EC-20: ${c.name}; строки и html lang`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({ baseURL: baseURL ?? "", locale: c.locale });
      if (c.stored !== undefined) {
        await context.addInitScript(
          ([key, value]) => {
            localStorage.setItem(key as string, value as string);
          },
          [LOCALE_STORAGE_KEY, c.stored],
        );
      }
      const page = await context.newPage();
      const screen = await openScreen(page, "/", "lobby");
      expect(await htmlLang(page)).toBe(c.expected);
      await expect(screen.getByText(LOBBY_STRINGS[c.expected].beta, { exact: true })).toBeVisible();
      await expect(screen.getByText(LOBBY_STRINGS[c.expected].comingSoon, { exact: true })).toBeVisible();
      await context.close();
    });
  }
});
