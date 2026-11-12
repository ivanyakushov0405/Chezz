// Часы партии (ARCHITECTURE §9.2, A11): чистые функции, время — параметром (§7.2).
// Первый ход каждой стороны время не списывает, добавка начисляется; часы идут с 2-го полухода
// (как в Lichess, решение Ivan — бриф E06, «Вопросы»).
import type { Color } from "@chezz/chess";

/** Потолок компенсации задержки на ход (ТЗ §4.6). */
export const LAG_COMPENSATION_CAP_MS = 1_000;

export interface ClockState {
  white_ms: number;
  black_ms: number;
  /** Чьи часы идут; null — стоят (до 2-го полухода, после конца). */
  running: Color | null;
  /** Монотонное время начала хода стороны `running`; null, если часы стоят. */
  turn_started_at: number | null;
}

/** Компенсация: `min(RTT/2, 1 с)`; RTT не измерен — 0 (A11). */
export function compensationMs(rttMs: number | null): number {
  if (rttMs === null || !(rttMs > 0)) return 0;
  return Math.min(rttMs / 2, LAG_COMPENSATION_CAP_MS);
}

export function initialClock(timeBaseS: number): ClockState {
  const ms = timeBaseS * 1000;
  return { white_ms: ms, black_ms: ms, running: null, turn_started_at: null };
}

const otherColor = (c: Color): Color => (c === "white" ? "black" : "white");
const remainingOf = (s: ClockState, c: Color): number => (c === "white" ? s.white_ms : s.black_ms);
const withRemaining = (s: ClockState, c: Color, ms: number): ClockState =>
  c === "white" ? { ...s, white_ms: ms } : { ...s, black_ms: ms };

/** Остаток стороны на момент `now` без компенсации (для показа и таймера флага); не меньше 0. */
export function remainingAt(state: ClockState, color: Color, now: number): number {
  const base = remainingOf(state, color);
  if (state.running !== color || state.turn_started_at === null) return base;
  return Math.max(0, base - (now - state.turn_started_at));
}

export type ChargeResult =
  | { flagged: false; state: ClockState; clock_ms: number }
  | { flagged: true; state: ClockState };

/**
 * Ход стороны `mover`, после которого в партии станет `plyAfter` полуходов (1 — первый ход белых).
 * Затрачено = now − начало хода − компенсация (не меньше 0); остаток ≤ 0 — флаг (добавки нет); иначе + добавка.
 * Остаток — целые мс. После 2-го полухода часы следующей стороны идут с `now`.
 */
export function chargeMove(
  state: ClockState,
  mover: Color,
  plyAfter: number,
  now: number,
  rttMs: number | null,
  incrementS: number,
): ChargeResult {
  const incrementMs = incrementS * 1000;
  let left = remainingOf(state, mover);
  if (state.running === mover && state.turn_started_at !== null) {
    const spent = Math.max(0, now - state.turn_started_at - compensationMs(rttMs));
    left = Math.round(left - spent);
    if (left <= 0) return { flagged: true, state: { ...withRemaining(state, mover, 0), running: null, turn_started_at: null } };
  }
  const clockMs = left + incrementMs;
  const next = withRemaining(state, mover, clockMs);
  const running = plyAfter >= 2 ? otherColor(mover) : null;
  return { flagged: false, clock_ms: clockMs, state: { ...next, running, turn_started_at: running === null ? null : now } };
}

/** Остановить часы (конец партии): идущая сторона получает остаток на `now`. */
export function stopClock(state: ClockState, now: number): ClockState {
  if (state.running === null) return state;
  const running = state.running;
  return { ...withRemaining(state, running, Math.round(remainingAt(state, running, now))), running: null, turn_started_at: null };
}

/** Часы из `moves[]` (ARCHITECTURE §9.3): остатки — из последнего Move стороны или `time_base`; сторона на ходу — время на начало хода (A10). */
export function clockFromMoves(timeBaseS: number, clocks: readonly number[], now: number): ClockState {
  const state = initialClock(timeBaseS);
  clocks.forEach((ms, i) => {
    if (i % 2 === 0) state.white_ms = ms;
    else state.black_ms = ms;
  });
  if (clocks.length < 2) return state;
  return { ...state, running: clocks.length % 2 === 0 ? "white" : "black", turn_started_at: now };
}
