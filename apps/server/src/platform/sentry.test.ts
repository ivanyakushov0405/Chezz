// Unit: опции клиента Sentry (AC-12, AC-19), путь события (SECURITY §15), обработчик фатальных ошибок (EC-9),
// контекст запроса для события (errorContextOf).
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { errorContextOf } from "./errors.ts";
import {
  createErrorReporter,
  createFatalErrorHandler,
  errorReporterClientOptions,
  maskedPath,
  type ErrorContext,
  type ErrorReporter,
} from "./sentry.ts";

const DSN = "https://public@o0.ingest.sentry.io/0";
const CH = "3f2c9a1e-7b4d-4c2a-9e1f-5a6b7c8d9e0f";

describe("errorReporterClientOptions (AC-12, AC-19; ADR-0010)", () => {
  const options = errorReporterClientOptions({ dsn: DSN, environment: "prod", release: "abc123", origin: "https://x" });

  it("sendDefaultPii: false", () => {
    expect(options.sendDefaultPii).toBe(false);
  });

  it("трассировки нет: tracesSampleRate и tracesSampler не заданы", () => {
    expect(options.tracesSampleRate ?? 0).toBe(0);
    expect(options.tracesSampler).toBeUndefined();
  });

  it("без интеграций по умолчанию (роль defaultIntegrations: false у клиента — integrations: [])", () => {
    expect(options.integrations).toStrictEqual([]);
  });

  it("environment, release, dsn; без имени хоста; хуки — фильтр SECURITY §15", () => {
    expect(options).toMatchObject({ dsn: DSN, environment: "prod", release: "abc123", includeServerName: false });
    expect(options.beforeSend).toBeTypeOf("function");
    expect(options.beforeSendTransaction).toBeTypeOf("function");
    expect(options.beforeBreadcrumb).toBeTypeOf("function");
    const crumb = options.beforeBreadcrumb?.({ message: `/challenge/${CH}`, data: { url: `/api/challenges/${CH}?a=1` } });
    expect(crumb).toStrictEqual({ message: "/challenge/:id", data: { url: "/api/challenges/:id" } });
  });
});

describe("maskedPath", () => {
  it("строка запроса и фрагмент отрезаются, id вызова → :id, /game/<id> сохраняется", () => {
    expect(maskedPath(`/challenge/${CH}?x=1#y`)).toBe("/challenge/:id");
    expect(maskedPath("/auth/google/callback?code=c&state=s")).toBe("/auth/google/callback");
    expect(maskedPath(`/game/${CH}`)).toBe(`/game/${CH}`);
  });
});

describe("errorContextOf", () => {
  function request(fields: { url: string; route?: string; caller?: FastifyRequest["caller"] | null }): FastifyRequest {
    return {
      id: "req-1",
      method: "POST",
      url: fields.url,
      routeOptions: { url: fields.route },
      caller: fields.caller ?? null,
    } as unknown as FastifyRequest;
  }

  it("путь без строки запроса, шаблон маршрута, request_id; гость — без user_id", () => {
    const ctx = errorContextOf(request({ url: `/api/challenges/${CH}/accept?x=1`, route: "/api/challenges/:id/accept", caller: { who: "guest" } }));

    expect(ctx).toStrictEqual<ErrorContext>({
      request_id: "req-1",
      method: "POST",
      route: "/api/challenges/:id/accept",
      path: `/api/challenges/${CH}/accept`,
    });
  });

  it("маршрут неизвестен и «Кто» ещё не определён → без route и user_id", () => {
    const ctx = errorContextOf(request({ url: "/nowhere?q=1" }));

    expect(ctx).toStrictEqual<ErrorContext>({ request_id: "req-1", method: "POST", path: "/nowhere" });
  });

  it("Игрок → user_id (только id, без session_id)", () => {
    const ctx = errorContextOf(request({ url: "/api/x", route: "/api/x", caller: { who: "player", user_id: "u1", session_id: "s1" } }));

    expect(ctx.user_id).toBe("u1");
    expect(JSON.stringify(ctx)).not.toContain("s1");
  });
});

describe("createFatalErrorHandler (EC-9)", () => {
  function fakeReporter(flushResult: Promise<boolean>) {
    const calls: string[] = [];
    const captured: unknown[] = [];
    const reporter: ErrorReporter = {
      enabled: true,
      captureException: (error) => {
        calls.push("capture");
        captured.push(error);
      },
      captureMessage: () => undefined,
      flush: async (timeoutMs) => {
        calls.push(`flush:${timeoutMs}`);
        return flushResult;
      },
      close: () => Promise.resolve(true),
    };
    return { reporter, calls, captured };
  }

  for (const kind of ["uncaughtException", "unhandledRejection"] as const) {
    it(`${kind} → лог fatal, capture, flush(2000), exit(1) — в этом порядке`, async () => {
      const { reporter, calls, captured } = fakeReporter(Promise.resolve(true));
      const logged: unknown[] = [];
      const handler = createFatalErrorHandler({
        log: {
          fatal: (obj, msg) => {
            calls.push("log");
            logged.push({ ...obj, msg });
          },
        },
        reporter,
        exit: (code) => calls.push(`exit:${code}`),
        flushTimeoutMs: 2_000,
      });
      const err = new Error("crash");

      await handler(err, kind);

      expect(calls).toStrictEqual(["log", "capture", "flush:2000", "exit:1"]);
      expect(captured).toStrictEqual([err]);
      expect(logged).toStrictEqual([{ err, kind, msg: "fatal error" }]);
    });
  }

  it("flush реджектится → обработчик не реджектится, exit(1) всё равно", async () => {
    const { reporter, calls } = fakeReporter(Promise.reject(new Error("net")));
    const handler = createFatalErrorHandler({ log: { fatal: () => undefined }, reporter, exit: (c) => calls.push(`exit:${c}`), flushTimeoutMs: 10 });

    await expect(handler(new Error("x"), "uncaughtException")).resolves.toBeUndefined();

    expect(calls.at(-1)).toBe("exit:1");
  });

  it("вторая ошибка во время отправки → только лог, один capture, один exit", async () => {
    let release: (ok: boolean) => void = () => undefined;
    const { reporter, calls } = fakeReporter(new Promise<boolean>((r) => (release = r)));
    const handler = createFatalErrorHandler({
      log: { fatal: () => calls.push("log") },
      reporter,
      exit: (c) => calls.push(`exit:${c}`),
      flushTimeoutMs: 2_000,
    });

    const first = handler(new Error("a"), "uncaughtException");
    await handler(new Error("b"), "unhandledRejection");
    release(true);
    await first;

    expect(calls.filter((c) => c === "capture")).toHaveLength(1);
    expect(calls.filter((c) => c === "exit:1")).toHaveLength(1);
    expect(calls.filter((c) => c === "log")).toHaveLength(2);
  });

  it("с настоящим репортёром и «висящим» транспортом → exit в пределах таймаута flush", async () => {
    const transport = (() => ({ send: () => new Promise(() => undefined), flush: () => new Promise(() => undefined) })) as unknown as NonNullable<
      Parameters<typeof createErrorReporter>[0]["transport"]
    >;
    const reporter = createErrorReporter({ dsn: DSN, environment: "prod", release: "r", origin: "https://x", transport });
    const exits: number[] = [];
    const handler = createFatalErrorHandler({ log: { fatal: () => undefined }, reporter, exit: (c) => exits.push(c), flushTimeoutMs: 200 });

    const started = performance.now();
    await handler(new Error("crash"), "uncaughtException");

    expect(exits).toStrictEqual([1]);
    expect(performance.now() - started).toBeLessThan(1_500);
    await reporter.close(0);
  });
});
