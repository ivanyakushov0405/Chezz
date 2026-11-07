// TimeSource — единственный источник времени и таймеров сервера (ARCHITECTURE §7.2, A27; TESTING §7.2).
// В тестах его заменяет ManualTimeSource (apps/server/test/support/time.ts).

/** Непрозрачный идентификатор таймера: выдаёт и принимает только тот же TimeSource. */
export type TimerId = { readonly __brand: "TimerId" };

export interface TimeSource {
  /** Монотонные миллисекунды (для часов партии и интервалов). */
  now(): number;
  /** Настенное время (для created_at, сроков вызова, 14 дней лидеров). */
  wallNow(): Date;
  setTimer(ms: number, fn: () => void): TimerId;
  clearTimer(id: TimerId): void;
}

/** Системное время процесса app; создаётся в main.ts. */
export function createSystemTimeSource(): TimeSource {
  return {
    now: () => performance.now(),
    wallNow: () => new Date(),
    setTimer: (ms, fn) => setTimeout(fn, ms) as unknown as TimerId,
    clearTimer: (id) => {
      clearTimeout(id as unknown as NodeJS.Timeout);
    },
  };
}
