// Объекты партии (API §4.2, §4.3; значения — GLOSSARY §8). Сервер → клиент: схемы нестрогие (API §1).
import { z } from "zod";
import { Category } from "./common.ts";

export const Color = z.enum(["white", "black"]);
export type Color = z.infer<typeof Color>;

export const GameStatus = z.enum(["active", "finished", "aborted"]);
export type GameStatus = z.infer<typeof GameStatus>;

export const GameResult = z.enum(["white_wins", "black_wins", "draw"]);
export type GameResult = z.infer<typeof GameResult>;

export const Termination = z.enum([
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
]);
export type Termination = z.infer<typeof Termination>;

/** Игрок в партии (API §4.2): `nickname: null` — удалённый; `rating` — до партии или текущий у `active`. */
export const PlayerRef = z.object({
  id: z.string(),
  nickname: z.string().nullable(),
  rating: z.int().nullable(),
  provisional: z.boolean(),
});
export type PlayerRef = z.infer<typeof PlayerRef>;

/** Ход: SAN + остаток часов сходившей стороны после хода с добавкой, мс (GLOSSARY §8). */
export const Move = z.object({ san: z.string(), clock_ms: z.int().nonnegative() });
export type Move = z.infer<typeof Move>;

export const RatingChange = z.object({ rating_before: z.int(), rating_after: z.int() });
export type RatingChange = z.infer<typeof RatingChange>;

export const GameSummary = z.object({
  id: z.string(),
  white: PlayerRef,
  black: PlayerRef,
  category: Category,
  time_base: z.int().nonnegative(),
  time_increment: z.int().nonnegative(),
  rated: z.boolean(),
  status: GameStatus,
  result: GameResult.nullable(),
  termination: Termination.nullable(),
  started_at: z.iso.datetime(),
  ended_at: z.iso.datetime().nullable(),
});
export type GameSummary = z.infer<typeof GameSummary>;

/** Рейтинг обоих после партии; null — рейтинг не менялся. */
export const GameRatings = z.object({ white: RatingChange, black: RatingChange }).nullable();
export type GameRatings = z.infer<typeof GameRatings>;

export const Game = GameSummary.extend({ moves: z.array(Move), ratings: GameRatings });
export type Game = z.infer<typeof Game>;

/** Часы (API §4.3): `running: null` — стоят (до старта, в окне выбора, после конца). */
export const Clock = z.object({ white_ms: z.int().nonnegative(), black_ms: z.int().nonnegative(), running: Color.nullable() });
export type Clock = z.infer<typeof Clock>;

export const Offer = z.object({ by: Color }).nullable();
export type Offer = z.infer<typeof Offer>;

export const Reconnect = z.object({ color: Color, remaining_ms: z.int().nonnegative() }).nullable();
export type Reconnect = z.infer<typeof Reconnect>;

export const AbandonmentChoice = z.object({ remaining_ms: z.int().nonnegative() }).nullable();
export type AbandonmentChoice = z.infer<typeof AbandonmentChoice>;

export const Connected = z.object({ white: z.boolean(), black: z.boolean() });
export type Connected = z.infer<typeof Connected>;
