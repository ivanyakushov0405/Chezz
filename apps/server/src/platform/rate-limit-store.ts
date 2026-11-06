// Хранилище счётчиков @fastify/rate-limit (ADR-0006, SECURITY §9): в памяти app, своё у каждого buildApp.
// Отличие от встроенного LocalStore: child() возвращает то же хранилище — у ключа (ip:… / user:…)
// один счётчик на все маршруты /api/*, /auth/* и upgrade; особые лимиты отделяются groupId маршрута.
// Время — TimeSource (ARCHITECTURE A27), таймеров нет: после close() ничего не держится.
import type { FastifyRateLimitStore } from "@fastify/rate-limit";
import type { TimeSource } from "./time.ts";

interface Counter {
  current: number;
  windowStart: number;
}

/** Предел числа ключей: старейшие вытесняются (как LRU в LocalStore). */
const MAX_KEYS = 10_000;

export class SharedRateLimitStore implements FastifyRateLimitStore {
  private readonly counters = new Map<string, Counter>();
  private readonly time: TimeSource;

  constructor(time: TimeSource) {
    this.time = time;
  }

  incr(key: string, callback: (error: Error | null, result?: { current: number; ttl: number }) => void, timeWindow: number): void {
    const now = this.time.now();
    let counter = this.counters.get(key);
    if (counter === undefined || counter.windowStart + timeWindow <= now) {
      counter = { current: 0, windowStart: now };
    }
    counter.current += 1;
    // Свежий ключ — в конец Map: вытеснение идёт с начала (давно не встречавшиеся).
    this.counters.delete(key);
    this.counters.set(key, counter);
    if (this.counters.size > MAX_KEYS) {
      const oldest = this.counters.keys().next();
      if (oldest.done !== true) this.counters.delete(oldest.value);
    }
    callback(null, { current: counter.current, ttl: Math.max(1, Math.ceil(counter.windowStart + timeWindow - now)) });
  }

  child(): FastifyRateLimitStore {
    return this;
  }
}
