// Sentry сервера (ADR-0010; SECURITY §15; OPERATIONS §12.4, O22): свой NodeClient на buildApp, без Sentry.init,
// без автоинструментации и интеграций (integrations: []), без трассировки. Каждое событие — со своим Scope:
// контекст одного запроса не утекает в другое событие и в другой app того же процесса (ADR-0005 п.2).
// Фильтр SECURITY §15 — scrubSentryEvent / scrubSentryBreadcrumb из @chezz/protocol, второй реализации нет.
import { maskChallengeIds, scrubSentryBreadcrumb, scrubSentryEvent } from "@chezz/protocol";
import { defaultStackParser, makeNodeTransport, NodeClient, Scope, type NodeOptions } from "@sentry/node";
import type { AppEnv } from "./config.ts";
import { pathOnly } from "./log.ts";

/** Контекст события 5xx: всё — без строки запроса и ПДн; пользователь — только id. */
export interface ErrorContext {
  request_id?: string;
  method?: string;
  /** Шаблон маршрута Fastify (`/api/challenges/:id/accept`); нет — маршрут неизвестен. */
  route?: string;
  /** Путь запроса; строка запроса и фрагмент отрезаются, id вызова маскируется. */
  path?: string;
  user_id?: string;
}

export interface ErrorReporter {
  readonly enabled: boolean;
  captureException(error: unknown, ctx?: ErrorContext): void;
  captureMessage(message: string, level: "warning" | "error"): void;
  /** Ждёт отправки не дольше timeoutMs; не реджектится. */
  flush(timeoutMs: number): Promise<boolean>;
  /** flush + освобождение клиента (слушатели процесса); после close события не принимаются. */
  close(timeoutMs: number): Promise<boolean>;
}

/** Фабрика транспорта Sentry; тесты передают транспорт в память. */
export type TransportFactory = NonNullable<NodeOptions["transport"]>;

export interface ErrorReporterOptions {
  dsn: string | null;
  environment: AppEnv;
  release: string;
  /** APP_ORIGIN без завершающего `/`: request.url = origin + маскированный путь. */
  origin: string;
  transport?: TransportFactory;
}

type NodeClientOptions = ConstructorParameters<typeof NodeClient>[0];

/**
 * Опции NodeClient (AC-12, AC-19). `defaultIntegrations` — опция только Sentry.init; у клиента её роль играет
 * `integrations: []`. `tracesSampleRate` не задан — трассировки нет (ADR-0010 п.1).
 */
export function errorReporterClientOptions(opts: ErrorReporterOptions & { dsn: string }): NodeClientOptions {
  return {
    dsn: opts.dsn,
    environment: opts.environment,
    release: opts.release,
    sendDefaultPii: false,
    integrations: [],
    stackParser: defaultStackParser,
    transport: opts.transport ?? makeNodeTransport,
    // Имя хоста VPS и инъекции не нужны; трассировки и логов Sentry нет.
    includeServerName: false,
    sendClientReports: false,
    enableLogs: false,
    maxBreadcrumbs: 0,
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubSentryBreadcrumb(breadcrumb),
  };
}

/** Путь для события: без `?…`/`#…`, id вызова → `:id` (SECURITY §15, S37). */
export function maskedPath(path: string): string {
  return maskChallengeIds(pathOnly(path));
}

/** Ограничение ожидания отправки реальным временем: это ввод-вывод процесса, а не время партии (TimeSource не нужен). */
function withTimeout(promise: PromiseLike<boolean>, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
    timer.unref();
    Promise.resolve(promise).then(
      (ok) => {
        clearTimeout(timer);
        resolve(ok);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
}

const disabledReporter: ErrorReporter = Object.freeze({
  enabled: false,
  captureException: () => undefined,
  captureMessage: () => undefined,
  flush: () => Promise.resolve(true),
  close: () => Promise.resolve(true),
});

/** Не-Error (строка, объект) — в Error с безопасным текстом: поля объекта в событие не попадают (EC-7). */
function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === "string" ? error : `non-error thrown: ${typeof error}`);
}

export function createErrorReporter(opts: ErrorReporterOptions): ErrorReporter {
  const dsn = opts.dsn;
  if (dsn === null) return disabledReporter;

  const client = new NodeClient(errorReporterClientOptions({ ...opts, dsn }));
  const origin = opts.origin.replace(/\/+$/, "");

  function scopeFor(ctx: ErrorContext | undefined): Scope {
    const scope = new Scope();
    scope.setClient(client);
    if (ctx === undefined) return scope;
    if (ctx.request_id !== undefined) scope.setTag("request_id", ctx.request_id);
    if (ctx.user_id !== undefined) scope.setUser({ id: ctx.user_id });
    const path = ctx.path === undefined ? undefined : maskedPath(ctx.path);
    if (ctx.method !== undefined) {
      const target = ctx.route ?? path;
      if (target !== undefined) scope.setTransactionName(`${ctx.method} ${maskChallengeIds(target)}`);
    }
    if (ctx.method !== undefined || path !== undefined) {
      const request = {
        ...(ctx.method !== undefined ? { method: ctx.method } : {}),
        ...(path !== undefined ? { url: `${origin}${path}` } : {}),
      };
      scope.addEventProcessor((event) => ({ ...event, request }));
    }
    return scope;
  }

  return {
    enabled: true,
    captureException(error, ctx) {
      try {
        client.captureException(asError(error), { mechanism: { type: "generic", handled: true } }, scopeFor(ctx));
      } catch {
        // Отказ Sentry не ломает запрос (EC-11).
      }
    },
    captureMessage(message, level) {
      try {
        client.captureMessage(message, level, undefined, scopeFor(undefined));
      } catch {
        // См. captureException.
      }
    },
    flush: (timeoutMs) => withTimeout(client.flush(timeoutMs), timeoutMs),
    close: (timeoutMs) => withTimeout(client.close(timeoutMs), timeoutMs),
  };
}

export type FatalKind = "uncaughtException" | "unhandledRejection";

export interface FatalErrorHandlerDeps {
  /** Лог процесса (pino app.log): строка уровня fatal. */
  log: { fatal(obj: { err: unknown; kind: FatalKind }, msg: string): void };
  reporter: ErrorReporter;
  exit: (code: number) => void;
  flushTimeoutMs: number;
}

/**
 * Обработчик uncaughtException / unhandledRejection (EC-9): лог fatal → событие Sentry → flush ≤ flushTimeoutMs →
 * exit(1). Повторная ошибка во время отправки только логируется: выход уже запланирован.
 */
export function createFatalErrorHandler(deps: FatalErrorHandlerDeps): (error: unknown, kind: FatalKind) => Promise<void> {
  let exiting = false;
  return async (error, kind) => {
    try {
      deps.log.fatal({ err: error, kind }, "fatal error");
    } catch {
      // Лог недоступен — выходим всё равно.
    }
    if (exiting) return;
    exiting = true;
    try {
      deps.reporter.captureException(error);
      await deps.reporter.flush(deps.flushTimeoutMs);
    } catch {
      // Отказ Sentry не мешает выходу; обработчик не реджектится (иначе — новый unhandledRejection).
    } finally {
      deps.exit(1);
    }
  };
}
