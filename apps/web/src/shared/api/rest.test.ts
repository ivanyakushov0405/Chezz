import { PROTOCOL_VERSION, REST_ROUTES } from "@chezz/protocol";
import { describe, expect, it } from "vitest";
import { ApiError, buildPath, callApi, type FetchLike } from "./rest.ts";

const respond = (status: number, json?: unknown): FetchLike => async () => new Response(json === undefined ? null : JSON.stringify(json), { status });

describe("callApi", () => {
  it("К-9: путь, метод, X-Protocol-Version, JSON-тело; ответ разобран схемой", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl: FetchLike = async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ user: null }), { status: 200 });
    };
    await expect(callApi(REST_ROUTES.getMe, {}, fetchImpl)).resolves.toEqual({ user: null });
    expect(seen).toMatchObject({ url: "/api/me", init: { method: "GET", headers: { "X-Protocol-Version": String(PROTOCOL_VERSION) } } });
  });

  it("К-9: тело ошибки → ApiError с кодом и статусом", async () => {
    const err = await callApi(REST_ROUTES.completeOnboarding, { body: { nickname: "bob", terms_accepted: true } }, respond(409, { error: { code: "nickname_taken", message: "x", details: null, request_id: "00000000-0000-4000-8000-000000000009" } })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "nickname_taken", status: 409 });
  });

  it("К-9: нет связи → network; ответ не по схеме → unknown", async () => {
    const down: FetchLike = async () => {
      throw new TypeError("failed");
    };
    await expect(callApi(REST_ROUTES.getMe, {}, down)).rejects.toMatchObject({ code: "network", status: null });
    await expect(callApi(REST_ROUTES.getMe, {}, respond(200, { nope: 1 }))).rejects.toMatchObject({ code: "unknown" });
    await expect(callApi(REST_ROUTES.getMe, {}, respond(502))).rejects.toMatchObject({ code: "unknown", status: 502 });
  });

  it("К-9: 204 без тела у logout", async () => {
    await expect(callApi(REST_ROUTES.logout, {}, respond(204))).resolves.toBeUndefined();
  });

  it("buildPath кодирует параметры", () => {
    expect(buildPath("/api/users/:nickname", { nickname: "a/b" })).toBe("/api/users/a%2Fb");
  });
});
