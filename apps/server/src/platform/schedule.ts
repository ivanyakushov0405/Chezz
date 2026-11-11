// Периодические задачи (ADR-0007 п.4): every(time, {name, interval_ms, run_at_start}, fn) поверх time.setTimer.
// Следующий запуск ставится после окончания предыдущего (без наложения); ошибка → лог и Sentry, расписание продолжается.
import type { FastifyBaseLogger } from "fastify";
import type { ErrorReporter } from "./sentry.ts";
import type { TimeSource, TimerId } from "./time.ts";

export interface EveryOptions {
  name: string;
  interval_ms: number;
  /** Первый запуск сразу при start() (суточные чистки — пропущенный из-за перезапуска запуск). */
  run_at_start: boolean;
}

export interface ScheduledTask {
  /** Ставит первый запуск; повторный вызов — ошибка. */
  start(): void;
  /** Снимает таймер и ждёт идущий запуск. */
  stop(): Promise<void>;
}

export interface ScheduleDeps {
  time: TimeSource;
  log: FastifyBaseLogger;
  reporter?: ErrorReporter;
}

export function every(deps: ScheduleDeps, options: EveryOptions, fn: () => Promise<void>): ScheduledTask {
  if (!(options.interval_ms > 0)) throw new Error(`every(${options.name}): interval_ms must be > 0`);
  let timer: TimerId | null = null;
  let running: Promise<void> | null = null;
  let started = false;
  let stopped = false;

  const schedule = (ms: number): void => {
    if (stopped) return;
    timer = deps.time.setTimer(ms, run);
  };

  function run(): void {
    timer = null;
    if (stopped) return;
    running = (async () => {
      try {
        await fn();
      } catch (err) {
        deps.log.error({ err, task: options.name }, "scheduled task failed");
        deps.reporter?.captureException(err);
      }
    })().finally(() => {
      running = null;
      schedule(options.interval_ms);
    });
  }

  return {
    start() {
      if (started) throw new Error(`every(${options.name}): already started`);
      started = true;
      if (options.run_at_start) run();
      else schedule(options.interval_ms);
    },
    async stop() {
      stopped = true;
      if (timer !== null) deps.time.clearTimer(timer);
      timer = null;
      await running;
    },
  };
}
