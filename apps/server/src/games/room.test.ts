// GameRoom без БД: очередь команд (A9) — ход и флаг не применяются одновременно; откат при сбое записи.
import type { ServerMessage } from "@chezz/protocol";
import { describe, expect, it } from "vitest";
import { ManualTimeSource } from "../../test/support/time.ts";
import type { WsContext } from "../platform/ws.ts";
import type { GameRow } from "./repo.ts";
import { createGameRoom, FLAG_RETRY_MS, type GameRoomDeps } from "./room.ts";

const WHITE = "11111111-1111-4111-8111-111111111111";
const BLACK = "22222222-2222-4222-8222-222222222222";

function row(moves: { san: string; clock_ms: number }[]): GameRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    white_id: WHITE,
    black_id: BLACK,
    category: "bullet",
    time_base: 60,
    time_increment: 0,
    rated: false,
    status: "active",
    result: null,
    termination: null,
    pgn: null,
    moves,
    started_at: new Date("2026-11-11T12:00:00Z"),
    ended_at: null,
  };
}

function ctx(userId: string, id: string): WsContext & { sent: ServerMessage[] } {
  const sent: ServerMessage[] = [];
  return {
    caller: { who: "player", user_id: userId, session_id: `s-${id}` },
    connection_id: id,
    rtt_ms: null,
    send: (m) => void sent.push(m as ServerMessage),
    onClose: () => undefined,
    sent,
  };
}

function setup(appendMove: GameRoomDeps["appendMove"], finish?: GameRoomDeps["finish"]) {
  const time = new ManualTimeSource();
  const finished: string[] = [];
  const reported: unknown[] = [];
  const deps: GameRoomDeps = {
    time,
    report: (err) => void reported.push(err),
    appendMove,
    finish:
      finish ??
      (async (_row, outcome) => {
        finished.push(outcome.termination);
        return null;
      }),
    ended: () => undefined,
    observeDelivery: () => undefined,
  };
  // После 2 полуходов часы белых идут с now = 0; у белых 1 с.
  const room = createGameRoom(
    row([
      { san: "e4", clock_ms: 1_000 },
      { san: "e5", clock_ms: 60_000 },
    ]),
    { white: { id: WHITE, nickname: "w", rating: null, provisional: false }, black: { id: BLACK, nickname: "b", rating: null, provisional: false } },
    deps,
  );
  return { time, room, finished, reported };
}

describe("GameRoom: очередь (A9)", () => {
  it("К-6 E-2: ход принят до срабатывания флага, запись ещё идёт — флаг ждёт очередь и не срабатывает", async () => {
    let release: () => void = () => undefined;
    const { time, room, finished } = setup(() => new Promise((resolve) => (release = () => resolve(true))));
    const w = ctx(WHITE, "w");
    await room.subscribe(w);
    await time.advance(900);
    const move = room.move(w, "m", 2, "g1f3", time.now());
    await time.advance(100); // дедлайн флага белых — команда встаёт в очередь за ходом
    release();
    await move;
    await room.idle();
    expect(w.sent.map((m) => m.type)).toEqual(["game.state", "game.moved"]);
    expect(finished).toEqual([]);
  });

  it("К-6 E-2: флаг сработал раньше — ход после него получает game_not_active, хода нет", async () => {
    const saved: number[] = [];
    const { time, room, finished } = setup(async (_id, ply) => {
      saved.push(ply);
      return true;
    });
    const w = ctx(WHITE, "w");
    await room.subscribe(w);
    await time.advance(1_000);
    await room.move(w, "late", 2, "g1f3", time.now());
    expect(finished).toEqual(["timeout"]);
    expect(saved).toEqual([]);
    expect(w.sent.map((m) => m.type)).toEqual(["game.state", "game.ended", "error", "game.state"]);
    expect(w.sent[2]).toMatchObject({ code: "game_not_active", ref: "late" });
  });

  it("К-4: сбой записи хода — комната возвращается к позиции до хода", async () => {
    let fail = true;
    const { time, room, reported } = setup(async () => {
      if (fail) throw new Error("db down");
      return true;
    });
    const w = ctx(WHITE, "w");
    await room.subscribe(w);
    await expect(room.move(w, null, 2, "g1f3", time.now())).rejects.toThrow("db down");
    fail = false;
    await room.move(w, null, 2, "g1f3", time.now());
    expect(w.sent.filter((m) => m.type === "game.moved")).toEqual([expect.objectContaining({ ply: 3, san: "Nf3" })]);
    expect(reported).toHaveLength(1);
  });

  it("К-6: сбой записи конца по флагу — ход флагнувшей стороны не проходит, флаг повторяется", async () => {
    let failures = 1;
    const ends: string[] = [];
    const saved: number[] = [];
    const { time, room, reported } = setup(
      async (_id, ply) => {
        saved.push(ply);
        return true;
      },
      async (_row, outcome) => {
        if (failures-- > 0) throw new Error("db down");
        ends.push(outcome.termination);
        return null;
      },
    );
    const w = ctx(WHITE, "w");
    await room.subscribe(w);
    await time.advance(1_000);
    await room.idle();
    expect(reported).toHaveLength(1);
    expect(ends).toEqual([]);
    // Белые ходят после конца времени — это флаг, а не ход.
    await room.move(w, "late", 2, "g1f3", time.now());
    expect(saved).toEqual([]);
    expect(ends).toEqual(["timeout"]);
    expect(w.sent.filter((m) => m.type === "game.moved")).toEqual([]);
    expect(w.sent.at(-1)).toMatchObject({ type: "game.state" });
  });

  it("К-6: сбой записи конца по флагу — повтор через FLAG_RETRY_MS завершает партию без хода", async () => {
    let failures = 1;
    const ends: string[] = [];
    const { time, room } = setup(
      async () => true,
      async (_row, outcome) => {
        if (failures-- > 0) throw new Error("db down");
        ends.push(outcome.termination);
        return null;
      },
    );
    await room.subscribe(ctx(WHITE, "w"));
    await time.advance(1_000);
    await room.idle();
    expect(ends).toEqual([]);
    await time.advance(FLAG_RETRY_MS);
    await room.idle();
    expect(ends).toEqual(["timeout"]);
  });
});
