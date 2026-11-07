import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as protocol from "./index.ts";
import { buildSnapshot, toJson } from "./snapshot.ts";

const KEY_RE = /^[a-z][a-z0-9_]*$/;
const FORBIDDEN = new Set(["user_id", "creator_id", "white_id", "black_id"]);

/** Нарушения правил входящей схемы в её JSON Schema: строгость объектов, snake_case, запрещённые ключи. */
function violations(node: unknown, path = "$"): string[] {
  if (Array.isArray(node)) return node.flatMap((n, i) => violations(n, `${path}[${i}]`));
  if (node === null || typeof node !== "object") return [];
  const obj = node as Record<string, unknown>;
  const out: string[] = [];
  const props = obj["properties"];
  if (props && typeof props === "object") {
    if (obj["additionalProperties"] !== false) out.push(`${path}: not strict`);
    for (const key of Object.keys(props)) {
      if (!KEY_RE.test(key)) out.push(`${path}.${key}: key is not snake_case`);
      if (FORBIDDEN.has(key)) out.push(`${path}.${key}: forbidden key`);
    }
  }
  for (const [k, v] of Object.entries(obj)) out.push(...violations(v, `${path}.${k}`));
  return out;
}

function keyViolations(node: unknown, path = "$"): string[] {
  if (Array.isArray(node)) return node.flatMap((n, i) => keyViolations(n, `${path}[${i}]`));
  if (node === null || typeof node !== "object") return [];
  const obj = node as Record<string, unknown>;
  const props = obj["properties"];
  const out = props && typeof props === "object" ? Object.keys(props).filter((k) => !KEY_RE.test(k)).map((k) => `${path}.${k}`) : [];
  for (const [k, v] of Object.entries(obj)) out.push(...keyViolations(v, `${path}.${k}`));
  return out;
}

function incomingSchemas(): [string, z.ZodType][] {
  const list: [string, z.ZodType][] = [];
  for (const [op, def] of Object.entries<protocol.RouteDef>(protocol.REST_ROUTES)) {
    for (const part of ["params", "query", "body"] as const) {
      const schema = def[part];
      if (schema) list.push([`${op}.${part}`, schema]);
    }
  }
  protocol.CLIENT_MESSAGE_SCHEMAS.forEach((s, i) => list.push([`ws_client[${i}]`, s]));
  return list;
}

describe("схемы протокола", () => {
  it("AC-18: каждая входящая схема строгая, ключи snake_case, нет запрещённых ключей", () => {
    for (const [name, schema] of incomingSchemas()) {
      expect(violations(toJson(schema)), name).toEqual([]);
    }
  });

  it("AC-18: каждая входящая схема отклоняет объект с лишним полем (в т.ч. с обязательными полями)", () => {
    for (const [name, schema] of incomingSchemas()) {
      const res = z.safeParse(schema, { extra_field_x: 1 });
      expect(res.success, name).toBe(false);
      const codes = res.error?.issues.map((i) => i.code) ?? [];
      expect(codes, name).toContain("unrecognized_keys");
    }
  });

  it("AC-18: ключи всех схем снимка (включая ответы) — snake_case", () => {
    expect(keyViolations(buildSnapshot())).toEqual([]);
  });

  it("AC-18: проверка ловит нарушения (нестрогий объект, camelCase, user_id)", () => {
    expect(violations(toJson(z.object({ a: z.string() })))).not.toEqual([]);
    expect(violations(toJson(z.strictObject({ timeBase: z.int() })))).not.toEqual([]);
    expect(violations(toJson(z.strictObject({ user_id: z.string() })))).not.toEqual([]);
    expect(violations(toJson(z.strictObject({ time_base: z.int() })))).toEqual([]);
  });

  it("AC-18: в Game (если есть) нет fen и pgn", () => {
    const game = (protocol as Record<string, unknown>)["Game"] as z.ZodType | undefined;
    if (!game) return;
    const props = Object.keys((toJson(game)["properties"] as object | undefined) ?? {});
    expect(props).not.toContain("fen");
    expect(props).not.toContain("pgn");
  });

  it("AC-22: PROTOCOL_VERSION — целое", () => {
    expect(Number.isInteger(protocol.PROTOCOL_VERSION)).toBe(true);
    expect(protocol.PROTOCOL_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("getHealth: форма REST_ROUTES и ответа", () => {
    const r = protocol.REST_ROUTES.getHealth;
    expect([r.method, r.path, r.status]).toEqual(["GET", "/api/health", 200]);
    expect(r.who).toEqual(["guest", "onboarding", "player"]);
    expect(protocol.GetHealthResponse.safeParse({ status: "ok" }).success).toBe(true);
    expect(protocol.GetHealthResponse.safeParse({ status: "x" }).success).toBe(false);
  });

  it("ErrorCode: без повторов, включает коды обеих таблиц 5.2", () => {
    expect(new Set(protocol.ERROR_CODES).size).toBe(protocol.ERROR_CODES.length);
    for (const c of ["rate_limited", "internal", "ply_mismatch", "too_many_connections"]) {
      expect(protocol.ErrorCode.safeParse(c).success, c).toBe(true);
    }
  });

  it("AC-32: ErrorResponse.error.request_id — UUID", () => {
    const body = (request_id: unknown) => ({ error: { code: "internal", message: "m", details: null, request_id } });
    expect(protocol.ErrorResponse.safeParse(body("5b0c1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4")).success).toBe(true);
    for (const bad of ["", "x", "5b0c1d2e-3f4a-4b5c-8d6e-7f8091a2b3c40", 1, null]) {
      expect(protocol.ErrorResponse.safeParse(body(bad)).success, String(bad)).toBe(false);
    }
  });

  it("scrub: экспортируется из пакета", () => {
    expect(typeof protocol.scrubSentryEvent).toBe("function");
    expect(typeof protocol.scrubSentryBreadcrumb).toBe("function");
  });

  it("PENDING_CATALOG не пересекается с реализованным", () => {
    for (const op of Object.keys(protocol.REST_ROUTES)) expect(protocol.PENDING_CATALOG.rest).not.toContain(op);
  });
});
