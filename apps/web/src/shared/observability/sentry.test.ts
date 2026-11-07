// @vitest-environment jsdom
import * as Sentry from "@sentry/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSentry, reportMissingI18nKey, resetSentryForTests } from "./sentry.ts";

vi.mock("@sentry/browser", () => ({ init: vi.fn(), captureMessage: vi.fn() }));

function setMeta(values: Record<string, string>): void {
  document.head.replaceChildren();
  for (const [name, content] of Object.entries(values)) {
    const tag = document.createElement("meta");
    tag.name = name;
    tag.content = content;
    document.head.append(tag);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSentryForTests();
});
afterEach(() => {
  document.head.replaceChildren();
});

describe("initSentry", () => {
  it("AC-20: без chezz-sentry-dsn init не вызывается", () => {
    setMeta({ "chezz-environment": "dev", "chezz-release": "r1" });
    expect(initSentry()).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("AC-20: с DSN — environment и release из <meta>, без PII и трассировки, хуки фильтра", () => {
    setMeta({
      "chezz-sentry-dsn": "https://k@o0.ingest.sentry.io/1",
      "chezz-environment": "staging",
      "chezz-release": "1.2.3",
    });
    expect(initSentry()).toBe(true);
    const opts = vi.mocked(Sentry.init).mock.calls[0]?.[0];
    expect(opts).toMatchObject({
      dsn: "https://k@o0.ingest.sentry.io/1",
      environment: "staging",
      release: "1.2.3",
      sendDefaultPii: false,
    });
    expect(opts).not.toHaveProperty("tracesSampleRate");
    expect(opts).not.toHaveProperty("replaysSessionSampleRate");
    const event = opts?.beforeSend?.(
      { type: undefined, request: { url: "https://x.test/challenge/3f2b8c1e-5d4a-4e7b-9a6c-1b2d3e4f5a6b?code=1" } },
      {},
    );
    expect(JSON.stringify(event)).not.toContain("3f2b8c1e");
    expect(JSON.stringify(event)).not.toContain("code=1");
  });
});

describe("AC-19: клиент без Replay", () => {
  it("AC-19: sendDefaultPii false, без трассировки и Replay", () => {
    setMeta({ "chezz-sentry-dsn": "https://k@o0.ingest.sentry.io/1" });
    initSentry();
    const opts = vi.mocked(Sentry.init).mock.calls[0]?.[0];
    expect(opts?.sendDefaultPii).toBe(false);
    expect(opts?.tracesSampleRate ?? 0).toBe(0);
    const rec = opts as Record<string, unknown> | undefined;
    expect(rec?.["replaysSessionSampleRate"] ?? 0).toBe(0);
    expect(rec?.["replaysOnErrorSampleRate"] ?? 0).toBe(0);
    const integrations = Array.isArray(opts?.integrations) ? opts.integrations : [];
    expect(integrations.filter((i) => /replay/i.test(i.name))).toEqual([]);
  });
});

describe("reportMissingI18nKey", () => {
  it("AC-21, EC-26: один captureMessage на ключ, уровень error (DESIGN §15)", () => {
    setMeta({ "chezz-sentry-dsn": "https://k@o0.ingest.sentry.io/1" });
    initSentry();
    reportMissingI18nKey("a.b");
    reportMissingI18nKey("a.b");
    reportMissingI18nKey("c.d");
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(Sentry.captureMessage).mock.calls[0]?.[1]).toBe("error");
  });

  it("без DSN — не отправляет", () => {
    reportMissingI18nKey("a.b");
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
});
