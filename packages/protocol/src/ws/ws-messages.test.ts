import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  CLIENT_MESSAGE_SCHEMAS,
  ClientMessage,
  PENDING_CATALOG,
  Ping,
  Pong,
  PROTOCOL_VERSION,
  SERVER_MESSAGE_SCHEMAS,
  ServerMessage,
  SessionClosed,
  Welcome,
  WsError,
  WsRef,
} from "../index.ts";

const USER_ID = "5b0c1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4";
const GAME_ID = "9a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/** `type` схемы сообщения — литерал поля `type`. */
function messageType(schema: z.ZodObject): string {
  const t = schema.shape.type as z.ZodLiteral;
  return String(t.value);
}

const clientTypes = (): string[] => CLIENT_MESSAGE_SCHEMAS.map(messageType);
const serverTypes = (): string[] => SERVER_MESSAGE_SCHEMAS.map(messageType);

describe("WsRef (API §8.2)", () => {
  it("К-5: строка 1…16 символов разбирается", () => {
    expect(WsRef.safeParse("m").success).toBe(true);
    expect(WsRef.safeParse("m42").success).toBe(true);
    expect(WsRef.safeParse("a".repeat(16)).success).toBe(true);
  });

  it("К-5 E-1: пустая строка и строка длиннее 16 отклоняются", () => {
    expect(WsRef.safeParse("").success).toBe(false);
    expect(WsRef.safeParse("a".repeat(17)).success).toBe(false);
  });

  it("К-5 E-1: не строка отклоняется", () => {
    expect(WsRef.safeParse(42).success).toBe(false);
    expect(WsRef.safeParse(null).success).toBe(false);
  });
});

describe("Pong и ClientMessage (API §9.4, §13)", () => {
  it("К-5: пример API §9.4 {type: pong, n} разбирается", () => {
    expect(Pong.parse({ type: "pong", n: 7 })).toEqual({ type: "pong", n: 7 });
    expect(ClientMessage.parse({ type: "pong", n: 7 })).toEqual({ type: "pong", n: 7 });
  });

  it("К-5: pong с ref разбирается, ref сохраняется", () => {
    expect(ClientMessage.parse({ type: "pong", ref: "p1", n: 0 })).toEqual({ type: "pong", ref: "p1", n: 0 });
  });

  it("К-5: n = 0 допустим", () => {
    expect(ClientMessage.safeParse({ type: "pong", n: 0 }).success).toBe(true);
  });

  it("К-5 E-1: лишнее поле → отказ", () => {
    expect(ClientMessage.safeParse({ type: "pong", n: 1, extra: true }).success).toBe(false);
    expect(Pong.safeParse({ type: "pong", n: 1, extra: true }).success).toBe(false);
  });

  it("К-5 E-1: ref длиннее 16 символов → отказ", () => {
    expect(ClientMessage.safeParse({ type: "pong", ref: "a".repeat(17), n: 1 }).success).toBe(false);
  });

  it("К-5 E-1: ref ровно 16 символов разбирается", () => {
    expect(ClientMessage.safeParse({ type: "pong", ref: "a".repeat(16), n: 1 }).success).toBe(true);
  });

  it("К-5 E-1: отрицательный n → отказ", () => {
    expect(ClientMessage.safeParse({ type: "pong", n: -1 }).success).toBe(false);
  });

  it("К-5 E-1: дробный n → отказ", () => {
    expect(ClientMessage.safeParse({ type: "pong", n: 1.5 }).success).toBe(false);
  });

  it("К-5 E-1: n строкой → отказ", () => {
    expect(ClientMessage.safeParse({ type: "pong", n: "1" }).success).toBe(false);
  });

  it("К-5 E-1: без n → отказ", () => {
    expect(ClientMessage.safeParse({ type: "pong" }).success).toBe(false);
  });

  it("К-5 E-1: незнакомый type → отказ", () => {
    expect(ClientMessage.safeParse({ type: "pang", n: 1 }).success).toBe(false);
    expect(ClientMessage.safeParse({ type: "game.resign", game_id: GAME_ID }).success).toBe(false);
  });

  it("К-5 E-1: без type и не объект → отказ", () => {
    expect(ClientMessage.safeParse({ n: 1 }).success).toBe(false);
    expect(ClientMessage.safeParse(null).success).toBe(false);
    expect(ClientMessage.safeParse("pong").success).toBe(false);
    expect(ClientMessage.safeParse([{ type: "pong", n: 1 }]).success).toBe(false);
  });

  it("К-5: сервер → клиент сообщения клиентом не принимаются (ping от клиента — отказ)", () => {
    expect(ClientMessage.safeParse({ type: "ping", n: 1 }).success).toBe(false);
  });

  it("К-5: CLIENT_MESSAGE_SCHEMAS содержит Pong", () => {
    expect(CLIENT_MESSAGE_SCHEMAS).toContain(Pong);
    expect(clientTypes()).toContain("pong");
  });
});

describe("Welcome (API §8.1, §13)", () => {
  it("К-3: welcome игрока разбирается", () => {
    const msg = {
      type: "welcome",
      protocol_version: PROTOCOL_VERSION,
      user: { id: USER_ID, nickname: "magnus" },
      ping_interval_ms: 5000,
    };
    expect(Welcome.parse(msg)).toEqual(msg);
  });

  it("К-3: welcome гостя (user: null) разбирается", () => {
    const msg = { type: "welcome", protocol_version: PROTOCOL_VERSION, user: null, ping_interval_ms: 5000 };
    expect(Welcome.parse(msg)).toEqual(msg);
  });

  it("К-3: welcome П1 (nickname: null) разбирается", () => {
    const msg = {
      type: "welcome",
      protocol_version: PROTOCOL_VERSION,
      user: { id: USER_ID, nickname: null },
      ping_interval_ms: 5000,
    };
    expect(Welcome.parse(msg)).toEqual(msg);
  });

  it("К-3: без user → отказ (user обязателен, null — явно)", () => {
    expect(Welcome.safeParse({ type: "welcome", protocol_version: 1, ping_interval_ms: 5000 }).success).toBe(false);
  });

  it("К-3: user.id не uuid → отказ", () => {
    const msg = { type: "welcome", protocol_version: 1, user: { id: "42", nickname: "magnus" }, ping_interval_ms: 5000 };
    expect(Welcome.safeParse(msg).success).toBe(false);
  });

  it("К-3: без protocol_version или дробный → отказ", () => {
    expect(Welcome.safeParse({ type: "welcome", user: null, ping_interval_ms: 5000 }).success).toBe(false);
    expect(Welcome.safeParse({ type: "welcome", protocol_version: 1.5, user: null, ping_interval_ms: 5000 }).success).toBe(
      false,
    );
  });

  it("К-3: ping_interval_ms не больше нуля или дробный → отказ", () => {
    const base = { type: "welcome", protocol_version: 1, user: null };
    expect(Welcome.safeParse({ ...base, ping_interval_ms: 0 }).success).toBe(false);
    expect(Welcome.safeParse({ ...base, ping_interval_ms: -5000 }).success).toBe(false);
    expect(Welcome.safeParse({ ...base, ping_interval_ms: 1.5 }).success).toBe(false);
    expect(Welcome.safeParse(base).success).toBe(false);
  });

  it("К-3: сервер → клиент нестрогий — незнакомое поле не ломает разбор (API §1)", () => {
    const msg = { type: "welcome", protocol_version: 1, user: null, ping_interval_ms: 5000, future_field: 1 };
    expect(Welcome.safeParse(msg).success).toBe(true);
    expect(ServerMessage.safeParse(msg).success).toBe(true);
  });
});

describe("Ping (API §9.4)", () => {
  it("К-5: пример API §9.4 {type: ping, n} разбирается", () => {
    expect(Ping.parse({ type: "ping", n: 3 })).toEqual({ type: "ping", n: 3 });
    expect(Ping.parse({ type: "ping", n: 0 })).toEqual({ type: "ping", n: 0 });
  });

  it("К-5: отрицательный, дробный или отсутствующий n → отказ", () => {
    expect(Ping.safeParse({ type: "ping", n: -1 }).success).toBe(false);
    expect(Ping.safeParse({ type: "ping", n: 0.5 }).success).toBe(false);
    expect(Ping.safeParse({ type: "ping" }).success).toBe(false);
  });
});

describe("WsError (API §8.1, §13)", () => {
  const CODES = [
    "client_outdated",
    "too_many_connections",
    "rate_limited",
    "validation_failed",
    "unauthenticated",
    "onboarding_required",
  ] as const;

  for (const code of CODES) {
    it(`К-5: error с кодом ${code} разбирается`, () => {
      const msg = { type: "error", ref: null, code, game_id: null, details: null };
      expect(WsError.parse(msg)).toEqual(msg);
    });
  }

  it("К-5: error validation_failed с ref команды разбирается, ref сохраняется", () => {
    const msg = { type: "error", ref: "m42", code: "validation_failed", game_id: null, details: null };
    expect(WsError.parse(msg)).toEqual(msg);
  });

  it("К-5: error с game_id и непустым details разбирается", () => {
    const msg = { type: "error", ref: "m43", code: "not_your_turn", game_id: GAME_ID, details: { ply: 11 } };
    expect(WsError.parse(msg)).toEqual(msg);
  });

  it("К-5 E-1: неизвестный код → отказ", () => {
    const msg = { type: "error", ref: null, code: "no_such_code", game_id: null, details: null };
    expect(WsError.safeParse(msg).success).toBe(false);
    expect(ServerMessage.safeParse(msg).success).toBe(false);
  });

  it("К-5 E-1: без code → отказ", () => {
    expect(WsError.safeParse({ type: "error", ref: null, game_id: null, details: null }).success).toBe(false);
  });

  it("К-5 E-1: game_id не uuid → отказ", () => {
    const msg = { type: "error", ref: null, code: "not_found", game_id: "9a1c", details: null };
    expect(WsError.safeParse(msg).success).toBe(false);
  });

  it("К-5 E-1: ref не строка и не null → отказ", () => {
    const msg = { type: "error", ref: 42, code: "validation_failed", game_id: null, details: null };
    expect(WsError.safeParse(msg).success).toBe(false);
  });
});

describe("SessionClosed (API §13)", () => {
  it("К-5: {type: session.closed} разбирается", () => {
    expect(SessionClosed.parse({ type: "session.closed" })).toEqual({ type: "session.closed" });
  });

  it("К-5: другой type → отказ", () => {
    expect(SessionClosed.safeParse({ type: "session.close" }).success).toBe(false);
  });
});

describe("ServerMessage (API §8.2)", () => {
  const SAMPLES = [
    { type: "welcome", protocol_version: 1, user: null, ping_interval_ms: 5000 },
    { type: "ping", n: 4 },
    { type: "error", ref: null, code: "rate_limited", game_id: null, details: null },
    { type: "session.closed" },
  ];

  it("К-3, К-5: различает все четыре сообщения по type", () => {
    for (const sample of SAMPLES) {
      const parsed: unknown = ServerMessage.parse(sample);
      expect(parsed, sample.type).toMatchObject({ type: sample.type });
      expect(parsed).toEqual(sample);
    }
  });

  it("К-5: тело одного type не проходит под другим type", () => {
    expect(ServerMessage.safeParse({ type: "welcome", n: 4 }).success).toBe(false);
    expect(ServerMessage.safeParse({ type: "ping", protocol_version: 1, user: null, ping_interval_ms: 5000 }).success).toBe(
      false,
    );
  });

  it("К-5: незнакомый type → отказ разбора (клиент такое сообщение игнорирует)", () => {
    expect(ServerMessage.safeParse({ type: "lobby.unknown" }).success).toBe(false);
    expect(ServerMessage.safeParse({ type: "pong", n: 1 }).success).toBe(false);
  });

  it("К-3, К-5: SERVER_MESSAGE_SCHEMAS содержит Welcome, Ping, WsError, SessionClosed", () => {
    for (const s of [Welcome, Ping, WsError, SessionClosed]) expect(SERVER_MESSAGE_SCHEMAS).toContain(s);
    expect([...serverTypes()].sort()).toEqual(
      ["error", "game.ended", "game.moved", "game.state", "ping", "session.closed", "welcome"].sort(),
    );
  });
});

describe("PENDING_CATALOG после E22 (ADR-0009)", () => {
  it("К-5: pong перенесён из PENDING_CATALOG.ws_client", () => {
    expect(PENDING_CATALOG.ws_client as readonly string[]).not.toContain("pong");
  });

  it("К-3, К-5: welcome, ping, error, session.closed перенесены из PENDING_CATALOG.ws_server", () => {
    for (const t of ["welcome", "ping", "error", "session.closed"]) {
      expect(PENDING_CATALOG.ws_server as readonly string[], t).not.toContain(t);
    }
  });

  it("К-5: pending не пересекается с реализованными сообщениями", () => {
    for (const t of clientTypes()) expect(PENDING_CATALOG.ws_client as readonly string[], t).not.toContain(t);
    for (const t of serverTypes()) expect(PENDING_CATALOG.ws_server as readonly string[], t).not.toContain(t);
  });

  it("К-5: остальные сообщения каталога на месте", () => {
    const wsClient = [
      "lobby.subscribe",
      "lobby.unsubscribe",
      "seek.start",
      "seek.cancel",
      "game.draw_offer",
      "game.draw_accept",
      "game.draw_decline",
      "game.takeback_offer",
      "game.takeback_accept",
      "game.takeback_decline",
      "game.resign",
      "game.abort",
      "game.abandonment_choice",
    ];
    const wsServer = [
      "lobby.state",
      "lobby.challenge_added",
      "lobby.challenge_removed",
      "challenge.closed",
      "seek.state",
      "seek.suggest_challenge",
      "game.offer",
      "game.presence",
      "game.started",
    ];
    expect([...PENDING_CATALOG.ws_client].sort()).toEqual([...wsClient].sort());
    expect([...PENDING_CATALOG.ws_server].sort()).toEqual([...wsServer].sort());
  });
});
