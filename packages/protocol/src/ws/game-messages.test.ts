import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  CLIENT_MESSAGE_SCHEMAS,
  ClientMessage,
  GameEnded,
  GameMove,
  GameMoved,
  GameState,
  GameSubscribe,
  GameUnsubscribe,
  PENDING_CATALOG,
  SERVER_MESSAGE_SCHEMAS,
  ServerMessage,
} from "../index.ts";

const GAME_ID = "9a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const WHITE_ID = "5b0c1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4";
const BLACK_ID = "6c1d2e3f-4a5b-4c6d-9e7f-8091a2b3c4d5";

/** `type` схемы сообщения — литерал поля `type`. */
function messageType(schema: z.ZodObject): string {
  const t = schema.shape.type as z.ZodLiteral;
  return String(t.value);
}

const clientTypes = (): string[] => CLIENT_MESSAGE_SCHEMAS.map(messageType);
const serverTypes = (): string[] => SERVER_MESSAGE_SCHEMAS.map(messageType);

const RATINGS = {
  white: { rating_before: 1642, rating_after: 1633 },
  black: { rating_before: 1580, rating_after: 1592 },
};

const GAME = {
  id: GAME_ID,
  white: { id: WHITE_ID, nickname: "magnus", rating: 1642, provisional: false },
  black: { id: BLACK_ID, nickname: "hikaru", rating: 1580, provisional: false },
  category: "blitz",
  time_base: 180,
  time_increment: 2,
  rated: true,
  status: "active",
  result: null,
  termination: null,
  started_at: "2026-11-11T10:00:00.000Z",
  ended_at: null,
  moves: [
    { san: "e4", clock_ms: 182000 },
    { san: "e5", clock_ms: 182000 },
    { san: "Nf3", clock_ms: 159180 },
  ],
  ratings: null,
};

const CLOCK = { white_ms: 159180, black_ms: 182000, running: "black" };

const STATE = {
  type: "game.state",
  game_id: GAME_ID,
  game: GAME,
  clock: CLOCK,
  your_color: "black",
  draw_offer: null,
  takeback_offer: null,
  connected: { white: true, black: true },
  first_move_ms: null,
  reconnect: null,
  abandonment_choice: null,
};

/** Пример API §9.2: чёрные после 11 полуходов играют g8f6. */
const MOVE_EXAMPLE = { type: "game.move", ref: "m42", game_id: GAME_ID, ply: 11, uci: "g8f6" };

/** Пример API §9.2: всем `game.moved` с `ply: 12`, `san: "Nf6"`. */
const MOVED_EXAMPLE = {
  type: "game.moved",
  game_id: GAME_ID,
  ply: 12,
  san: "Nf6",
  clock: { white_ms: 150020, black_ms: 161300, running: "white" },
  draw_offer: null,
  takeback_offer: null,
};

/** Пример API §9.3: белые не вернулись, чёрные молчали 30 с. */
const ENDED_EXAMPLE = {
  type: "game.ended",
  game_id: GAME_ID,
  status: "finished",
  result: "black_wins",
  termination: "abandonment",
  ratings: RATINGS,
};

describe("GameSubscribe, GameUnsubscribe (API §8.3, §13)", () => {
  for (const [name, schema, type] of [
    ["GameSubscribe", GameSubscribe, "game.subscribe"],
    ["GameUnsubscribe", GameUnsubscribe, "game.unsubscribe"],
  ] as const) {
    it(`К-3: ${type} {game_id} разбирается схемой ${name} и ClientMessage`, () => {
      const msg = { type, game_id: GAME_ID };
      expect(schema.parse(msg)).toEqual(msg);
      expect(ClientMessage.parse(msg)).toEqual(msg);
    });

    it(`К-3: ${type} с ref разбирается, ref сохраняется`, () => {
      const msg = { type, ref: "s1", game_id: GAME_ID };
      expect(ClientMessage.parse(msg)).toEqual(msg);
    });

    it(`К-3: ${type} — game_id не UUID → отказ`, () => {
      expect(schema.safeParse({ type, game_id: "9a1c…" }).success).toBe(false);
      expect(ClientMessage.safeParse({ type, game_id: "42" }).success).toBe(false);
      expect(ClientMessage.safeParse({ type, game_id: 42 }).success).toBe(false);
    });

    it(`К-3: ${type} без game_id → отказ`, () => {
      expect(ClientMessage.safeParse({ type }).success).toBe(false);
    });

    it(`К-3: ${type} с лишним полем → отказ (строгая схема)`, () => {
      expect(ClientMessage.safeParse({ type, game_id: GAME_ID, color: "white" }).success).toBe(false);
      expect(schema.safeParse({ type, game_id: GAME_ID, extra: 1 }).success).toBe(false);
    });

    it(`К-3: ${type} — ref длиннее 16 символов → отказ`, () => {
      expect(ClientMessage.safeParse({ type, ref: "a".repeat(17), game_id: GAME_ID }).success).toBe(false);
    });
  }
});

describe("GameMove (API §9.1, §9.2)", () => {
  it("К-4: пример API §9.2 (ply 11, g8f6, ref m42) разбирается", () => {
    expect(GameMove.parse(MOVE_EXAMPLE)).toEqual(MOVE_EXAMPLE);
    expect(ClientMessage.parse(MOVE_EXAMPLE)).toEqual(MOVE_EXAMPLE);
  });

  it("К-4: первый ход партии (ply 0, e2e4) без ref разбирается", () => {
    const msg = { type: "game.move", game_id: GAME_ID, ply: 0, uci: "e2e4" };
    expect(ClientMessage.parse(msg)).toEqual(msg);
  });

  it("К-4, E-1: превращение e7e8q и e7e8 (без буквы) — формат допустим, допустимость решает сервер", () => {
    for (const uci of ["e7e8q", "e7e8r", "e7e8b", "e7e8n", "e7e8", "a2a1q", "h1h8"]) {
      expect(GameMove.safeParse({ type: "game.move", game_id: GAME_ID, ply: 10, uci }).success, uci).toBe(true);
    }
  });

  it("К-4: ply −1 → отказ", () => {
    expect(ClientMessage.safeParse({ ...MOVE_EXAMPLE, ply: -1 }).success).toBe(false);
  });

  it("К-4: дробный ply → отказ", () => {
    expect(ClientMessage.safeParse({ ...MOVE_EXAMPLE, ply: 11.5 }).success).toBe(false);
  });

  it("К-4: ply строкой → отказ", () => {
    expect(ClientMessage.safeParse({ ...MOVE_EXAMPLE, ply: "11" }).success).toBe(false);
  });

  it("К-4: без ply или без uci → отказ", () => {
    const { ply: _ply, ...noPly } = MOVE_EXAMPLE;
    const { uci: _uci, ...noUci } = MOVE_EXAMPLE;
    expect(ClientMessage.safeParse(noPly).success).toBe(false);
    expect(ClientMessage.safeParse(noUci).success).toBe(false);
  });

  it("К-4: uci e2e9 (нет ряда 9) → отказ", () => {
    expect(ClientMessage.safeParse({ ...MOVE_EXAMPLE, uci: "e2e9" }).success).toBe(false);
  });

  it("К-4: uci в верхнем регистре E2E4 → отказ", () => {
    expect(ClientMessage.safeParse({ ...MOVE_EXAMPLE, uci: "E2E4" }).success).toBe(false);
  });

  it("К-4: uci e7e8k (превращение в короля) → отказ", () => {
    expect(ClientMessage.safeParse({ ...MOVE_EXAMPLE, uci: "e7e8k" }).success).toBe(false);
  });

  it("К-4: uci не по формату — SAN, пустая, с пробелами, вертикаль i, лишние символы → отказ", () => {
    for (const uci of ["Nf3", "", " e2e4", "e2e4 ", "i2i4", "e2-e4", "e2e4qq", "e7e8Q", "e2", 2244]) {
      expect(GameMove.safeParse({ ...MOVE_EXAMPLE, uci }).success, String(uci)).toBe(false);
    }
  });

  it("К-4: game_id не UUID → отказ", () => {
    expect(ClientMessage.safeParse({ ...MOVE_EXAMPLE, game_id: "9a1c…" }).success).toBe(false);
  });

  it("К-4: лишнее поле clock_ms → отказ (API §9.1 MUST NOT: поля времени)", () => {
    expect(ClientMessage.safeParse({ ...MOVE_EXAMPLE, clock_ms: 159180 }).success).toBe(false);
    expect(GameMove.safeParse({ ...MOVE_EXAMPLE, clock_ms: 159180 }).success).toBe(false);
  });

  it("К-4: поля цвета, результата, SAN в команде → отказ (API §9.1 MUST NOT)", () => {
    for (const extra of [{ color: "black" }, { your_color: "black" }, { result: "black_wins" }, { san: "Nf6" }]) {
      expect(ClientMessage.safeParse({ ...MOVE_EXAMPLE, ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
  });
});

describe("ClientMessage и CLIENT_MESSAGE_SCHEMAS (API §8.2, §13)", () => {
  it("К-3, К-4: discriminatedUnion разбирает game.subscribe, game.unsubscribe, game.move по type", () => {
    const samples = [
      { type: "game.subscribe", game_id: GAME_ID },
      { type: "game.unsubscribe", game_id: GAME_ID },
      { type: "game.move", game_id: GAME_ID, ply: 0, uci: "e2e4" },
      { type: "pong", n: 1 },
    ];
    for (const sample of samples) {
      expect(ClientMessage.parse(sample), sample.type).toEqual(sample);
    }
  });

  it("К-3, К-4: тело одного type не проходит под другим type", () => {
    expect(ClientMessage.safeParse({ type: "game.subscribe", game_id: GAME_ID, ply: 0, uci: "e2e4" }).success).toBe(false);
    expect(ClientMessage.safeParse({ type: "game.move", game_id: GAME_ID }).success).toBe(false);
  });

  it("К-3, К-4: CLIENT_MESSAGE_SCHEMAS содержит GameSubscribe, GameUnsubscribe, GameMove", () => {
    for (const s of [GameSubscribe, GameUnsubscribe, GameMove]) expect(CLIENT_MESSAGE_SCHEMAS).toContain(s);
    for (const t of ["game.subscribe", "game.unsubscribe", "game.move"]) expect(clientTypes()).toContain(t);
  });

  it("К-4: серверные события партии клиентом не принимаются", () => {
    expect(ClientMessage.safeParse(MOVED_EXAMPLE).success).toBe(false);
    expect(ClientMessage.safeParse(STATE).success).toBe(false);
    expect(ClientMessage.safeParse(ENDED_EXAMPLE).success).toBe(false);
  });
});

describe("GameState (API §9.3)", () => {
  it("К-3: game.state участника (your_color: black) разбирается схемой GameState и ServerMessage", () => {
    expect(GameState.parse(STATE)).toEqual(STATE);
    expect(ServerMessage.parse(STATE)).toEqual(STATE);
  });

  it("К-3: game.state зрителя (your_color: null) разбирается", () => {
    const msg = { ...STATE, your_color: null, connected: { white: true, black: false } };
    expect(GameState.parse(msg)).toEqual(msg);
  });

  it("К-3: законченная партия — clock.running: null, ratings заданы", () => {
    const msg = {
      ...STATE,
      game: {
        ...GAME,
        status: "finished",
        result: "white_wins",
        termination: "checkmate",
        ended_at: "2026-11-11T10:05:00.000Z",
        ratings: RATINGS,
      },
      clock: { ...CLOCK, running: null },
    };
    expect(GameState.parse(msg)).toEqual(msg);
  });

  it("К-3: заполненные draw_offer, takeback_offer, first_move_ms, reconnect, abandonment_choice разбираются", () => {
    const msg = {
      ...STATE,
      draw_offer: { by: "white" },
      takeback_offer: { by: "black" },
      first_move_ms: 30000,
      reconnect: { color: "white", remaining_ms: 60000 },
      abandonment_choice: { remaining_ms: 30000 },
    };
    expect(GameState.parse(msg)).toEqual(msg);
  });

  it("К-3: your_color не цвет → отказ", () => {
    expect(GameState.safeParse({ ...STATE, your_color: "spectator" }).success).toBe(false);
  });

  it("К-3: first_move_ms дробный или строкой → отказ", () => {
    expect(GameState.safeParse({ ...STATE, first_move_ms: 1.5 }).success).toBe(false);
    expect(GameState.safeParse({ ...STATE, first_move_ms: "30000" }).success).toBe(false);
  });

  it("К-3: каждое поле game.state обязательно (null — явно)", () => {
    const fields = [
      "game_id",
      "game",
      "clock",
      "your_color",
      "draw_offer",
      "takeback_offer",
      "connected",
      "first_move_ms",
      "reconnect",
      "abandonment_choice",
    ] as const;
    for (const f of fields) {
      const msg: Record<string, unknown> = { ...STATE };
      delete msg[f];
      expect(GameState.safeParse(msg).success, f).toBe(false);
    }
  });

  it("К-3: game без moves → отказ", () => {
    const { moves: _m, ...noMoves } = GAME;
    expect(GameState.safeParse({ ...STATE, game: noMoves }).success).toBe(false);
  });

  it("К-3: сервер → клиент нестрогий — незнакомое поле не ломает разбор (API §1)", () => {
    expect(ServerMessage.safeParse({ ...STATE, future_field: 1 }).success).toBe(true);
  });
});

describe("GameMoved (API §9.2, §9.3)", () => {
  it("К-4: пример API §9.2 (ply 12, san Nf6) разбирается схемой GameMoved и ServerMessage", () => {
    expect(GameMoved.parse(MOVED_EXAMPLE)).toEqual(MOVED_EXAMPLE);
    expect(ServerMessage.parse(MOVED_EXAMPLE)).toEqual(MOVED_EXAMPLE);
  });

  it("К-4: первый ход партии — ply 1, clock.running: null — разбирается", () => {
    const msg = { ...MOVED_EXAMPLE, ply: 1, san: "e4", clock: { white_ms: 182000, black_ms: 180000, running: null } };
    expect(GameMoved.parse(msg)).toEqual(msg);
  });

  it("К-4: ply 0, отрицательный, дробный или строкой → отказ (номер хода с 1)", () => {
    for (const ply of [0, -1, 12.5, "12"]) {
      expect(GameMoved.safeParse({ ...MOVED_EXAMPLE, ply }).success, String(ply)).toBe(false);
    }
  });

  it("К-4: без san или без clock → отказ", () => {
    const { san: _s, ...noSan } = MOVED_EXAMPLE;
    const { clock: _c, ...noClock } = MOVED_EXAMPLE;
    expect(GameMoved.safeParse(noSan).success).toBe(false);
    expect(GameMoved.safeParse(noClock).success).toBe(false);
  });

  it("К-4: draw_offer и takeback_offer обязательны (null — явно)", () => {
    const { draw_offer: _d, ...noDraw } = MOVED_EXAMPLE;
    const { takeback_offer: _t, ...noTakeback } = MOVED_EXAMPLE;
    expect(GameMoved.safeParse(noDraw).success).toBe(false);
    expect(GameMoved.safeParse(noTakeback).success).toBe(false);
  });

  it("К-4: сервер → клиент нестрогий — незнакомое поле не ломает разбор", () => {
    expect(ServerMessage.safeParse({ ...MOVED_EXAMPLE, future_field: "x" }).success).toBe(true);
  });
});

describe("GameEnded (API §9.3)", () => {
  it("К-7: пример API §9.3 (abandonment, ratings) разбирается схемой GameEnded и ServerMessage", () => {
    expect(GameEnded.parse(ENDED_EXAMPLE)).toEqual(ENDED_EXAMPLE);
    expect(ServerMessage.parse(ENDED_EXAMPLE)).toEqual(ENDED_EXAMPLE);
  });

  it("К-7: товарищеская партия — ratings: null — разбирается", () => {
    const msg = { ...ENDED_EXAMPLE, result: "white_wins", termination: "checkmate", ratings: null };
    expect(GameEnded.parse(msg)).toEqual(msg);
  });

  it("К-7: ничьи автоокончаний и флага разбираются", () => {
    for (const termination of [
      "stalemate",
      "threefold_repetition",
      "fifty_moves",
      "insufficient_material",
      "timeout_insufficient_material",
    ]) {
      const msg = { ...ENDED_EXAMPLE, result: "draw", termination };
      expect(GameEnded.safeParse(msg).success, termination).toBe(true);
    }
  });

  it("К-7: aborted — result: null разбирается", () => {
    const msg = { ...ENDED_EXAMPLE, status: "aborted", result: null, termination: "aborted_by_player", ratings: null };
    expect(GameEnded.parse(msg)).toEqual(msg);
  });

  it("К-7: status: active → отказ (только finished, aborted)", () => {
    expect(GameEnded.safeParse({ ...ENDED_EXAMPLE, status: "active" }).success).toBe(false);
    expect(ServerMessage.safeParse({ ...ENDED_EXAMPLE, status: "active" }).success).toBe(false);
  });

  it("К-7: termination: null или неизвестное → отказ", () => {
    expect(GameEnded.safeParse({ ...ENDED_EXAMPLE, termination: null }).success).toBe(false);
    expect(GameEnded.safeParse({ ...ENDED_EXAMPLE, termination: "flag" }).success).toBe(false);
    const { termination: _t, ...noTermination } = ENDED_EXAMPLE;
    expect(GameEnded.safeParse(noTermination).success).toBe(false);
  });

  it("К-7: неизвестный result → отказ", () => {
    expect(GameEnded.safeParse({ ...ENDED_EXAMPLE, result: "black" }).success).toBe(false);
  });

  it("К-7: ratings только с одной стороной или без ratings → отказ", () => {
    expect(GameEnded.safeParse({ ...ENDED_EXAMPLE, ratings: { black: RATINGS.black } }).success).toBe(false);
    const { ratings: _r, ...noRatings } = ENDED_EXAMPLE;
    expect(GameEnded.safeParse(noRatings).success).toBe(false);
  });
});

describe("ServerMessage и SERVER_MESSAGE_SCHEMAS (API §8.2, §13)", () => {
  it("К-3, К-4, К-7: discriminatedUnion разбирает game.state, game.moved, game.ended по type", () => {
    for (const sample of [STATE, MOVED_EXAMPLE, ENDED_EXAMPLE]) {
      const parsed: unknown = ServerMessage.parse(sample);
      expect(parsed, sample.type).toMatchObject({ type: sample.type });
      expect(parsed).toEqual(sample);
    }
  });

  it("К-4: тело одного type не проходит под другим type", () => {
    expect(ServerMessage.safeParse({ ...MOVED_EXAMPLE, type: "game.ended" }).success).toBe(false);
    expect(ServerMessage.safeParse({ ...ENDED_EXAMPLE, type: "game.moved" }).success).toBe(false);
    expect(ServerMessage.safeParse({ ...MOVED_EXAMPLE, type: "game.state" }).success).toBe(false);
  });

  it("К-3, К-4, К-7: SERVER_MESSAGE_SCHEMAS содержит GameState, GameMoved, GameEnded", () => {
    for (const s of [GameState, GameMoved, GameEnded]) expect(SERVER_MESSAGE_SCHEMAS).toContain(s);
    for (const t of ["game.state", "game.moved", "game.ended"]) expect(serverTypes()).toContain(t);
  });

  it("К-4: команда клиента game.move сервером как событие не разбирается", () => {
    expect(ServerMessage.safeParse(MOVE_EXAMPLE).success).toBe(false);
  });
});

describe("PENDING_CATALOG после E06 (ADR-0009)", () => {
  it("К-3, К-4: game.subscribe, game.unsubscribe, game.move перенесены из ws_client", () => {
    for (const t of ["game.subscribe", "game.unsubscribe", "game.move"]) {
      expect(PENDING_CATALOG.ws_client as readonly string[], t).not.toContain(t);
    }
  });

  it("К-3, К-4, К-7: game.state, game.moved, game.ended перенесены из ws_server", () => {
    for (const t of ["game.state", "game.moved", "game.ended"]) {
      expect(PENDING_CATALOG.ws_server as readonly string[], t).not.toContain(t);
    }
  });

  it("К-3, К-4: прочие команды и события партии E07+ остаются в каталоге", () => {
    for (const t of ["game.draw_offer", "game.takeback_offer", "game.resign", "game.abort", "game.abandonment_choice"]) {
      expect(PENDING_CATALOG.ws_client as readonly string[], t).toContain(t);
    }
    for (const t of ["game.offer", "game.presence", "game.started"]) {
      expect(PENDING_CATALOG.ws_server as readonly string[], t).toContain(t);
    }
  });

  it("К-3, К-4: каталог не пересекается с реализованными сообщениями", () => {
    for (const t of clientTypes()) expect(PENDING_CATALOG.ws_client as readonly string[], t).not.toContain(t);
    for (const t of serverTypes()) expect(PENDING_CATALOG.ws_server as readonly string[], t).not.toContain(t);
  });
});
