// Точка входа процесса app: конфиг → пул БД → миграции → buildApp → listen (ADR-0005 п.1).
// Запуск: node apps/server/src/main.ts (Node.js 24, без сборки).
import { buildApp, SENTRY_FLUSH_TIMEOUT_MS } from "./app.ts";
import type { Database } from "./database.ts";
import { loadConfig } from "./platform/config.ts";
import { createDb, migrateToLatest } from "./platform/db.ts";
import { createErrorReporter, createFatalErrorHandler } from "./platform/sentry.ts";
import { createSystemTimeSource } from "./platform/time.ts";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const { host, port, databaseUrl, ...appConfig } = config;

  let onPoolError: (err: Error) => void = (err) => {
    console.error(JSON.stringify({ level: 50, msg: "database pool error", err: err.message }));
  };
  const db = createDb<Database>(databaseUrl, { onPoolError: (err) => onPoolError(err) });

  await migrateToLatest(db);
  const reporter = createErrorReporter({
    dsn: appConfig.sentryDsn,
    environment: appConfig.appEnv,
    release: appConfig.appVersion,
    origin: appConfig.appOrigin,
  });
  const app = await buildApp(appConfig, { db, time: createSystemTimeSource(), reporter });
  onPoolError = (err) => app.log.error({ err }, "database pool error");

  // EC-9: необработанное исключение процесса — лог fatal, событие Sentry (≤ 2 с на отправку), выход с кодом 1.
  const onFatal = createFatalErrorHandler({
    log: app.log,
    reporter,
    exit: (code) => process.exit(code),
    flushTimeoutMs: SENTRY_FLUSH_TIMEOUT_MS,
  });
  process.on("uncaughtException", (err) => void onFatal(err, "uncaughtException"));
  process.on("unhandledRejection", (reason) => void onFatal(reason, "unhandledRejection"));

  let closing = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, "shutting down");
    void app
      .close()
      .then(() => db.destroy())
      .then(
        () => process.exit(0),
        (err: unknown) => {
          app.log.error({ err }, "shutdown failed");
          process.exit(1);
        },
      );
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await app.listen({ host, port });
}

main().catch((err: unknown) => {
  // Только имя и текст ошибки: строка подключения в сообщения не попадает (ConfigError называет имена переменных).
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(JSON.stringify({ level: 60, msg: "app failed to start", err: `${e.name}: ${e.message}` }));
  process.exit(1);
});
