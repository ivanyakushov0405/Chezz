// Корень сборки (ADR-0005 п.1): buildApp(config, deps) — для main.ts и тестов (TESTING §7.3).
// Создаёт сервисы модулей по слоям L0 → L6 и регистрирует их api. В E01 модулей, кроме platform, нет.
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { DestinationStream } from "pino";
import type { Database } from "./database.ts";
import type { AppConfig } from "./platform/config.ts";
import { migrateToLatest, type Db } from "./platform/db.ts";
import { alwaysGuest, type CallerResolver } from "./platform/http.ts";
import { createLogger, RequestLogController } from "./platform/log.ts";
import type { TimeSource } from "./platform/time.ts";

export interface AppDeps {
  db: Db<Database>;
  time: TimeSource;
  /** Куда писать лог (по умолчанию stdout); тесты передают свой поток. */
  logDestination?: DestinationStream;
}

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
  });

  // «Кто» — от auth.service.resolveCaller с фичи auth (ADR-0005 п.7); до неё — всегда гость.
  const resolveCaller: CallerResolver = alwaysGuest;

  app.decorateRequest("caller", null as never);
  app.addHook("onRequest", async (request, reply) => {
    void reply.header("X-Request-Id", request.id);
    request.caller = await resolveCaller(request);
  });

  // Сервисы модулей: L0 platform, analytics → L1 users, feedback → … (ARCHITECTURE §7.1). В E01 — нет.

  app.addHook("onReady", async () => {
    await migrateToLatest(deps.db);
  });

  if (config.webDistDir === null) {
    app.log.warn("web dist directory not found: SPA is not served");
  }

  return app;
}
