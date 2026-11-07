import { describe, expect, it } from "vitest";
import { scrubSentryBreadcrumb, scrubSentryEvent, type SentryEventLike } from "./scrub.ts";

const ID = "3f2c9a1e-5b7d-4c8e-9f01-2a3b4c5d6e7f";

describe("scrubSentryEvent", () => {
  it("SECURITY §15: каждое поле request из списка удаляется, method и прочее сохраняются", () => {
    for (const key of ["cookies", "headers", "data", "query_string", "env"]) {
      const event = {
        request: { method: "POST", [key]: "x" },
      } as SentryEventLike;
      scrubSentryEvent(event);
      expect(event.request, key).toEqual({ method: "POST" });
    }
  });

  it("request.url: сначала отрезается ?… и #…, затем маскируется id", () => {
    const out = scrubSentryEvent({
      request: { url: `https://h/challenge/${ID}#a?b` },
    });
    expect(out.request?.url).toBe("https://h/challenge/:id");
    expect(scrubSentryEvent({ request: { url: "?only" } }).request?.url).toBe("");
  });

  it("user с числовым id → {id}; null-user и пустой id → user удалён", () => {
    expect(scrubSentryEvent({ user: { id: 7, email: "a@b" } as { id: number } }).user).toEqual({ id: 7 });
    expect(scrubSentryEvent({ user: { id: "" } })).not.toHaveProperty("user");
    expect(scrubSentryEvent({ user: null } as unknown as SentryEventLike)).not.toHaveProperty("user");
  });

  it("не бросает на нестроковых и чужих типах полей", () => {
    const inputs: unknown[] = [
      null,
      undefined,
      42,
      "s",
      { request: "x" },
      { request: { url: 5 } },
      { transaction: 1, message: {}, logentry: "x" },
      { exception: { values: "x" } },
      { exception: { values: [null, 1, { value: 2 }] } },
      { breadcrumbs: "x" },
      { breadcrumbs: [null, 1, { data: "x" }, { data: { url: 1 } }] },
    ];
    for (const input of inputs) {
      expect(() => scrubSentryEvent(input as SentryEventLike)).not.toThrow();
      expect(scrubSentryEvent(input as SentryEventLike)).toBe(input);
    }
  });

  it("не бросает, если поле бросает при чтении или объект заморожен", () => {
    const throwing = {
      get message(): string {
        throw new Error("boom");
      },
    };
    expect(scrubSentryEvent(throwing)).toBe(throwing);
    const frozen = Object.freeze({ message: `/challenge/${ID}` });
    expect(scrubSentryEvent(frozen)).toBe(frozen);
  });

  it("поля, не названные в правилах, не трогаются (tags, extra, contexts)", () => {
    const event = {
      tags: { a: "b" },
      extra: { k: 1 },
      contexts: { os: { name: "x" } },
    };
    const before = structuredClone(event);
    expect(scrubSentryEvent(event)).toEqual(before);
  });
});

describe("scrubSentryBreadcrumb", () => {
  it("message маскируется, но строка запроса в message сохраняется (это текст, не URL)", () => {
    expect(scrubSentryBreadcrumb({ message: `GET /challenge/${ID}?x=1` }).message).toBe("GET /challenge/:id?x=1");
  });

  it("каждое из data.url, data.to, data.from очищается отдельно", () => {
    for (const key of ["url", "to", "from"]) {
      const crumb = {
        data: {
          [key]: `/api/challenges/${ID}/accept?code=c#f`,
          other: "/challenge/x?y",
        },
      };
      scrubSentryBreadcrumb(crumb);
      expect(crumb.data, key).toEqual({
        [key]: "/api/challenges/:id/accept",
        other: "/challenge/x?y",
      });
    }
  });

  it("не бросает на чужих типах", () => {
    for (const input of [null, 1, { data: null }, { message: 1 }] as unknown[]) {
      expect(() => scrubSentryBreadcrumb(input as object)).not.toThrow();
    }
  });
});
