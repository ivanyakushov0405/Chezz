import { describe, expect, it } from "vitest";
import { LOCALE_STORAGE_KEY } from "../shared/i18n/locale.ts";
import { TOAST_MS } from "../shared/ui/Toast/Toast.tsx";
import { click, makeMe, mountApp, onboardingMe, stubFetch, waitFor } from "../test/render.tsx";

const $ = (root: HTMLElement, sel: string): HTMLElement | null => root.querySelector(sel);

describe("App: shell и маршруты", () => {
  it("К-9: гость — «Войти через Google» ведёт на /auth/google/start?return_to=<текущий путь>", async () => {
    stubFetch({ "GET /api/me": [200, { user: null }] });
    const root = await mountApp("/?x=1");
    const login = $(root, 'a[href^="/auth/google/start"]');
    expect(login?.textContent).toBe("Войти через Google");
    expect(login?.getAttribute("href")).toBe(`/auth/google/start?return_to=${encodeURIComponent("/?x=1")}`);
    expect($(root, "[data-shell-state]")?.dataset["shellState"]).toBe("guest");
    expect($(root, '[data-screen="lobby"]')).not.toBeNull();
  });

  it("К-9: GET /api/me с X-Protocol-Version", async () => {
    const calls = stubFetch({ "GET /api/me": [200, { user: null }] });
    await mountApp("/");
    expect(calls[0]?.url).toBe("/api/me");
    expect(calls[0]?.headers["X-Protocol-Version"]).toBeDefined();
  });

  it("К-9: /api/me не ответил — шапка гостя и Toast error.network", async () => {
    stubFetch({});
    const root = await mountApp("/");
    expect($(root, "[data-shell-state]")?.dataset["shellState"]).toBe("guest error");
    expect($(root, '[role="status"]')?.textContent).toBe("Нет связи с сервером");
  });

  it("К-9: П1 с любой страницы уводится на /welcome?return_to=…", async () => {
    stubFetch({});
    await mountApp("/players/bob?tab=games", { status: "ready", me: onboardingMe() });
    expect(window.location.pathname).toBe("/welcome");
    expect(new URLSearchParams(window.location.search).get("return_to")).toBe("/players/bob?tab=games");
  });

  it("К-9: П1 на /terms и /privacy остаётся", async () => {
    stubFetch({});
    for (const path of ["/terms", "/privacy"]) {
      await mountApp(path, { status: "ready", me: onboardingMe() });
      expect(window.location.pathname).toBe(path);
    }
  });

  it("К-9: Игрок видит Avatar с меню; «Выйти» → гость и Toast", async () => {
    const calls = stubFetch({ "POST /api/auth/logout": [204, undefined] });
    const root = await mountApp("/", { status: "ready", me: makeMe() });
    const trigger = $(root, 'button[aria-haspopup="menu"]');
    expect(trigger?.getAttribute("aria-label")).toBe("Меню аккаунта alice");
    expect($(root, "[data-placeholder]")).not.toBeNull();
    await click(trigger);
    const items = root.querySelectorAll('[role="menuitem"]');
    expect([...items].map((i) => i.textContent)).toEqual(["Выйти", "Выйти со всех устройств"]);
    await click(items[0] ?? null);
    await waitFor(() => {
      expect($(root, '[role="status"]')?.textContent).toBe("Вы вышли из аккаунта");
    });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /api/auth/logout"]);
    expect($(root, "[data-shell-state]")?.dataset["shellState"]).toBe("guest");
    expect($(root, '[role="status"]')?.textContent).toBe("Вы вышли из аккаунта");
    expect(TOAST_MS).toBe(5_000);
  });

  it("К-6, К-9: «Выйти» при уже закрытой Session (401) — тоже гость и Toast", async () => {
    stubFetch({ "POST /api/auth/logout": [401, { error: { code: "unauthenticated", message: "x", details: null, request_id: "00000000-0000-4000-8000-000000000009" } }] });
    const root = await mountApp("/", { status: "ready", me: makeMe() });
    await click($(root, 'button[aria-haspopup="menu"]'));
    await click(root.querySelectorAll('[role="menuitem"]')[0] ?? null);
    await waitFor(() => {
      expect($(root, "[data-shell-state]")?.dataset["shellState"]).toBe("guest");
    });
    expect($(root, '[role="status"]')?.textContent).toBe("Вы вышли из аккаунта");
  });

  it("К-6, К-9: «Выйти» — сеть недоступна: Toast ошибки, остаётся вошедшим", async () => {
    stubFetch({});
    const root = await mountApp("/", { status: "ready", me: makeMe() });
    await click($(root, 'button[aria-haspopup="menu"]'));
    await click(root.querySelectorAll('[role="menuitem"]')[0] ?? null);
    await waitFor(() => {
      expect($(root, '[role="status"]')?.textContent).toBe("Нет связи с сервером");
    });
    expect($(root, "[data-shell-state]")?.dataset["shellState"]).toBe("default");
  });

  it("К-9: неизвестный путь — not-found", async () => {
    stubFetch({ "GET /api/me": [200, { user: null }] });
    const root = await mountApp("/no/such/page");
    expect($(root, '[data-screen="not-found"]')?.textContent).toContain("Страница не найдена");
  });

  it("К-9: гость меняет язык — localStorage, строки EN", async () => {
    stubFetch({ "GET /api/me": [200, { user: null }] });
    const root = await mountApp("/");
    const en = [...root.querySelectorAll("button[aria-pressed]")].find((b) => b.textContent === "EN") ?? null;
    await click(en);
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect($(root, 'a[href^="/auth/google/start"]')?.textContent).toBe("Sign in with Google");
  });

  it("К-9: Игрок меняет язык — PATCH /api/me {locale}", async () => {
    const calls = stubFetch({ "PATCH /api/me": [200, { user: makeMe({ locale: "en" }) }] });
    const root = await mountApp("/", { status: "ready", me: makeMe() });
    const en = [...root.querySelectorAll("button[aria-pressed]")].find((b) => b.textContent === "EN") ?? null;
    await click(en);
    expect(calls[0]).toMatchObject({ method: "PATCH", url: "/api/me", body: { locale: "en" } });
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
    expect($(root, "footer a")?.textContent).toBe("Terms");
  });

  it("К-9: ссылка подвала — переход без перезагрузки", async () => {
    stubFetch({ "GET /api/me": [200, { user: null }] });
    const root = await mountApp("/");
    await click($(root, 'footer a[href="/terms"]'));
    expect(window.location.pathname).toBe("/terms");
  });
});
