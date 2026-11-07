// GET /api/health (API §12.6, P16): 200 {"status":"ok"} / 503 {"status":"unavailable"}, не формат §5.
// Без проверки X-Protocol-Version (API §7); в общем лимите /api (EC-12). Регистрирует app.ts.
import { REST_ROUTES, type GetHealthResponse } from "@chezz/protocol";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.ts";
import { registerRoute } from "./http.ts";
import { pingDatabase } from "./repo.ts";
import type { TimeSource } from "./time.ts";

/** Сколько ждать ответа PostgreSQL (design.md E01: ответ ≤ 3 с). */
export const HEALTH_DB_TIMEOUT_MS = 2_000;

/** true — БД ответила на SELECT 1 за timeoutMs; ошибка или таймаут — false. Таймер всегда снимается. */
export async function databaseAvailable(ping: () => Promise<void>, time: TimeSource, timeoutMs = HEALTH_DB_TIMEOUT_MS): Promise<boolean> {
  let timer: ReturnType<TimeSource["setTimer"]> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = time.setTimer(timeoutMs, () => resolve(false));
  });
  try {
    return await Promise.race([Promise.resolve().then(ping).then(() => true, () => false), timeout]);
  } finally {
    if (timer !== undefined) time.clearTimer(timer);
  }
}

export function registerHealthRoute(app: FastifyInstance, deps: { db: Db; time: TimeSource }): void {
  registerRoute(
    app,
    REST_ROUTES.getHealth,
    async ({ reply }): Promise<GetHealthResponse> => {
      if (await databaseAvailable(() => pingDatabase(deps.db), deps.time)) return { status: "ok" };
      void reply.code(503);
      return { status: "unavailable" };
    },
    { checkProtocolVersion: false },
  );
}
