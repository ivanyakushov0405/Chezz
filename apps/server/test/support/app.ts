// startApp — app на случайном порту с базой воркера и ManualTimeSource (TESTING §7.3; design.md E01).
import { createServer } from "node:net";
import type { FastifyInstance } from "fastify";
import type { DestinationStream } from "pino";
import type { AnalyticsService } from "../../src/analytics/service.ts";
import type { OidcProvider } from "../../src/auth/oidc.ts";
import type { AuthService, SessionsClosedEvent } from "../../src/auth/service.ts";
import { buildApp } from "../../src/app.ts";
import type { Database } from "../../src/database.ts";
import type { AppConfig } from "../../src/platform/config.ts";
import type { MetricsService } from "../../src/platform/metrics.ts";
import { createErrorReporter, type ErrorReporter } from "../../src/platform/sentry.ts";
import { createDb, type Db } from "../../src/platform/db.ts";
import { setDatabaseAllowConnections, workerDatabaseName, workerDatabaseUrl } from "./db.ts";
import { memorySentryTransport, TEST_SENTRY_DSN, type SentryEvent } from "./sentry.ts";
import { ManualTimeSource } from "./time.ts";

/** Подпись `__Host-oidc` в тестах — не секрет. */
/** Клиент Google в тестах с подменённым обменом — не секрет. */
export const TEST_GOOGLE_CLIENT = { clientId: "test-client-id.apps.googleusercontent.com", clientSecret: "test-secret" };

export const TEST_COOKIE_SECRET = "test-cookie-secret-not-a-secret-000000";

export interface TestApp {
  /** http://127.0.0.1:<случайный порт> */
  url: string;
  /** ws://127.0.0.1:<порт>/ws (в E01 сервера WS нет — только адрес) */
  wsUrl: string;
  time: ManualTimeSource;
  /** http://127.0.0.1:<порт метрик> */
  metricsUrl: string;
  /** Экземпляр analytics, созданный buildApp. */
  analytics: AnalyticsService;
  /** Экземпляр auth, созданный buildApp. */
  auth: AuthService;
  /** События sessions_closed с момента старта (ARCHITECTURE §7.3). */
  sessionsClosed: SessionsClosedEvent[];
  /** Пул к базе воркера (для фабрик: createPlayer(app.db, …)). */
  db: Db<Database>;
  database: {
    /** База воркера недоступна для app: соединения рвутся, новые отклоняются. */
    block(): Promise<void>;
    /** Снова доступна; app восстанавливается без перезапуска. */
    unblock(): Promise<void>;
  };
  /** flush Sentry + отправленные события (после scrub); без sentry: true — []. */
  sentryEvents(): Promise<SentryEvent[]>;
  /** Без штатного завершения (TESTING §7.3): сервер и пул закрываются, onClose сервисов не вызывается. */
  close(): Promise<void>;
}

export interface StartAppOptions {
  config?: Partial<AppConfig>;
  /** Поток лога app (по умолчанию — без лога). */
  logDestination?: DestinationStream;
  /** Старт ManualTimeSource (EC-25). */
  time?: { wall?: Date };
  /** true: DSN TEST_SENTRY_DSN и транспорт в память (design.md E03). */
  sentry?: boolean;
  /** Подмена обмена code у Google (AppDeps.oidc); с ней config.google по умолчанию — тестовый клиент. */
  oidc?: OidcProvider;
}

const silent: DestinationStream = { write: () => undefined };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

export async function startApp(options: StartAppOptions = {}): Promise<TestApp> {
  const dbName = workerDatabaseName();
  let blocked = false;

  for (let attempt = 1; ; attempt++) {
    const port = await freePort();
    const metricsPort = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const config: AppConfig = {
      appEnv: "dev",
      appOrigin: url,
      rateLimitIpPerMin: 300,
      webDistDir: null,
      logLevel: options.logDestination ? "info" : "silent",
      appVersion: "test",
      sentryDsn: null,
      metrics: { host: "127.0.0.1", port: metricsPort },
      google: options.oidc ? TEST_GOOGLE_CLIENT : null,
      cookieSecret: TEST_COOKIE_SECRET,
      ...(options.sentry ? { sentryDsn: TEST_SENTRY_DSN } : {}),
      ...options.config,
    };
    // Без sentry: true транспорт не подменён — DSN из options.config в тестах не допускается (сети нет).
    const memory = options.sentry ? memorySentryTransport() : null;
    const reporter: ErrorReporter = createErrorReporter({
      dsn: memory === null ? null : config.sentryDsn,
      environment: config.appEnv,
      release: config.appVersion,
      origin: config.appOrigin,
      ...(memory === null ? {} : { transport: memory.transport }),
    });
    const time = new ManualTimeSource(options.time?.wall ? { wall: options.time.wall } : undefined);
    // Обрыв соединений при block() — ожидаемая ошибка пула; без обработчика pg роняет процесс.
    const db: Db<Database> = createDb<Database>(workerDatabaseUrl(), { onPoolError: () => undefined });
    let app: FastifyInstance | undefined;
    let metrics: MetricsService | undefined;
    let analytics: AnalyticsService | undefined;
    let auth: AuthService | undefined;
    const sessionsClosed: SessionsClosedEvent[] = [];
    try {
      app = await buildApp(config, {
        db,
        time,
        logDestination: options.logDestination ?? silent,
        reporter,
        ...(options.oidc ? { oidc: options.oidc } : {}),
        onMetrics: (m) => {
          metrics = m;
        },
        onAnalytics: (a) => {
          analytics = a;
        },
        onAuth: (a) => {
          auth = a;
          a.onSessionsClosed((e) => sessionsClosed.push(e));
        },
      });
      await app.listen({ host: "127.0.0.1", port });
    } catch (err) {
      await app?.close().catch(() => undefined);
      await metrics?.stop();
      await reporter.close(0);
      await db.destroy();
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE" && attempt < 5 && options.config?.metrics === undefined) continue;
      throw err;
    }
    const server = app.server;
    const metricsUrl = `http://127.0.0.1:${metrics?.port() ?? metricsPort}`;
    return {
      url,
      metricsUrl,
      wsUrl: `ws://127.0.0.1:${port}/ws`,
      time,
      analytics: analytics as AnalyticsService,
      auth: auth as AuthService,
      sessionsClosed,
      db,
      sentryEvents: async () => {
        if (memory === null) return [];
        await reporter.flush(2_000);
        return memory.events();
      },
      database: {
        block: async () => {
          blocked = true;
          await setDatabaseAllowConnections(dbName, false);
        },
        unblock: async () => {
          await setDatabaseAllowConnections(dbName, true);
          blocked = false;
        },
      },
      close: async () => {
        server.closeAllConnections();
        await analytics?.drain();
        await metrics?.stop();
        await reporter.close(2_000);
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await db.destroy().catch(() => undefined);
        if (blocked) await setDatabaseAllowConnections(dbName, true);
      },
    };
  }
}
