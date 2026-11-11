import { describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { ManualTimeSource } from "../../test/support/time.ts";
import { every } from "./schedule.ts";

const DAY = 24 * 60 * 60 * 1000;

function fakeLog(): FastifyBaseLogger & { error: ReturnType<typeof vi.fn> } {
  return { error: vi.fn() } as unknown as FastifyBaseLogger & { error: ReturnType<typeof vi.fn> };
}

describe("every (ADR-0007 п.4)", () => {
  it("К-8: run_at_start — запуск при start(), затем раз в interval_ms", async () => {
    const time = new ManualTimeSource();
    const fn = vi.fn(async () => undefined);
    const task = every({ time, log: fakeLog() }, { name: "t", interval_ms: DAY, run_at_start: true }, fn);
    task.start();
    await time.advance(0);
    expect(fn).toHaveBeenCalledTimes(1);
    await time.advance(DAY - 1);
    expect(fn).toHaveBeenCalledTimes(1);
    await time.advance(1);
    expect(fn).toHaveBeenCalledTimes(2);
    await task.stop();
    await time.advance(DAY * 2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("К-8: без run_at_start первый запуск — через interval_ms", async () => {
    const time = new ManualTimeSource();
    const fn = vi.fn(async () => undefined);
    const task = every({ time, log: fakeLog() }, { name: "t", interval_ms: 1000, run_at_start: false }, fn);
    task.start();
    await time.advance(999);
    expect(fn).not.toHaveBeenCalled();
    await time.advance(1);
    expect(fn).toHaveBeenCalledTimes(1);
    await task.stop();
  });

  it("К-8: ошибка запуска — лог и Sentry, расписание продолжается", async () => {
    const time = new ManualTimeSource();
    const log = fakeLog();
    const captureException = vi.fn();
    const reporter = { captureException } as never;
    const fn = vi.fn(async () => {
      throw new Error("boom");
    });
    const task = every({ time, log, reporter }, { name: "cleanup", interval_ms: 1000, run_at_start: true }, fn);
    task.start();
    await time.advance(0);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledTimes(1);
    await time.advance(1000);
    expect(fn).toHaveBeenCalledTimes(2);
    await task.stop();
  });

  it("К-8: следующий запуск ставится после окончания предыдущего — без наложения", async () => {
    const time = new ManualTimeSource();
    let release: () => void = () => undefined;
    let active = 0;
    let maxActive = 0;
    const fn = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((r) => (release = r));
      active--;
    });
    const task = every({ time, log: fakeLog() }, { name: "t", interval_ms: 1000, run_at_start: true }, fn);
    task.start();
    await time.advance(5000);
    expect(fn).toHaveBeenCalledTimes(1);
    release();
    await time.advance(0);
    await time.advance(1000);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
    release();
    await task.stop();
  });

  it("К-8: повторный start() — ошибка; interval_ms ≤ 0 — ошибка", () => {
    const time = new ManualTimeSource();
    const task = every({ time, log: fakeLog() }, { name: "t", interval_ms: 1, run_at_start: false }, async () => undefined);
    task.start();
    expect(() => task.start()).toThrow(/already started/);
    expect(() => every({ time, log: fakeLog() }, { name: "t", interval_ms: 0, run_at_start: false }, async () => undefined)).toThrow();
  });
});
