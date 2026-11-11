// E04: вход без Google — cookie сида и фабрика (TESTING §7.3, §7.6); шапка, меню выхода, первый вход.
import { expect, test, type Page } from "@playwright/test";
import { addSessionCookie, closeFactoryDb, factoryPlayer, seedToken, TAG_HTTPS_COOKIE, TAG_LOCAL_DB } from "./support/auth.ts";
import { openScreen } from "./support/open-screen.ts";

test.use({ locale: "ru-RU" });
test.afterAll(closeFactoryDb);

const accountButton = (page: Page) => page.locator("header").getByRole("button", { name: /^Меню аккаунта/ });

test.describe("гость", () => {
  test("К-9: «Войти через Google» ведёт на /auth/google/start?return_to=<текущий путь>", async ({ page }) => {
    await openScreen(page, "/terms", "legal");
    const login = page.locator("header").getByRole("link", { name: "Войти через Google" });
    await expect(login).toBeVisible();
    await expect(login).toHaveAttribute("href", `/auth/google/start?return_to=${encodeURIComponent("/terms")}`);
    await expect(page.locator("[data-shell-state]")).toHaveAttribute("data-shell-state", "guest");
  });

  test("К-2, К-9: callback без cookie OIDC — login-failed, query убран, повтор без return_to", async ({ page }) => {
    const res = await page.goto("/auth/google/callback?code=x&state=y");
    expect(res?.status()).toBe(400);
    const screen = page.locator('[data-screen="login-failed"]');
    await expect(screen.getByRole("heading", { name: "Не удалось войти" })).toBeFocused();
    await expect(page).toHaveURL(/\/auth\/google\/callback$/);
    await expect(screen.getByRole("link", { name: "Попробовать снова" })).toHaveAttribute("href", "/auth/google/start");
  });
});

test.describe("Игрок", () => {
  test("К-10, К-9: вход cookie сида — Avatar с меню, ник в шапке", { tag: TAG_HTTPS_COOKIE }, async ({ page, context, baseURL }) => {
    await addSessionCookie(context, baseURL ?? "", seedToken("seed_player_01"));
    await openScreen(page, "/", "lobby");
    await expect(page.locator("[data-shell-state]")).toHaveAttribute("data-shell-state", "default");
    await expect(accountButton(page)).toHaveAccessibleName("Меню аккаунта seed_player_01");
    await accountButton(page).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Выйти", "Выйти со всех устройств"]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(accountButton(page)).toBeFocused();
  });

  test("К-6, К-9: «Выйти» — гость на той же странице, Toast; после перезагрузки — гость", { tag: [TAG_HTTPS_COOKIE, TAG_LOCAL_DB] }, async ({ page, context, baseURL }) => {
    const player = await factoryPlayer();
    await addSessionCookie(context, baseURL ?? "", player.token);
    await openScreen(page, "/privacy", "legal");
    await accountButton(page).click();
    await page.getByRole("menuitem", { name: "Выйти", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Вы вышли из аккаунта");
    await expect(page.locator("[data-shell-state]")).toHaveAttribute("data-shell-state", "guest");
    await expect(page).toHaveURL(/\/privacy$/);
    await page.reload();
    await expect(page.locator("header").getByRole("link", { name: "Войти через Google" })).toBeVisible();
  });

  test("К-6: «Выйти со всех устройств» закрывает Session в другом браузере", { tag: [TAG_HTTPS_COOKIE, TAG_LOCAL_DB] }, async ({ page, context, browser, baseURL }) => {
    const player = await factoryPlayer();
    await addSessionCookie(context, baseURL ?? "", player.token);
    const other = await browser.newContext({ baseURL: baseURL ?? "", locale: "ru-RU" });
    await addSessionCookie(other, baseURL ?? "", player.token);
    const otherPage = await other.newPage();
    await openScreen(otherPage, "/", "lobby");
    await expect(accountButton(otherPage)).toBeVisible();

    await openScreen(page, "/", "lobby");
    await accountButton(page).click();
    await page.getByRole("menuitem", { name: "Выйти со всех устройств" }).click();
    await expect(page.getByRole("status")).toHaveText("Вы вышли из аккаунта");

    await otherPage.reload();
    await expect(otherPage.locator("header").getByRole("link", { name: "Войти через Google" })).toBeVisible();
    await other.close();
  });
});

test.describe("первый вход", () => {
  test("К-9, К-5: П1 уводится на /welcome; без галочки «Продолжить» неактивна; занятый ник — ошибка у поля; успех — на return_to", { tag: [TAG_HTTPS_COOKIE, TAG_LOCAL_DB] }, async ({ page, context, baseURL }) => {
    const taken = await factoryPlayer();
    const p1 = await factoryPlayer({ nickname: null });
    await addSessionCookie(context, baseURL ?? "", p1.token);

    await page.goto("/privacy?from=x");
    await expect(page.locator('[data-screen="legal"]')).toBeVisible();
    await openScreen(page, "/no-such?x=1", "welcome");
    await expect(page).toHaveURL(`/welcome?return_to=${encodeURIComponent("/no-such?x=1")}`);

    const field = page.getByLabel("Ник");
    await expect(field).toBeFocused();
    const submit = page.getByRole("button", { name: "Продолжить" });
    await field.fill(taken.nickname ?? "");
    await expect(submit).toBeDisabled();
    await page.getByRole("checkbox", { name: "Принимаю правила и политику конфиденциальности" }).check();
    await expect(page.getByRole("link", { name: "правила", exact: true })).toHaveAttribute("target", "_blank");
    await submit.click();
    await expect(page.getByText("Ник уже занят")).toBeVisible();
    await expect(page.locator('[data-screen="welcome"]')).toHaveAttribute("data-state", "field-error");

    const nickname = `n${p1.user_id.replace(/-/g, "").slice(0, 12)}`;
    await field.fill(nickname);
    await field.press("Enter");
    await expect(page).toHaveURL(/\/no-such\?x=1$/);
    await expect(page.locator('[data-screen="not-found"]')).toBeVisible();
    await expect(accountButton(page)).toHaveAccessibleName(`Меню аккаунта ${nickname}`);

    await page.goto("/welcome");
    await expect(page.locator('[data-screen="lobby"]')).toBeVisible();
  });
});
