// ConnectionBanner и связка с «кто я» (DESIGN §10.2): состояния клиента WebSocket → баннер, 4001 → Toast.
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { click, makeMe, mountApp, stubFetch, waitFor } from "../../../test/render.tsx";
import { FakeWsClient } from "../../../test/ws.ts";
import { RECONNECTING_BANNER_DELAY_MS } from "./ConnectionBanner.tsx";

const banner = (root: HTMLElement): HTMLElement | null => root.querySelector("[data-tone][role='status']:not([class*='toast'])");

describe("ConnectionBanner", () => {
  it("К-10: reconnecting — баннер «Переподключение…» не раньше чем через 1 с, после welcome исчезает", async () => {
    const ws = new FakeWsClient();
    const root = await mountApp("/", { status: "guest" }, ws);
    vi.useFakeTimers();
    try {
      await ws.setStatus("reconnecting");
      await act(async () => void vi.advanceTimersByTime(RECONNECTING_BANNER_DELAY_MS - 1));
      expect(banner(root)).toBeNull();
      await act(async () => void vi.advanceTimersByTime(1));
      expect(banner(root)?.textContent).toBe("Переподключение…");
      await ws.setStatus("open");
      expect(banner(root)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("К-10: offline — «Нет сети»", async () => {
    const ws = new FakeWsClient();
    const root = await mountApp("/", { status: "guest" }, ws);
    await ws.setStatus("offline");
    expect(banner(root)?.textContent).toBe("Нет сети");
  });

  it("К-10: outdated — «Версия устарела» с кнопкой обновления", async () => {
    const ws = new FakeWsClient();
    const root = await mountApp("/", { status: "guest" }, ws);
    await ws.setStatus("outdated");
    expect(banner(root)?.textContent).toContain("Версия устарела, обновите страницу");
    expect(banner(root)?.querySelector("button")?.textContent).toBe("Обновить страницу");
  });

  it("К-10: too-many-tabs — error.too_many_connections и «Подключиться снова» зовёт reconnect", async () => {
    const ws = new FakeWsClient();
    const root = await mountApp("/", { status: "guest" }, ws);
    await ws.setStatus("too-many-tabs");
    expect(banner(root)?.textContent).toContain("Слишком много открытых соединений");
    await click(banner(root)?.querySelector("button") ?? null);
    expect(ws.reconnects).toBe(1);
  });

  it("К-10: 4001 — Toast «Вы вышли из аккаунта», /api/me перечитан, лишнего переподключения нет", async () => {
    const calls = stubFetch({ "GET /api/me": [200, { user: null }] });
    const ws = new FakeWsClient();
    const root = await mountApp("/", { status: "ready", me: makeMe() }, ws);
    await ws.sessionClosed();
    await waitFor(() => expect(root.querySelector("[data-shell-state]")?.getAttribute("data-shell-state")).toBe("guest"));
    expect(calls.map((c) => c.url)).toEqual(["/api/me"]);
    expect(document.body.textContent).toContain("Вы вышли из аккаунта");
    expect(ws.reconnects).toBe(0);
  });

  it("К-10: вход или выход в этой вкладке — переподключение с новой Session", async () => {
    stubFetch({ "POST /api/auth/logout": [204, undefined] });
    const ws = new FakeWsClient();
    const root = await mountApp("/", { status: "ready", me: makeMe() }, ws);
    await click(root.querySelector("[aria-haspopup]"));
    await click([...root.querySelectorAll("[role='menuitem']")].find((el) => el.textContent === "Выйти") ?? null);
    await waitFor(() => expect(ws.reconnects).toBe(1));
  });
});
