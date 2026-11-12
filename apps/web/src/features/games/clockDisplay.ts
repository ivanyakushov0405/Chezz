// Показ часов (API §9.4; DESIGN §9.3, U11): клиент только рисует — флаг фиксирует сервер.
import type { Clock, Color } from "@chezz/protocol";

/** Порог «мало времени» (U11): min(60 с, max(10 с, 12,5% базового времени)), мс. */
export function lowTimeThresholdMs(timeBaseS: number): number {
  return Math.min(60_000, Math.max(10_000, timeBaseS * 125));
}

/**
 * Остаток стороны на момент `now` (`performance.now()`): идущая сторона — `clock.<side>_ms − (now − receivedAt)`,
 * другая — как пришло. `ticking: false` (переподключение) — последние серверные значения без отсчёта (DESIGN §10.3).
 */
export function displayedMs(clock: Clock, side: Color, receivedAt: number, now: number, ticking: boolean): number {
  const base = side === "white" ? clock.white_ms : clock.black_ms;
  if (!ticking || clock.running !== side) return base;
  return Math.max(0, base - (now - receivedAt));
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** `1:02:03`, `2:41`, ниже 10 с — с десятыми: `0:08.4` (DESIGN §9.3). Округление вниз — ноль показывается только на нуле. */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < 10_000) {
    const tenths = Math.floor(clamped / 100);
    return `0:0${Math.floor(tenths / 10)}.${tenths % 10}`;
  }
  const total = Math.floor(clamped / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}
