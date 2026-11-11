// Фабрики сообщений партии для тестов web (форма — packages/protocol).
import type { Game, GameState } from "@chezz/protocol";

export const GAME_ID = "33333333-3333-4333-8333-333333333333";
export const WHITE_ID = "00000000-0000-4000-8000-000000000001";
export const BLACK_ID = "00000000-0000-4000-8000-000000000002";

export function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: GAME_ID,
    white: { id: WHITE_ID, nickname: "alice", rating: 1500, provisional: true },
    black: { id: BLACK_ID, nickname: "bob", rating: 1620, provisional: false },
    category: "blitz",
    time_base: 180,
    time_increment: 2,
    rated: true,
    status: "active",
    result: null,
    termination: null,
    started_at: "2026-11-11T12:00:00.000Z",
    ended_at: null,
    moves: [],
    ratings: null,
    ...overrides,
  };
}

export function makeState(overrides: Partial<Omit<GameState, "type" | "game">> & { game?: Partial<Game> } = {}): GameState {
  const { game, ...rest } = overrides;
  return {
    type: "game.state",
    game_id: GAME_ID,
    game: makeGame(game),
    clock: { white_ms: 180_000, black_ms: 180_000, running: null },
    your_color: "white",
    draw_offer: null,
    takeback_offer: null,
    connected: { white: true, black: true },
    first_move_ms: null,
    reconnect: null,
    abandonment_choice: null,
    ...rest,
  };
}
