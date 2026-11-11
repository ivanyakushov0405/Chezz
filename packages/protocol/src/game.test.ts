import { describe, expect, it } from "vitest";
import {
  AbandonmentChoice,
  Clock,
  Color,
  Connected,
  Game,
  GameResult,
  GameStatus,
  GameSummary,
  Move,
  Offer,
  PlayerRef,
  RatingChange,
  Reconnect,
  Termination,
} from "./index.ts";

const GAME_ID = "9a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const WHITE_ID = "5b0c1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4";
const BLACK_ID = "6c1d2e3f-4a5b-4c6d-9e7f-8091a2b3c4d5";

const WHITE = { id: WHITE_ID, nickname: "magnus", rating: 1642, provisional: false };
const BLACK = { id: BLACK_ID, nickname: "hikaru", rating: 1580, provisional: true };

const ACTIVE_SUMMARY = {
  id: GAME_ID,
  white: WHITE,
  black: BLACK,
  category: "blitz",
  time_base: 180,
  time_increment: 2,
  rated: true,
  status: "active",
  result: null,
  termination: null,
  started_at: "2026-11-11T10:00:00.000Z",
  ended_at: null,
};

const FINISHED_SUMMARY = {
  ...ACTIVE_SUMMARY,
  status: "finished",
  result: "black_wins",
  termination: "abandonment",
  ended_at: "2026-11-11T10:07:30.000Z",
};

const RATINGS = {
  white: { rating_before: 1642, rating_after: 1633 },
  black: { rating_before: 1580, rating_after: 1592 },
};

const MOVES = [
  { san: "e4", clock_ms: 182000 },
  { san: "e5", clock_ms: 182000 },
  { san: "Nf3", clock_ms: 159180 },
];

describe("перечисления партии (GLOSSARY §8)", () => {
  it("К-3: Color — white, black", () => {
    expect([...Color.options].sort()).toEqual(["black", "white"]);
    expect(Color.safeParse("red").success).toBe(false);
  });

  it("К-3: GameStatus — active, finished, aborted", () => {
    expect([...GameStatus.options].sort()).toEqual(["aborted", "active", "finished"]);
    expect(GameStatus.safeParse("paused").success).toBe(false);
  });

  it("К-3: GameResult — white_wins, black_wins, draw", () => {
    expect([...GameResult.options].sort()).toEqual(["black_wins", "draw", "white_wins"]);
    expect(GameResult.safeParse("white").success).toBe(false);
  });

  it("К-7: Termination — ровно 12 значений GLOSSARY §8", () => {
    const expected = [
      "checkmate",
      "resignation",
      "stalemate",
      "threefold_repetition",
      "fifty_moves",
      "insufficient_material",
      "timeout",
      "timeout_insufficient_material",
      "draw_agreement",
      "abandonment",
      "no_first_move",
      "aborted_by_player",
    ];
    expect([...Termination.options].sort()).toEqual([...expected].sort());
    for (const t of expected) expect(Termination.safeParse(t).success, t).toBe(true);
    expect(Termination.safeParse("flag").success).toBe(false);
    expect(Termination.safeParse("mate").success).toBe(false);
  });
});

describe("Move (API §4.2)", () => {
  it("К-4: пример API §4.2 {san: Nf3, clock_ms: 159180} разбирается", () => {
    expect(Move.parse({ san: "Nf3", clock_ms: 159180 })).toEqual({ san: "Nf3", clock_ms: 159180 });
  });

  it("К-4: clock_ms = 0 допустим", () => {
    expect(Move.safeParse({ san: "Qxf7#", clock_ms: 0 }).success).toBe(true);
  });

  it("К-4: clock_ms отрицательный, дробный или строкой → отказ", () => {
    expect(Move.safeParse({ san: "Nf3", clock_ms: -1 }).success).toBe(false);
    expect(Move.safeParse({ san: "Nf3", clock_ms: 159180.5 }).success).toBe(false);
    expect(Move.safeParse({ san: "Nf3", clock_ms: "159180" }).success).toBe(false);
  });

  it("К-4: без san или без clock_ms → отказ", () => {
    expect(Move.safeParse({ clock_ms: 159180 }).success).toBe(false);
    expect(Move.safeParse({ san: "Nf3" }).success).toBe(false);
  });
});

describe("PlayerRef (API §4.2)", () => {
  it("К-3: игрок с ником и рейтингом разбирается", () => {
    expect(PlayerRef.parse(WHITE)).toEqual(WHITE);
  });

  it("К-3: удалённый игрок (nickname: null) и рейтинг null разбираются", () => {
    const ref = { id: WHITE_ID, nickname: null, rating: null, provisional: false };
    expect(PlayerRef.parse(ref)).toEqual(ref);
  });

  it("К-3: дробный рейтинг, без provisional → отказ", () => {
    expect(PlayerRef.safeParse({ ...WHITE, rating: 1642.5 }).success).toBe(false);
    const { provisional: _p, ...noProvisional } = WHITE;
    expect(PlayerRef.safeParse(noProvisional).success).toBe(false);
  });
});

describe("RatingChange (API §4.2)", () => {
  it("К-7: {rating_before, rating_after} разбирается", () => {
    expect(RatingChange.parse(RATINGS.white)).toEqual(RATINGS.white);
  });

  it("К-7: дробное или отсутствующее значение → отказ", () => {
    expect(RatingChange.safeParse({ rating_before: 1642.5, rating_after: 1633 }).success).toBe(false);
    expect(RatingChange.safeParse({ rating_before: 1642 }).success).toBe(false);
  });
});

describe("GameSummary (API §4.2)", () => {
  it("К-3: active партия — result, termination, ended_at null — разбирается", () => {
    expect(GameSummary.parse(ACTIVE_SUMMARY)).toEqual(ACTIVE_SUMMARY);
  });

  it("К-3, К-7: законченная партия разбирается", () => {
    expect(GameSummary.parse(FINISHED_SUMMARY)).toEqual(FINISHED_SUMMARY);
  });

  it("К-7: aborted — result null, termination задан", () => {
    const aborted = { ...FINISHED_SUMMARY, status: "aborted", result: null, termination: "aborted_by_player" };
    expect(GameSummary.parse(aborted)).toEqual(aborted);
  });

  it("К-3: неизвестные status, result, termination, category → отказ", () => {
    expect(GameSummary.safeParse({ ...ACTIVE_SUMMARY, status: "paused" }).success).toBe(false);
    expect(GameSummary.safeParse({ ...FINISHED_SUMMARY, result: "white" }).success).toBe(false);
    expect(GameSummary.safeParse({ ...FINISHED_SUMMARY, termination: "flag" }).success).toBe(false);
    expect(GameSummary.safeParse({ ...ACTIVE_SUMMARY, category: "classical" }).success).toBe(false);
  });

  it("К-3: started_at и ended_at не ISO datetime → отказ", () => {
    expect(GameSummary.safeParse({ ...ACTIVE_SUMMARY, started_at: "11.11.2026 10:00" }).success).toBe(false);
    expect(GameSummary.safeParse({ ...FINISHED_SUMMARY, ended_at: "вчера" }).success).toBe(false);
    expect(GameSummary.safeParse({ ...ACTIVE_SUMMARY, started_at: null }).success).toBe(false);
  });

  it("К-3: дробный контроль времени, rated не boolean → отказ", () => {
    expect(GameSummary.safeParse({ ...ACTIVE_SUMMARY, time_base: 180.5 }).success).toBe(false);
    expect(GameSummary.safeParse({ ...ACTIVE_SUMMARY, time_increment: 1.5 }).success).toBe(false);
    expect(GameSummary.safeParse({ ...ACTIVE_SUMMARY, rated: "true" }).success).toBe(false);
  });

  it("К-3: white, black — PlayerRef; без white → отказ", () => {
    const { white: _w, ...noWhite } = ACTIVE_SUMMARY;
    expect(GameSummary.safeParse(noWhite).success).toBe(false);
    expect(GameSummary.safeParse({ ...ACTIVE_SUMMARY, black: { id: BLACK_ID } }).success).toBe(false);
  });
});

describe("Game (API §4.2)", () => {
  it("К-3: active Game с ходами и ratings: null разбирается", () => {
    const game = { ...ACTIVE_SUMMARY, moves: MOVES, ratings: null };
    expect(Game.parse(game)).toEqual(game);
  });

  it("К-3: Game без ходов (moves: []) разбирается", () => {
    expect(Game.safeParse({ ...ACTIVE_SUMMARY, moves: [], ratings: null }).success).toBe(true);
  });

  it("К-7: законченная рейтинговая Game с ratings {white, black} разбирается", () => {
    const game = { ...FINISHED_SUMMARY, moves: MOVES, ratings: RATINGS };
    expect(Game.parse(game)).toEqual(game);
  });

  it("К-7: ratings только с одной стороной → отказ", () => {
    const game = { ...FINISHED_SUMMARY, moves: MOVES, ratings: { white: RATINGS.white } };
    expect(Game.safeParse(game).success).toBe(false);
  });

  it("К-3: без moves или без ratings → отказ", () => {
    expect(Game.safeParse({ ...ACTIVE_SUMMARY, ratings: null }).success).toBe(false);
    expect(Game.safeParse({ ...ACTIVE_SUMMARY, moves: MOVES }).success).toBe(false);
  });

  it("К-3: ход с отрицательным clock_ms в moves → отказ", () => {
    const game = { ...ACTIVE_SUMMARY, moves: [{ san: "e4", clock_ms: -1 }], ratings: null };
    expect(Game.safeParse(game).success).toBe(false);
  });
});

describe("Clock (API §4.3)", () => {
  it("К-3: идущие часы чёрных разбираются", () => {
    const clock = { white_ms: 159180, black_ms: 172400, running: "black" };
    expect(Clock.parse(clock)).toEqual(clock);
  });

  it("К-3: running: null (часы стоят) допустим", () => {
    const clock = { white_ms: 180000, black_ms: 180000, running: null };
    expect(Clock.parse(clock)).toEqual(clock);
  });

  it("К-3: running не цвет, без running, дробные мс → отказ", () => {
    expect(Clock.safeParse({ white_ms: 1, black_ms: 1, running: "red" }).success).toBe(false);
    expect(Clock.safeParse({ white_ms: 1, black_ms: 1 }).success).toBe(false);
    expect(Clock.safeParse({ white_ms: 1.5, black_ms: 1, running: null }).success).toBe(false);
  });
});

describe("Offer, Reconnect, AbandonmentChoice, Connected (API §4.3)", () => {
  it("К-3: Offer — null или {by: цвет}", () => {
    expect(Offer.parse(null)).toBeNull();
    expect(Offer.parse({ by: "white" })).toEqual({ by: "white" });
    expect(Offer.safeParse({ by: "red" }).success).toBe(false);
    expect(Offer.safeParse({}).success).toBe(false);
  });

  it("К-3: Reconnect — null или {color, remaining_ms}", () => {
    expect(Reconnect.parse(null)).toBeNull();
    expect(Reconnect.parse({ color: "black", remaining_ms: 60000 })).toEqual({ color: "black", remaining_ms: 60000 });
    expect(Reconnect.safeParse({ color: "black", remaining_ms: 1.5 }).success).toBe(false);
    expect(Reconnect.safeParse({ color: "black" }).success).toBe(false);
  });

  it("К-3: AbandonmentChoice — null или {remaining_ms}", () => {
    expect(AbandonmentChoice.parse(null)).toBeNull();
    expect(AbandonmentChoice.parse({ remaining_ms: 30000 })).toEqual({ remaining_ms: 30000 });
    expect(AbandonmentChoice.safeParse({ remaining_ms: "30000" }).success).toBe(false);
  });

  it("К-3: Connected — {white: boolean, black: boolean}", () => {
    expect(Connected.parse({ white: true, black: false })).toEqual({ white: true, black: false });
    expect(Connected.safeParse({ white: true }).success).toBe(false);
    expect(Connected.safeParse({ white: 1, black: 0 }).success).toBe(false);
    expect(Connected.safeParse(null).success).toBe(false);
  });
});
