import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ErrorResponse } from "./common.ts";
import { REST_ROUTES } from "./rest/routes.ts";
import { buildSnapshot, toJson, toOutputJson } from "./snapshot.ts";
import { CLIENT_MESSAGE_SCHEMAS } from "./ws/client.ts";

describe("снимок протокола", () => {
  it("AC-19, EC-17: JSON Schema схем совпадает с snapshot/protocol.json (обновить: npm run -w packages/protocol snapshot)", () => {
    const file = JSON.parse(readFileSync(new URL("./snapshot/protocol.json", import.meta.url), "utf8")) as unknown;
    expect(JSON.parse(JSON.stringify(buildSnapshot()))).toEqual(file);
  });

  it("AC-32: в снимке ErrorResponse.error.request_id — формат uuid", () => {
    type Node = { properties: Record<string, Node>; format?: string };
    const snap = buildSnapshot() as { common: { ErrorResponse: Node } };
    expect(snap.common.ErrorResponse.properties["error"]?.properties["request_id"]?.format).toBe("uuid");
  });

  it("ответы, ErrorResponse и ws_server — io: output; вход — io: input", () => {
    type Snap = { common: Record<string, unknown>; rest: Record<string, Record<string, unknown>>; ws_client: Record<string, unknown> };
    const snap = buildSnapshot() as Snap;
    expect(snap.common["ErrorResponse"]).toEqual(toOutputJson(ErrorResponse));
    for (const [op, def] of Object.entries(REST_ROUTES)) expect(snap.rest[op]?.["response"], op).toEqual(toOutputJson(def.response));
    expect(Object.values(snap.ws_client)).toEqual(CLIENT_MESSAGE_SCHEMAS.map((s) => toJson(s)));
    // Различие режимов: поле с умолчанием на входе необязательно, на выходе — обязательно.
    const withDefault = z.object({ a: z.string().default("x") });
    expect(toJson(withDefault)["required"]).toBeUndefined();
    expect(toOutputJson(withDefault)["required"]).toEqual(["a"]);
  });
});
