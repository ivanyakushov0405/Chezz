// /ws (API §8.1): upgrade — Origin (platform, до Session) → общий лимит REST (ADR-0006 п.2) → версия, лимит
// соединений, welcome (service). Сообщение больше 4 КБ — закрытие (`maxPayload`, SECURITY §9).
import fastifyWebsocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import { apiRateLimit } from "../platform/http.ts";
import type { RealtimeService } from "./service.ts";

export const WS_PATH = "/ws";
/** Сообщение WebSocket ≤ 4 КБ (SECURITY §9). */
export const WS_MAX_PAYLOAD_BYTES = 4_096;

export async function registerRealtimeApi(app: FastifyInstance, svc: RealtimeService): Promise<void> {
  await app.register(fastifyWebsocket, {
    options: { maxPayload: WS_MAX_PAYLOAD_BYTES },
    // Остановка app: всем 1012 (API §10), затем сервер ws.
    preClose(done) {
      svc.closeAll();
      this.websocketServer.close(() => done());
    },
  });
  app.get(WS_PATH, { websocket: true, config: { rateLimit: apiRateLimit() } }, (socket, request) => {
    const version = (request.query as Record<string, unknown>)["protocol_version"];
    svc.accept(socket, {
      caller: request.caller,
      ip: request.ip,
      protocol_version: typeof version === "string" ? version : undefined,
    });
  });
}
