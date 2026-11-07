// Сериализаторы лога (SECURITY §15; E03 AC-8, AC-9).
import { describe, expect, it } from "vitest";
import { logSerializers, serializeError } from "./log.ts";

const ID = "3f2c9b1e-7a44-4d0a-9c1e-5b6d7e8f9a0b";

describe("serializeError", () => {
  it("AC-9: у ошибки pg только type, message, stack, code; detail и подстроки из него нет", () => {
    const err = Object.assign(new Error("duplicate key"), {
      name: "DatabaseError",
      detail: "Key (email)=(a@b.c) already exists.",
      code: "23505",
      constraint: "users_email_key",
      table: "users",
    });

    const out = serializeError(err);

    expect(Object.keys(out).sort()).toStrictEqual(["code", "message", "stack", "type"]);
    expect(out["type"]).toBe("DatabaseError");
    expect(out["code"]).toBe("23505");
    expect(JSON.stringify(out)).not.toContain("a@b.c");
  });

  it("cause не раскрывается", () => {
    const out = serializeError(new Error("outer", { cause: new Error("inner secret") }));
    expect(JSON.stringify(out)).not.toContain("inner secret");
  });

  it("message и stack проходят maskChallengeIds", () => {
    const out = serializeError(new Error(`bad GET /api/challenges/${ID}/accept and /challenge/${ID}`));

    expect(out["message"]).toBe("bad GET /api/challenges/:id/accept and /challenge/:id");
    expect(String(out["stack"])).not.toContain(ID);
    expect(String(out["stack"])).toContain("/challenge/:id");
  });

  it("не Error: type и message, без падения", () => {
    expect(serializeError(`/challenge/${ID}`)).toStrictEqual({ type: "string", message: "/challenge/:id" });
    expect(serializeError(undefined)).toMatchObject({ type: "undefined" });
  });
});

describe("serializer req", () => {
  it("AC-8: путь без строки запроса, id вызова → :id, /game/<id> не меняется", () => {
    expect(logSerializers.req({ method: "GET", url: `/api/challenges/${ID}?x=1` })).toStrictEqual({
      method: "GET",
      path: "/api/challenges/:id",
    });
    expect(logSerializers.req({ method: "GET", url: `/challenge/${ID}#f` }).path).toBe("/challenge/:id");
    expect(logSerializers.req({ method: "GET", url: `/game/${ID}` }).path).toBe(`/game/${ID}`);
    expect(logSerializers.req({ method: "GET", url: "/api/challenges" }).path).toBe("/api/challenges");
  });
});
