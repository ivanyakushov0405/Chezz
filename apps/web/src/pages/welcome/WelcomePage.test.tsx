import { act } from "react";
import { describe, expect, it } from "vitest";
import { LOCALE_STORAGE_KEY } from "../../shared/i18n/locale.ts";
import { click, makeMe, mountApp, onboardingMe, stubFetch, waitFor } from "../../test/render.tsx";
import { nicknameError } from "./WelcomePage.tsx";

const P1 = { status: "ready", me: onboardingMe() } as const;
const REQUEST_ID = "00000000-0000-4000-8000-000000000009";
const apiError = (code: string): { error: { code: string; message: string; details: null; request_id: string } } => ({
  error: { code, message: code, details: null, request_id: REQUEST_ID },
});

function parts(root: HTMLElement) {
  const input = root.querySelector<HTMLInputElement>('input[name="nickname"]');
  const box = root.querySelector<HTMLInputElement>('input[type="checkbox"]');
  const submit = root.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!input || !box || !submit) throw new Error("форма welcome не найдена");
  return { input, box, submit, screen: root.querySelector<HTMLElement>('[data-screen="welcome"]') };
}

/** Ввод в управляемый input React: сеттер прототипа + событие input. */
async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("nicknameError", () => {
  it("К-5, К-9: формат и зарезервированные ники — как на сервере", () => {
    expect(nicknameError("ab")).toBe("error.nickname_invalid");
    expect(nicknameError("a".repeat(21))).toBe("error.nickname_invalid");
    expect(nicknameError("кириллица")).toBe("error.nickname_invalid");
    expect(nicknameError("admin")).toBe("error.nickname_reserved");
    expect(nicknameError("knight_rider-1")).toBeUndefined();
  });
});

describe("WelcomePage", () => {
  it("К-9: default: фокус на поле, подсказка в aria-describedby, «Продолжить» неактивна без галочки", async () => {
    stubFetch({});
    const root = await mountApp("/welcome", P1);
    const { input, box, submit, screen } = parts(root);
    expect(screen?.dataset["state"]).toBe("default");
    expect(document.activeElement).toBe(input);
    const hintId = input.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(hintId)?.textContent).toBe("3–20 символов: латиница, цифры, _ и -");
    expect(submit.disabled).toBe(true);
    await click(box);
    expect(submit.disabled).toBe(false);
    expect(root.querySelector('a[href="/terms"]')?.getAttribute("target")).toBe("_blank");
    expect(root.querySelector('a[href="/privacy"]')?.getAttribute("rel")).toBe("noopener");
    expect(box.labels?.[0]?.textContent).toBe("Принимаю правила и политику конфиденциальности");
  });

  it("К-9: неверный формат — field-error без запроса; подсказка остаётся; ввод сбрасывает ошибку", async () => {
    const calls = stubFetch({});
    const root = await mountApp("/welcome", P1);
    const { input, box, submit } = parts(root);
    await type(input, "ab");
    await click(box);
    await click(submit);
    expect(calls).toHaveLength(0);
    expect(parts(root).screen?.dataset["state"]).toBe("field-error");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const described = (input.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(["Недопустимый ник", "3–20 символов: латиница, цифры, _ и -"]);
    await type(input, "abc");
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("К-9: nickname_taken от сервера — ошибка у поля, данные и галочка сохранены", async () => {
    stubFetch({ "POST /api/me/onboarding": [409, apiError("nickname_taken")] });
    const root = await mountApp("/welcome", P1);
    const { input, box, submit } = parts(root);
    await type(input, "alice");
    await click(box);
    await click(submit);
    await waitFor(() => {
      expect(root.textContent).toContain("Ник уже занят");
    });
    expect(input.value).toBe("alice");
    expect(box.checked).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it("К-9: уход с поля не стирает ошибку сервера; неверный формат при уходе — ошибка", async () => {
    stubFetch({ "POST /api/me/onboarding": [409, apiError("nickname_taken")] });
    const root = await mountApp("/welcome", P1);
    const { input, box, submit } = parts(root);
    await type(input, "alice");
    await click(box);
    await click(submit);
    await waitFor(() => {
      expect(root.textContent).toContain("Ник уже занят");
    });
    await act(async () => {
      input.blur();
    });
    expect(root.textContent).toContain("Ник уже занят");
    await type(input, "a!");
    await act(async () => {
      input.focus();
      input.blur();
    });
    expect(root.textContent).toContain("Недопустимый ник");
  });

  it("К-9: internal — Toast, форма снова default", async () => {
    stubFetch({ "POST /api/me/onboarding": [500, apiError("internal")] });
    const root = await mountApp("/welcome", P1);
    const { input, box, submit } = parts(root);
    await type(input, "alice");
    await click(box);
    await click(submit);
    await waitFor(() => {
      expect(root.querySelector('[role="status"]')?.textContent).toBe("Что-то пошло не так");
    });
    expect(parts(root).screen?.dataset["state"]).toBe("default");
  });

  it("К-5, К-9: успех — тело {nickname, terms_accepted}, переход на return_to", async () => {
    const calls = stubFetch({ "POST /api/me/onboarding": [200, { user: makeMe({ nickname: "alice" }) }] });
    const root = await mountApp(`/welcome?return_to=${encodeURIComponent("/c/abc?x=1")}`, P1);
    const { input, box, submit } = parts(root);
    await type(input, "alice");
    await click(box);
    await click(submit);
    await waitFor(() => {
      expect(`${window.location.pathname}${window.location.search}`).toBe("/c/abc?x=1");
    });
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/me/onboarding", body: { nickname: "alice", terms_accepted: true } });
    expect(`${window.location.pathname}${window.location.search}`).toBe("/c/abc?x=1");
    expect(root.querySelector('button[aria-haspopup="menu"]')?.getAttribute("aria-label")).toBe("Меню аккаунта alice");
  });

  it("К-9: чужой return_to — на /", async () => {
    stubFetch({ "POST /api/me/onboarding": [200, { user: makeMe() }] });
    const root = await mountApp(`/welcome?return_to=${encodeURIComponent("//evil.example/x")}`, P1);
    const { input, box, submit } = parts(root);
    await type(input, "alice");
    await click(box);
    await click(submit);
    await waitFor(() => {
      expect(window.location.href).toBe(`${window.location.origin}/`);
    });
  });

  it("К-7: язык гостя из localStorage ≠ Me.locale — PATCH {locale}, ключ очищен", async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    const calls = stubFetch({
      "POST /api/me/onboarding": [200, { user: makeMe({ locale: "ru" }) }],
      "PATCH /api/me": [200, { user: makeMe({ locale: "en" }) }],
    });
    const root = await mountApp("/welcome", P1);
    const { input, box, submit } = parts(root);
    await type(input, "alice");
    await click(box);
    await click(submit);
    await waitFor(() => {
      expect(document.documentElement.lang).toBe("en");
    });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /api/me/onboarding", "PATCH /api/me"]);
    expect(calls[1]?.body).toEqual({ locale: "en" });
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.lang).toBe("en");
  });

  it("К-7: язык гостя = Me.locale — без PATCH, ключ очищен", async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "ru");
    const calls = stubFetch({ "POST /api/me/onboarding": [200, { user: makeMe({ locale: "ru" }) }] });
    const root = await mountApp("/welcome", P1);
    const { input, box, submit } = parts(root);
    await type(input, "alice");
    await click(box);
    await click(submit);
    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
    });
    expect(calls).toHaveLength(1);
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it("К-9: onboarding_completed — перечитать Me и на /", async () => {
    stubFetch({
      "POST /api/me/onboarding": [409, apiError("onboarding_completed")],
      "GET /api/me": [200, { user: makeMe() }],
    });
    const root = await mountApp("/welcome", P1);
    const { input, box, submit } = parts(root);
    await type(input, "alice");
    await click(box);
    await click(submit);
    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
    });
    expect(root.querySelector('[data-screen="lobby"]')).not.toBeNull();
  });

  it("К-9: Игрок и гость на /welcome уходят на /", async () => {
    stubFetch({ "GET /api/me": [200, { user: null }] });
    await mountApp("/welcome", { status: "ready", me: makeMe() });
    expect(window.location.pathname).toBe("/");
    await mountApp("/welcome");
    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
    });
  });
});
