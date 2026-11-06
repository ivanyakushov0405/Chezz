import { z } from "zod";

/** Все коды ошибок API §5.2 (обе таблицы); отложенных кодов нет (ADR-0009 п.2). */
export const ERROR_CODES = [
  "validation_failed",
  "invalid_time_control",
  "nickname_invalid",
  "nickname_reserved",
  "unauthenticated",
  "onboarding_required",
  "origin_forbidden",
  "forbidden",
  "delete_confirmation_invalid",
  "not_found",
  "client_outdated",
  "onboarding_completed",
  "nickname_taken",
  "nickname_change_used",
  "open_challenge_exists",
  "player_busy",
  "opponent_busy",
  "own_challenge",
  "rating_out_of_range",
  "challenge_expired",
  "challenge_cancelled",
  "challenge_taken",
  "account_has_active_game",
  "game_not_active",
  "payload_too_large",
  "screenshot_unsupported",
  "rate_limited",
  "internal",
  // Только WebSocket
  "too_many_connections",
  "not_a_participant",
  "ply_mismatch",
  "not_your_turn",
  "illegal_move",
  "takeback_not_allowed",
  "abort_not_allowed",
  "offer_not_open",
  "own_offer",
  "abandonment_choice_not_open",
] as const;

export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;
