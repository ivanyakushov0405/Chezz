// Точка входа процесса app: конфиг → пул БД → миграции → buildApp → listen (ADR-0005 п.1).
// Запуск: node apps/server/src/main.ts (Node.js 24, без сборки).
import { buildApp } from "./app.ts";
import type { Database } from "./database.ts";
import { loadConfig } from "./platform/config.ts";
import { createDb, migrateToLatest } from "./platform/db.ts";
import { createSystemTimeSource } from "./platform/time.ts";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const { host, port, databaseUrl, ...appConfig } = config;

  let onPoolError: (err: Error) => void = (err) => {
    console.error(JSON.stringify({ level: 50, msg: "database pool error", err: err.message }));
  };
  const db = createDb<Database>(databaseUrl, { onPoolError: (err) => onPoolError(err) });

  await migrateToLatest(db);
  const app = await buildApp(appConfig, { db, time: createSystemTimeSource() });
  onPoolError = (err) => app.log.error({ err }, "database pool error");

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
