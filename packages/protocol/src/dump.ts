import { ERROR_CODES } from "./errors.ts";
import { PENDING_CATALOG } from "./pending.ts";
import { REST_ROUTES } from "./rest/routes.ts";
import { PROTOCOL_VERSION } from "./version.ts";
import { CLIENT_MESSAGE_SCHEMAS } from "./ws/client.ts";
import { SERVER_MESSAGE_SCHEMAS } from "./ws/server.ts";

/** Значение `type` схемы сообщения (`z.literal`). */
export function messageType(schema: { shape: Record<string, unknown> }): string {
  const type = schema.shape["type"] as { value?: unknown } | undefined;
  if (typeof type?.value !== "string") throw new Error("message schema without literal type");
  return type.value;
}

/** Что реализовано в протоколе: вход `scripts/check-api-doc.sh` (API §16, ADR-0009 п.3). */
export function buildDump() {
  return {
    protocol_version: PROTOCOL_VERSION,
    error_codes: [...ERROR_CODES],
    rest: Object.entries(REST_ROUTES).map(([operation, def]) => ({ operation, method: def.method, path: def.path })),
    ws_client: CLIENT_MESSAGE_SCHEMAS.map(messageType),
    ws_server: SERVER_MESSAGE_SCHEMAS.map(messageType),
    pending: {
      rest: [...PENDING_CATALOG.rest],
      ws_client: [...PENDING_CATALOG.ws_client],
      ws_server: [...PENDING_CATALOG.ws_server],
    },
  };
}
