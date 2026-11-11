import { describe, expect, it } from "vitest";
import { mountApp, stubFetch } from "../../test/render.tsx";

describe("legal и login-failed", () => {
  it("К-9: /terms и /privacy — заголовок, заглушка, document.title", async () => {
    stubFetch({ "GET /api/me": [200, { user: null }] });
    const terms = await mountApp("/terms");
    expect(terms.querySelector('[data-screen="legal"] h1')?.textContent).toBe("Правила платформы");
    expect(terms.textContent).toContain("Текст готовится и будет опубликован до открытой беты.");
    expect(document.title).toBe("Правила платформы — Chezz");
    const privacy = await mountApp("/privacy");
    expect(privacy.querySelector('[data-screen="legal"] h1')?.textContent).toBe("Политика конфиденциальности");
  });

  it("К-2, К-9: login-failed на адресе callback — query убран, фокус на h1, повтор без return_to", async () => {
    stubFetch({ "GET /api/me": [200, { user: null }] });
    const root = await mountApp("/auth/google/callback?code=secret&state=s");
    const h1 = root.querySelector<HTMLElement>('[data-screen="login-failed"] h1');
    expect(h1?.textContent).toBe("Не удалось войти");
    expect(document.activeElement).toBe(h1);
    expect(window.location.search).toBe("");
    expect(root.querySelector('[data-screen="login-failed"] a')?.getAttribute("href")).toBe("/auth/google/start");
    expect(root.querySelector("header a[href^='/auth/google/start']")?.getAttribute("href")).toBe("/auth/google/start");
    expect(root.textContent).not.toContain("secret");
  });
});
