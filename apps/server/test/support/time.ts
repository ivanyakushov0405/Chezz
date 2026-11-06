// ManualTimeSource — управляемое время для тестов сервера (TESTING §7.2; EC-4).
import type { TimeSource, TimerId } from "../../src/platform/time.ts";

interface PendingTimer {
  id: number;
  deadline: number;
  fn: () => void;
}

export class ManualTimeSource implements TimeSource {
  private current: number;
  private readonly wallStart: number;
  private readonly monoStart: number;
  private nextId = 1;
  private readonly timers = new Map<number, PendingTimer>();

  constructor(start?: { now?: number; wall?: Date }) {
    this.current = start?.now ?? 0;
    this.monoStart = this.current;
    this.wallStart = (start?.wall ?? new Date("2026-01-01T00:00:00.000Z")).getTime();
  }

  now(): number {
    return this.current;
  }

  wallNow(): Date {
    return new Date(this.wallStart + (this.current - this.monoStart));
  }

  setTimer(ms: number, fn: () => void): TimerId {
    const id = this.nextId++;
    this.timers.set(id, { id, deadline: this.current + Math.max(0, ms), fn });
    return id as unknown as TimerId;
  }

  clearTimer(id: TimerId): void {
    this.timers.delete(id as unknown as number);
  }

  /** Число ещё не сработавших таймеров (для проверок в тестах). */
  pendingTimers(): number {
    return this.timers.size;
  }

  /**
   * Сдвигает оба вида времени на ms. Таймеры с дедлайном ≤ now+ms срабатывают синхронно,
   * по возрастанию дедлайна (при равных — в порядке постановки), в том числе поставленные
   * обработчиком внутри окна; now() в обработчике равен его дедлайну. Затем ждёт простоя (хуки — E06).
   */
  async advance(ms: number): Promise<void> {
    if (!(ms >= 0)) throw new RangeError("advance(ms): ms must be >= 0");
    const target = this.current + ms;
    for (;;) {
      let next: PendingTimer | undefined;
      for (const t of this.timers.values()) {
        if (t.deadline <= target && (next === undefined || t.deadline < next.deadline || (t.deadline === next.deadline && t.id < next.id))) {
          next = t;
        }
      }
      if (next === undefined) break;
      this.timers.delete(next.id);
      this.current = next.deadline;
      next.fn();
    }
    this.current = target;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
