// Корень сборки (ADR-0005 п.1): buildApp(config, deps) — для main.ts и тестов (TESTING §7.3).
// Создаёт сервисы модулей по слоям L0 → L6 и регистрирует их api. В E01 модулей, кроме platform, нет.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyBaseLogger, type FastifyInstance, type RouteOptions } from "fastify";
import type { DestinationStream } from "pino";
import type { Database } from "./database.ts";
import { injectClientConfig } from "./platform/client-config.ts";
import type { AppConfig } from "./platform/config.ts";
import { migrateToLatest, type Db } from "./platform/db.ts";
import { registerHealthRoute } from "./platform/health.ts";
import { alwaysGuest, BODY_LIMIT_BYTES, installHttp, type CallerResolver } from "./platform/http.ts";
import { createMetrics, type MetricsService } from "./platform/metrics.ts";
import { createLogger, RequestLogController } from "./platform/log.ts";
import { createErrorReporter, type ErrorReporter } from "./platform/sentry.ts";
import type { TimeSource } from "./platform/time.ts";

export interface AppDeps {
  db: Db<Database>;
  time: TimeSource;
  /** Куда писать лог (по умолчанию stdout); тесты передают свой поток. */
  logDestination?: DestinationStream;
  /** Наблюдатель регистрации маршрутов (хук onRoute до любых маршрутов) — для routes.int.test.ts (API §16). */
  onRoute?: (route: RouteOptions) => void;
  /** Получает сервис метрик сразу после создания — тестовый startApp закрывает его без штатного app.close(). */
  onMetrics?: (metrics: MetricsService) => void;
  /** Sentry сервера (main.ts — createErrorReporter из конфига; тесты — с транспортом в память). Нет — выключен. */
  reporter?: ErrorReporter;
}

/** Ожидание отправки событий Sentry при остановке (ADR-0010 п.1). */
export const SENTRY_FLUSH_TIMEOUT_MS = 2_000;

export async function buildApp(config: AppConfig, deps: AppDeps): Promise<FastifyInstance> {
  const logger = createLogger(config.logLevel, deps.logDestination);
  const app = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    // X-Request-Id генерирует только сервер (API §3); входящий заголовок игнорируется.
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    // Своя строка лога на запрос вместо встроенных «incoming/completed» (SECURITY §15).
    logController: new RequestLogController(),
    // trustProxy выключен: ключ лимита — адрес сокета (SECURITY §9); адрес edge — E02.
    trustProxy: false,
    // Тело REST ≤ 16 КБ (API §3); разбор тела — platform/http.ts.
    bodyLimit: BODY_LIMIT_BYTES,
  });
  if (deps.onRoute) app.addHook("onRoute", deps.onRoute);

  // «Кто» — от auth.service.resolveCaller с фичи auth (ADR-0005 п.7); до неё — всегда гость.
  const resolveCaller: CallerResolver = alwaysGuest;

  const reporter =
    deps.reporter ?? createErrorReporter({ dsn: null, environment: config.appEnv, release: config.appVersion, origin: config.appOrigin });

  const webDistDir = config.webDistDir;
  // index.html с <meta> конфига клиента (ADR-0010 п.3): читается один раз; нет файла — отдаётся как есть.
  const indexHtml =
    webDistDir === null
      ? null
      : await readFile(path.join(webDistDir, "index.html"), "utf8").then(
          (html) => injectClientConfig(html, { environment: config.appEnv, release: config.appVersion, sentryDsn: config.sentryDsn }),
          () => null,
        );
  await installHttp(app, {
    appOrigin: config.appOrigin,
    rateLimitIpPerMin: config.rateLimitIpPerMin,
    resolveCaller,
    time: deps.time,
    reporter,
    // SPA: путь вне /api, /auth, /ws без файла — index.html (design.md E01, «HTTP-контракты app»).
    ...(webDistDir === null
      ? {}
      : {
          notFoundFallback: async (_request, reply) =>
            indexHtml === null
              ? reply.sendFile("index.html")
              : reply.header("Cache-Control", "no-cache").type("text/html; charset=utf-8").send(indexHtml),
        }),
  });

  // Сервисы модулей: L0 platform, analytics → L1 users, feedback → … (ARCHITECTURE §7.1). В E01 — нет.
  registerHealthRoute(app, { db: deps.db, time: deps.time });

  const metrics = createMetrics({ config: config.metrics, version: config.appVersion });
  deps.onMetrics?.(metrics);

  app.addHook("onReady", async () => {
    await migrateToLatest(deps.db);
    // Порт метрик занят — ошибка старта (EC-17), а не молчаливое отсутствие метрик.
    await metrics.start();
  });
  app.addHook("onClose", async () => {
    await metrics.stop();
    await reporter.close(SENTRY_FLUSH_TIMEOUT_MS);
  });

  if (webDistDir === null) {
    app.log.warn("web dist directory not found: SPA is not served");
  } else {
    // Статика и HTML — без лимита (SECURITY §9). Маршрут на каждый файл (wildcard: false), а не GET /*:
    // шаблон перехватил бы /api/<нет> (design.md E01, ADR «SPA-фолбэк»).
    const assetsDir = path.join(webDistDir, "assets") + path.sep;
    await app.register(fastifyStatic, {
      root: webDistDir,
      wildcard: false,
      // index.html (и «/») — только через фолбэк с <meta> конфига клиента.
      globIgnore: ["index.html"],
      cacheControl: false,
      setHeaders: (reply, filePath) => {
        void reply.header(
          "Cache-Control",
          path.resolve(filePath).startsWith(assetsDir) ? "public, max-age=31536000, immutable" : "no-cache",
        );
      },
    });
  }

  return app;
}
