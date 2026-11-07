// Acceptance: фильтр событий Sentry `scrubSentryEvent` / `scrubSentryBreadcrumb` из `@chezz/protocol`
// (design.md E03, «Публичные интерфейсы для тестов» → «`@chezz/protocol` (T-1)»; SECURITY §15, S37; ADR-0010 п.2).
// AC-12…AC-16 (на уровне функций), EC-3…EC-6. По полю — отдельный тест (SECURITY §15 MUST).
// Одни и те же функции — в beforeSend, beforeBreadcrumb и beforeSendTransaction сервера и клиента (AC-16, AC-20).
import { scrubSentryBreadcrumb, scrubSentryEvent } from "@chezz/protocol";
import { describe, expect, it } from "vitest";

// Challenge.id — UUID v4 (SECURITY S9). Значения фиксированы: тест детерминирован.
const CH = "3f2c9a1e-7b4d-4c2a-9e1f-5a6b7c8d9e0f";
const CH2 = "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e";
const GAME = "9a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const USER = "0d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6";

// Эти строки не должны встретиться ни в одном поле после фильтра.
const SECRETS = [CH, CH2, "code=c", "state=s", "x=1", "#y", "sid=secret", "Bearer tkn", "alice@example.com", "203.0.113.7"];

function expectNoSecrets(value: unknown): void {
  const text = JSON.stringify(value);
  for (const secret of SECRETS) {
    expect(text).not.toContain(secret);
  }
}

/** Событие Sentry со всеми полями, которые фильтр обязан очистить (SECURITY §15). */
function dirtyEvent() {
  return {
    event_id: "c0ffee00c0ffee00c0ffee00c0ffee00",
    level: "error" as const,
    platform: "node",
    environment: "staging",
    release: "abc123",
    tags: { route: "/challenge/:id" },
    transaction: `/challenge/${CH}`,
    message: `challenge ${CH} expired at /challenge/${CH}`,
    logentry: { message: `failed /api/challenges/${CH}/accept`, params: [] as unknown[] },
    exception: {
      values: [
        { type: "Error", value: `cannot accept /api/challenges/${CH}/accept` },
        { type: "TypeError", value: `open /challenge/${CH2}` },
      ],
    },
    request: {
      method: "GET",
      url: `https://h/challenge/${CH}?x=1#y`,
      query_string: "x=1",
      cookies: { sid: "secret" },
      headers: {
        "User-Agent": "Mozilla/5.0",
        Cookie: "sid=secret",
        Authorization: "Bearer tkn",
      },
      data: { email: "alice@example.com" },
      env: { REMOTE_ADDR: "203.0.113.7" },
    },
    user: { id: USER, email: "alice@example.com", ip_address: "203.0.113.7", username: "alice" },
    breadcrumbs: [
      { category: "navigation", data: { from: `/challenge/${CH}?x=1`, to: `/challenge/${CH2}#y` } },
      { category: "fetch", data: { url: `https://h/api/challenges/${CH}/accept?x=1`, method: "POST" } },
      { category: "console", message: `open /challenge/${CH}` },
    ],
  };
}

describe("scrubSentryEvent: request (AC-12, EC-5)", () => {
  it("AC-12, EC-5: request.cookies удалён", () => {
    const out = scrubSentryEvent(dirtyEvent());
    expect(out.request).toBeDefined();
    expect(out.request).not.toHaveProperty("cookies");
  });

  it("AC-12, EC-5: request.headers удалён (User-Agent, Cookie, Authorization)", () => {
    const out = scrubSentryEvent(dirtyEvent());
    expect(out.request).not.toHaveProperty("headers");
    const text = JSON.stringify(out);
    expect(text).not.toContain("Mozilla/5.0");
    expect(text).not.toContain("Bearer tkn");
    expect(text).not.toContain("sid=secret");
  });

  it("AC-12, EC-5: request.data (тело запроса) удалён", () => {
    const out = scrubSentryEvent(dirtyEvent());
    expect(out.request).not.toHaveProperty("data");
    expect(JSON.stringify(out)).not.toContain("alice@example.com");
  });

  it("AC-12, EC-3: request.query_string удалён", () => {
    const out = scrubSentryEvent(dirtyEvent());
    expect(out.request).not.toHaveProperty("query_string");
  });

  it("AC-12: request.env удалён", () => {
    const out = scrubSentryEvent(dirtyEvent());
    expect(out.request).not.toHaveProperty("env");
    expect(JSON.stringify(out)).not.toContain("203.0.113.7");
  });

  it("AC-12: query_string в виде объекта (вариант Sentry) тоже удалён", () => {
    const event = { request: { url: "https://h/", query_string: { code: "c", state: "s" } } };
    const out = scrubSentryEvent(event);
    expect(out.request).not.toHaveProperty("query_string");
  });

  it("AC-12: method запроса сохраняется", () => {
    const out = scrubSentryEvent(dirtyEvent());
    expect(out.request?.method).toBe("GET");
  });
});

describe("scrubSentryEvent: user (AC-12, EC-6)", () => {
  it("AC-12, EC-6: user {id, email, ip_address, username} → ровно {id}", () => {
    const out = scrubSentryEvent(dirtyEvent());
    expect(out.user).toEqual({ id: USER });
  });

  it("EC-6: user без id (только email, ip_address, username) → user удалён", () => {
    const event = { message: "x", user: { email: "alice@example.com", ip_address: "203.0.113.7", username: "alice" } };
    const out = scrubSentryEvent(event);
    expect(out).not.toHaveProperty("user");
    expectNoSecrets(out);
  });

  it("EC-6: событие без user → user не появляется", () => {
    const out = scrubSentryEvent({ message: "x" });
    expect(out).not.toHaveProperty("user");
  });
});

describe("scrubSentryEvent: request.url (AC-13, EC-3)", () => {
  it("AC-13, EC-3: OAuth callback — строка запроса с code и state удалена", () => {
    const out = scrubSentryEvent({ request: { url: "https://h/auth/google/callback?code=c&state=s" } });
    expect(out.request?.url).toBe("https://h/auth/google/callback");
  });

  it("AC-13, EC-3: /challenge/<id>?x=1#y → /challenge/:id без строки запроса и фрагмента", () => {
    const out = scrubSentryEvent({ request: { url: `https://h/challenge/${CH}?x=1#y` } });
    expect(out.request?.url).toBe("https://h/challenge/:id");
  });

  it("AC-13, EC-3: только фрагмент (#…) удаляется", () => {
    const out = scrubSentryEvent({ request: { url: `https://h/challenge/${CH}#y` } });
    expect(out.request?.url).toBe("https://h/challenge/:id");
  });

  it("AC-13: /api/challenges/<id>/accept → /api/challenges/:id/accept", () => {
    const out = scrubSentryEvent({ request: { url: `https://h/api/challenges/${CH}/accept?x=1` } });
    expect(out.request?.url).toBe("https://h/api/challenges/:id/accept");
  });

  it("AC-13: /game/<id> не маскируется, строка запроса удаляется", () => {
    const out = scrubSentryEvent({ request: { url: `https://h/game/${GAME}?x=1` } });
    expect(out.request?.url).toBe(`https://h/game/${GAME}`);
  });

  it("AC-13: URL без строки запроса и без id не меняется", () => {
    const out = scrubSentryEvent({ request: { url: "https://h/api/challenges" } });
    expect(out.request?.url).toBe("https://h/api/challenges");
  });
});

describe("scrubSentryEvent: текстовые поля (AC-14, EC-4)", () => {
  it("AC-14, EC-4: event.transaction /challenge/<id> → /challenge/:id", () => {
    const out = scrubSentryEvent({ transaction: `/challenge/${CH}` });
    expect(out.transaction).toBe("/challenge/:id");
  });

  it("AC-14: event.transaction /game/<id> не меняется", () => {
    const out = scrubSentryEvent({ transaction: `/game/${GAME}` });
    expect(out.transaction).toBe(`/game/${GAME}`);
  });

  it("AC-14, EC-4: message — id замаскирован, остальной текст сохранён", () => {
    const out = scrubSentryEvent({ message: `accept failed: /api/challenges/${CH}/accept (game /game/${GAME})` });
    expect(out.message).toBe(`accept failed: /api/challenges/:id/accept (game /game/${GAME})`);
  });

  it("AC-14, EC-4: message с двумя id — оба замаскированы", () => {
    const out = scrubSentryEvent({ message: `/challenge/${CH} and /challenge/${CH2}` });
    expect(out.message).toBe("/challenge/:id and /challenge/:id");
  });

  it("AC-14, EC-4: logentry.message замаскирован", () => {
    const out = scrubSentryEvent({ logentry: { message: `failed /api/challenges/${CH}/accept` } });
    expect(out.logentry?.message).toBe("failed /api/challenges/:id/accept");
  });

  it("AC-14, EC-4: каждое exception.values[].value замаскировано, type сохранён", () => {
    const out = scrubSentryEvent({
      exception: {
        values: [
          { type: "Error", value: `cannot accept /api/challenges/${CH}/accept` },
          { type: "TypeError", value: `open /challenge/${CH2}` },
          { type: "RangeError", value: `game /game/${GAME}` },
        ],
      },
    });
    expect(out.exception?.values?.map((v: { value?: string }) => v.value)).toEqual([
      "cannot accept /api/challenges/:id/accept",
      "open /challenge/:id",
      `game /game/${GAME}`,
    ]);
    expect(out.exception?.values?.map((v: { type?: string }) => v.type)).toEqual(["Error", "TypeError", "RangeError"]);
  });

  it("AC-14: exception.values[] без value — не бросает, элемент сохраняется", () => {
    const out = scrubSentryEvent({ exception: { values: [{ type: "Error" }] } });
    expect(out.exception?.values).toEqual([{ type: "Error" }]);
  });

  it("EC-4: breadcrumbs[] события проходят через scrubSentryBreadcrumb", () => {
    const out = scrubSentryEvent({
      breadcrumbs: [
        { category: "navigation", data: { from: `/challenge/${CH}?x=1`, to: `/challenge/${CH2}#y` } },
        { category: "fetch", data: { url: `https://h/api/challenges/${CH}/accept?x=1`, method: "POST" } },
        { category: "console", message: `open /challenge/${CH}` },
      ],
    });
    expect(out.breadcrumbs).toEqual([
      { category: "navigation", data: { from: "/challenge/:id", to: "/challenge/:id" } },
      { category: "fetch", data: { url: "https://h/api/challenges/:id/accept", method: "POST" } },
      { category: "console", message: "open /challenge/:id" },
    ]);
  });
});

describe("scrubSentryEvent: событие целиком (AC-12…AC-14)", () => {
  it("AC-12…AC-14: после фильтра в событии нет id вызова, строки запроса, cookie, заголовков, e-mail, IP", () => {
    const out = scrubSentryEvent(dirtyEvent());
    expectNoSecrets(out);
  });

  it("AC-12…AC-14: поля без ПДн и секрета сохраняются (event_id, level, environment, release, tags)", () => {
    const out = scrubSentryEvent(dirtyEvent());
    expect(out.event_id).toBe("c0ffee00c0ffee00c0ffee00c0ffee00");
    expect(out.level).toBe("error");
    expect(out.environment).toBe("staging");
    expect(out.release).toBe("abc123");
    expect(out.tags).toEqual({ route: "/challenge/:id" });
  });

  it("AC-12: возвращает тот же объект (не null — событие не отбрасывается)", () => {
    const event = dirtyEvent();
    const out = scrubSentryEvent(event);
    expect(out).toBe(event);
  });

  it("AC-12…AC-14: повторный фильтр не меняет уже очищенное событие", () => {
    const once = structuredClone(scrubSentryEvent(dirtyEvent()));
    const twice = scrubSentryEvent(structuredClone(once));
    expect(twice).toEqual(once);
  });

  it("не бросает на пустом и частичном входе", () => {
    const inputs = [
      {},
      { request: {} },
      { user: {} },
      { exception: {} },
      { exception: { values: [] } },
      { breadcrumbs: [] },
      { breadcrumbs: [{}] },
      { logentry: {} },
    ];
    for (const input of inputs) {
      expect(() => scrubSentryEvent(input)).not.toThrow();
      expect(scrubSentryEvent(input)).toBe(input);
    }
  });
});

describe("scrubSentryEvent как beforeSendTransaction (AC-16)", () => {
  it("AC-16: событие трассировки — transaction /challenge/<id> → /challenge/:id", () => {
    const out = scrubSentryEvent({ type: "transaction" as const, transaction: `/challenge/${CH}` });
    expect(out.transaction).toBe("/challenge/:id");
  });

  it("AC-16: событие трассировки — request.url без строки запроса, id → :id", () => {
    const out = scrubSentryEvent({
      type: "transaction" as const,
      transaction: `GET /api/challenges/${CH}/accept`,
      request: { url: `https://h/api/challenges/${CH}/accept?x=1#y`, headers: { Cookie: "sid=secret" } },
    });
    expect(out.transaction).toBe("GET /api/challenges/:id/accept");
    expect(out.request?.url).toBe("https://h/api/challenges/:id/accept");
    expect(out.request).not.toHaveProperty("headers");
  });
});

describe("scrubSentryBreadcrumb (AC-15, EC-4)", () => {
  it("AC-15, EC-4: message замаскирован", () => {
    const out = scrubSentryBreadcrumb({ category: "console", message: `open /challenge/${CH} now` });
    expect(out.message).toBe("open /challenge/:id now");
  });

  it("AC-15, EC-4: data.url — id замаскирован, строка запроса и фрагмент удалены", () => {
    const out = scrubSentryBreadcrumb({
      category: "fetch",
      data: { url: `https://h/api/challenges/${CH}/accept?x=1#y`, method: "POST", status_code: 409 },
    });
    expect(out.data).toEqual({ url: "https://h/api/challenges/:id/accept", method: "POST", status_code: 409 });
  });

  it("AC-15, EC-3: data.url fetch к /auth/* — code и state удалены", () => {
    const out = scrubSentryBreadcrumb({
      category: "fetch",
      data: { url: "https://h/auth/google/callback?code=c&state=s", method: "GET" },
    });
    expect(out.data?.url).toBe("https://h/auth/google/callback");
  });

  it("AC-15, EC-4: data.to — id замаскирован, строка запроса удалена", () => {
    const out = scrubSentryBreadcrumb({ category: "navigation", data: { from: "/", to: `/challenge/${CH}?x=1` } });
    expect(out.data?.to).toBe("/challenge/:id");
    expect(out.data?.from).toBe("/");
  });

  it("AC-15, EC-4: data.from — id замаскирован, фрагмент удалён", () => {
    const out = scrubSentryBreadcrumb({ category: "navigation", data: { from: `/challenge/${CH}#y`, to: "/" } });
    expect(out.data?.from).toBe("/challenge/:id");
    expect(out.data?.to).toBe("/");
  });

  it("AC-15: /game/<id> в data.to не маскируется", () => {
    const out = scrubSentryBreadcrumb({ category: "navigation", data: { from: "/", to: `/game/${GAME}` } });
    expect(out.data?.to).toBe(`/game/${GAME}`);
  });

  it("AC-15: хлебная крошка без message, data.url, data.to, data.from не меняется", () => {
    const crumb = {
      category: "ui.click",
      level: "info" as const,
      timestamp: 1_700_000_000,
      data: { target: "button.play", count: 2 },
    };
    const before = structuredClone(crumb);
    const out = scrubSentryBreadcrumb(crumb);
    expect(out).toEqual(before);
  });

  it("AC-15: хлебная крошка без data не меняется и не получает data", () => {
    const crumb = { category: "app", level: "info" as const };
    const out = scrubSentryBreadcrumb(crumb);
    expect(out).toEqual({ category: "app", level: "info" });
    expect(out).not.toHaveProperty("data");
  });

  it("AC-15: прочие поля data сохраняются рядом с очищенными", () => {
    const out = scrubSentryBreadcrumb({
      category: "xhr",
      data: { url: `https://h/challenge/${CH}`, method: "GET", status_code: 200 },
    });
    expect(out.data).toEqual({ url: "https://h/challenge/:id", method: "GET", status_code: 200 });
  });

  it("AC-15: возвращает тот же объект (крошка не отбрасывается)", () => {
    const crumb = { category: "console", message: `/challenge/${CH}` };
    expect(scrubSentryBreadcrumb(crumb)).toBe(crumb);
  });

  it("не бросает на пустом и частичном входе", () => {
    const inputs = [{}, { data: {} }, { message: "" }, { data: { url: "" } }];
    for (const input of inputs) {
      expect(() => scrubSentryBreadcrumb(input)).not.toThrow();
      expect(scrubSentryBreadcrumb(input)).toBe(input);
    }
  });
});
