// rating: Glicko-2, Rating, RatingHistory (ARCHITECTURE §7.1, §11). Показ — E11, таблица лидеров — E14.
// Нет строки Rating — значения по умолчанию; строка создаётся первой рейтинговой партией (ROADMAP, пояснение E04/E05).
import type { Category } from "@chezz/protocol";
import type { Database } from "../database.ts";
import type { Db, Trx } from "../platform/db.ts";
import { DEFAULT_GLICKO, rateMany } from "./domain/glicko2.ts";
import { roundRating } from "./domain/display.ts";
import { findRatings, hasHistoryForGame, insertHistory, lockRatings, updateRating, type RatingRow } from "./repo.ts";

/** Rating игрока в категории; `updated_at = null` — партий ещё не было. */
export interface PlayerRating {
  rating: number;
  rd: number;
  volatility: number;
  games_count: number;
  updated_at: Date | null;
}

/** Итог рейтинговой `finished` Game (GLOSSARY раздел 6: `Game.result`). */
export interface RatedResult {
  gameId: string;
  category: Category;
  whiteId: string;
  blackId: string;
  result: "white_wins" | "black_wins" | "draw";
  endedAt: Date;
}

/** Изменение рейтинга обоих, целые до показа — форма `RatingChange` (API §4.2). */
export interface RatingChanges {
  white: { rating_before: number; rating_after: number };
  black: { rating_before: number; rating_after: number };
}

export interface RatingService {
  getRating(userId: string, category: Category): Promise<PlayerRating>;
  /** Rating нескольких игроков одной категории (лобби, подбор); отсутствующие — по умолчанию. */
  getRatings(userIds: readonly string[], category: Category): Promise<Map<string, PlayerRating>>;
  /**
   * В транзакции конца партии (ARCHITECTURE §9.1 п.7): Rating обоих и две строки RatingHistory.
   * Бросает при ошибке — вызывающий откатывает транзакцию целиком.
   */
  applyResult(trx: Trx, result: RatedResult): Promise<RatingChanges>;
}

const DAY_MS = 86_400_000;

const DEFAULT_RATING: Readonly<PlayerRating> = Object.freeze({ ...DEFAULT_GLICKO, games_count: 0, updated_at: null });

function toPlayerRating(row: RatingRow): PlayerRating {
  return { rating: row.rating, rd: row.rd, volatility: row.volatility, games_count: row.games_count, updated_at: row.updated_at };
}

const WHITE_SCORE = { white_wins: 1, black_wins: 0, draw: 0.5 } as const;

export function createRatingService(deps: { db: Db<Database> }): RatingService {
  const { db } = deps;

  const getRatings = async (userIds: readonly string[], category: Category): Promise<Map<string, PlayerRating>> => {
    const rows = await findRatings(db, userIds, category);
    const byId = new Map(rows.map((r) => [r.user_id, toPlayerRating(r)]));
    return new Map(userIds.map((id) => [id, byId.get(id) ?? { ...DEFAULT_RATING }]));
  };

  return {
    async getRating(userId, category) {
      return (await getRatings([userId], category)).get(userId) ?? { ...DEFAULT_RATING };
    },

    getRatings,

    async applyResult(trx, r) {
      if (r.whiteId === r.blackId) throw new Error("rating.applyResult: white and black are the same user");
      // Повтор партии (E-1) — понятная ошибка до записи; одновременный повтор ловит PK rating_history.
      if (await hasHistoryForGame(trx, r.gameId)) throw new Error("rating.applyResult: game already rated");
      // Новая строка получает updated_at = endedAt: рост RD до первой партии — 0 (ARCHITECTURE §11).
      const rows = await lockRatings(trx, [r.whiteId, r.blackId], r.category, {
        ...DEFAULT_GLICKO,
        games_count: 0,
        updated_at: r.endedAt,
      });
      const white = rows.find((row) => row.user_id === r.whiteId);
      const black = rows.find((row) => row.user_id === r.blackId);
      if (!white || !black) throw new Error("rating.applyResult: rating rows not locked");

      const whiteScore = WHITE_SCORE[r.result];
      const next = (self: RatingRow, opp: RatingRow, score: 0 | 0.5 | 1): RatingRow => {
        const elapsedDays = Math.max(0, r.endedAt.getTime() - self.updated_at.getTime()) / DAY_MS;
        const rated = rateMany(self, [{ opponent: { rating: opp.rating, rd: opp.rd }, score }], elapsedDays);
        // Часы сервера сдвинулись назад — updated_at не уходит в прошлое (лишний рост RD в следующей партии).
        const updatedAt = r.endedAt > self.updated_at ? r.endedAt : self.updated_at;
        return { ...self, ...rated, games_count: self.games_count + 1, updated_at: updatedAt };
      };
      // Оба считаются от состояния до партии (одновременный пересчёт).
      const whiteAfter = next(white, black, whiteScore);
      const blackAfter = next(black, white, (1 - whiteScore) as 0 | 0.5 | 1);

      await updateRating(trx, whiteAfter);
      await updateRating(trx, blackAfter);
      await insertHistory(trx, [
        { user_id: white.user_id, category: r.category, game_id: r.gameId, rating_before: white.rating, rating_after: whiteAfter.rating, created_at: r.endedAt },
        { user_id: black.user_id, category: r.category, game_id: r.gameId, rating_before: black.rating, rating_after: blackAfter.rating, created_at: r.endedAt },
      ]);

      return {
        white: { rating_before: roundRating(white.rating), rating_after: roundRating(whiteAfter.rating) },
        black: { rating_before: roundRating(black.rating), rating_after: roundRating(blackAfter.rating) },
      };
    },
  };
}
