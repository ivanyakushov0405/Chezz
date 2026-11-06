// startApp — app на случайном порту с базой воркера и ManualTimeSource (TESTING §7.3; design.md E01).
import { createServer } from "node:net";
import type { FastifyInstance } from "fastify";
import type { DestinationStream } from "pino";
import { buildApp } from "../../src/app.ts";
import type { Database } from "../../src/database.ts";
import type { AppConfig } from "../../src/platform/config.ts";
import { createDb, type Db } from "../../src/platform/db.ts";
import { setDatabaseAllowConnections, workerDatabaseName, workerDatabaseUrl } from "./db.ts";
import { ManualTimeSource } from "./time.ts";

export interface TestApp {
  /** http://127.0.0.1:<случайный порт> */
  url: string;
  /** ws://127.0.0.1:<порт>/ws (в E01 сервера WS нет — только адрес) */
  wsUrl: string;
  time: ManualTimeSource;
  database: {
    /** База воркера недоступна для app: соединения рвутся, новые отклоняются. */
    block(): Promise<void>;
    /** Снова доступна; app восстанавливается без перезапуска. */
    unblock(): Promise<void>;
  };
  /** Без штатного завершения (TESTING §7.3): сервер и пул закрываются, onClose сервисов не вызывается. */
  close(): Promise<void>;
}

export interface StartAppOptions {
  config?: Partial<AppConfig>;
  /** Поток лога app (по умолчанию — без лога). */
  logDestination?: DestinationStream;
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
    const url = `http://127.0.0.1:${port}`;
    const config: AppConfig = {
      appEnv: "dev",
      appOrigin: url,
      rateLimitIpPerMin: 300,
      webDistDir: null,
      logLevel: options.logDestination ? "info" : "silent",
      ...options.config,
    };
    const time = new ManualTimeSource();
    // Обрыв соединений при block() — ожидаемая ошибка пула; без обработчика pg роняет процесс.
    const db: Db<Database> = createDb<Database>(workerDatabaseUrl(), { onPoolError: () => undefined });
    let app: FastifyInstance | undefined;
    try {
      app = await buildApp(config, { db, time, logDestination: options.logDestination ?? silent });
      await app.listen({ host: "127.0.0.1", port });
    } catch (err) {
      await app?.close().catch(() => undefined);
      await db.destroy();
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE" && attempt < 5) continue;
      throw err;
    }
    const server = app.server;
    return {
      url,
      wsUrl: `ws://127.0.0.1:${port}/ws`,
      time,
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
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await db.destroy().catch(() => undefined);
        if (blocked) await setDatabaseAllowConnections(dbName, true);
      },
    };
  }
}
