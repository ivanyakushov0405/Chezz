// Типы таблиц ratings и rating_history (ADR-0005 п.5).
import type { Category } from "@chezz/protocol";

export interface RatingsTable {
  user_id: string;
  category: Category;
  rating: number;
  rd: number;
  volatility: number;
  games_count: number;
  updated_at: Date;
}

export interface RatingHistoryTable {
  user_id: string;
  category: Category;
  game_id: string;
  rating_before: number;
  rating_after: number;
  created_at: Date;
}

export interface RatingTables {
  ratings: RatingsTable;
  rating_history: RatingHistoryTable;
}
