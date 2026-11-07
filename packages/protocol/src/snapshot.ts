import { z } from "zod";
import { Category, ErrorResponse } from "./common.ts";
import { messageType } from "./dump.ts";
import { ErrorCode } from "./errors.ts";
import { REST_ROUTES, type RouteDef } from "./rest/routes.ts";
import { PROTOCOL_VERSION } from "./version.ts";
import { CLIENT_MESSAGE_SCHEMAS } from "./ws/client.ts";
import { SERVER_MESSAGE_SCHEMAS } from "./ws/server.ts";

type Json = Record<string, unknown>;

/** JSON Schema входящей схемы — как её видит вызывающий (`params`, `query`, `body`, `ws_client`). */
export const toJson = (schema: z.ZodType): Json => z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Json;

/** JSON Schema исходящей схемы — как её видит получатель (`response`, `ErrorResponse`, `ws_server`). */
export const toOutputJson = (schema: z.ZodType): Json =>
  z.toJSONSchema(schema, { io: "output", unrepresentable: "any" }) as Json;

/** JSON Schema всех схем протокола (API §16): сравнивается с `snapshot/protocol.json`. */
export function buildSnapshot(): Json {
  const rest: Record<string, Json> = {};
  for (const [operation, def] of Object.entries<RouteDef>(REST_ROUTES)) {
    const entry: Json = { method: def.method, path: def.path, status: def.status, who: [...def.who], errors: [...def.errors] };
    for (const part of ["params", "query", "body"] as const) {
      const schema = def[part];
      if (schema) entry[part] = toJson(schema);
    }
    entry["response"] = toOutputJson(def.response);
    rest[operation] = entry;
  }
  const byType = (schemas: readonly z.ZodObject[], json: (schema: z.ZodType) => Json): Record<string, Json> =>
    Object.fromEntries(schemas.map((s) => [messageType(s), json(s)] as const));
  return {
    protocol_version: PROTOCOL_VERSION,
    common: { ErrorCode: toJson(ErrorCode), ErrorResponse: toOutputJson(ErrorResponse), Category: toJson(Category) },
    rest,
    ws_client: byType(CLIENT_MESSAGE_SCHEMAS, toJson),
    ws_server: byType(SERVER_MESSAGE_SCHEMAS, toOutputJson),
  };
}
