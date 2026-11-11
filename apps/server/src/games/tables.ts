// Тип таблицы games (ADR-0005 п.5, п.6): строка БД — GamesTable; `Game` — только проекция протокола.
import type { Category } from "@chezz/protocol";
import type { ColumnType, Generated } from "kysely";

export type GameStatusValue = "active" | "finished" | "aborted";
export type GameResultValue = "white_wins" | "black_wins" | "draw";
export type TerminationValue =
  | "checkmate"
  | "resignation"
  | "stalemate"
  | "threefold_repetition"
  | "fifty_moves"
  | "insufficient_material"
  | "timeout"
  | "timeout_insufficient_material"
  | "draw_agreement"
  | "abandonment"
  | "no_first_move"
  | "aborted_by_player";

/** Элемент `moves[]` (GLOSSARY §8): SAN и остаток часов сходившей стороны после хода с добавкой, мс. */
export interface MoveRecord {
  san: string;
  clock_ms: number;
}

export interface GamesTable {
  id: Generated<string>;
  white_id: string;
  black_id: string;
  category: Category;
  /** Секунды. */
  time_base: number;
  /** Секунды. */
  time_increment: number;
  rated: boolean;
  status: GameStatusValue;
  result: GameResultValue | null;
  termination: TerminationValue | null;
  pgn: string | null;
  moves: ColumnType<MoveRecord[], string | undefined, string>;
  started_at: Date;
  ended_at: Date | null;
}

export interface GamesTables {
  games: GamesTable;
}
