// Помощники тестов web (jsdom): монтирование через react-dom/client + act, фейковый fetch, фабрика Me.
import { DEFAULT_USER_SETTINGS, type Me } from "@chezz/protocol";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";
import { App } from "../app/App.tsx";
import { AppLocale } from "../app/AppLocale.tsx";
import { MeProvider, type MeState } from "../features/auth/MeContext.tsx";
import { RouterProvider } from "../shared/router/Router.tsx";
import { ToastProvider } from "../shared/ui/Toast/Toast.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { root: Root; container: HTMLElement } | null = null;

// Язык браузера по умолчанию — RU (DESIGN §15: navigator.language «ru…» → ru).
beforeEach(() => {
  vi.spyOn(window.navigator, "language", "get").mockReturnValue("ru-RU");
});

function unmount(): void {
  if (!mounted) return;
  const { root, container } = mounted;
  act(() => root.unmount());
  container.remove();
  mounted = null;
}

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

/** Монтирует `node`; прежнее дерево теста размонтируется. */
export async function mount(node: ReactNode): Promise<HTMLElement> {
  unmount();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => {
    root.render(node);
  });
  return container;
}

/** Всё приложение (как main.tsx) на адресе `path`. */
export async function mountApp(path: string, initial?: MeState): Promise<HTMLElement> {
  window.history.replaceState(null, "", path);
  return mount(
    <RouterProvider>
      <MeProvider initial={initial}>
        <AppLocale>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AppLocale>
      </MeProvider>
    </RouterProvider>,
  );
}

export function makeMe(overrides: Partial<Me> = {}): Me {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    nickname: "alice",
    avatar_url: null,
    country: null,
    created_at: "2026-01-01T00:00:00.000Z",
    email: null,
    locale: "ru",
    settings: DEFAULT_USER_SETTINGS,
    terms_accepted_at: "2026-01-01T00:00:00.000Z",
    can_change_nickname: true,
    onboarding_required: false,
    active_game_id: null,
    open_challenge_id: null,
    ...overrides,
  };
}

export function onboardingMe(): Me {
  return makeMe({ nickname: null, terms_accepted_at: null, onboarding_required: true });
}

export interface FetchCall {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

/** Фейковый fetch: `routes["METHOD /path"]` → [status, json]; вызовы — в `calls`. */
export function stubFetch(routes: Record<string, [number, unknown] | (() => [number, unknown])>): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    calls.push({
      url,
      method,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    const route = routes[`${method} ${url}`];
    if (route === undefined) throw new TypeError("network");
    const [status, json] = typeof route === "function" ? route() : route;
    return new Response(json === undefined ? null : JSON.stringify(json), { status });
  });
  return calls;
}

export async function click(el: Element | null): Promise<void> {
  if (!el) throw new Error("нет элемента для клика");
  await act(async () => {
    (el as HTMLElement).click();
    await settle();
  });
}

export async function key(el: Element | null, k: string): Promise<void> {
  if (!el) throw new Error("нет элемента для клавиши");
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    await Promise.resolve();
  });
}

/** Дать отработать цепочкам промисов (fetch → разбор → setState). */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export const flush = (): Promise<void> => act(settle);
