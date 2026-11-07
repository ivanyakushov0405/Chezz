// analytics: record(event) — fire-and-forget, без trx, после коммита сценария вызывающего (A31, ADR-0010).
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import type { Database } from "../database.ts";
import type { Db } from "../platform/db.ts";
import type { ErrorReporter } from "../platform/sentry.ts";
import type { TimeSource } from "../platform/time.ts";
import { insertEvent, type AnalyticsEventRecord } from "./repo.ts";

export type AnalyticsEvent =
  | { name: "user_registered" | "user_active" | "seek_started"; user_id: string }
  | { name: "seek_matched" | "seek_cancelled"; user_id: string; props: { wait_ms: number } }
  | { name: "game_started"; user_id: string; game_id: string }
  | { name: "game_finished"; user_id: string; game_id: string; props: { termination: string; after_restart: boolean } }
  | { name: "analysis_opened"; user_id: string | null; game_id: string };

export interface AnalyticsService {
  /** Не бросает; запись — в фоне, своим соединением пула. */
  record(event: AnalyticsEvent): void;
  /** Ждёт начатые записи; не реджектится. */
  drain(): Promise<void>;
}

const uuid = z.uuid();
const waitProps = z.strictObject({ wait_ms: z.number().int().min(0) });
const finishProps = z.strictObject({ termination: z.string().regex(/^[a-z_]{1,32}$/), after_restart: z.boolean() });

const userOnly = (name: "user_registered" | "user_active" | "seek_started") =>
  z.strictObject({ name: z.literal(name), user_id: uuid });
const seekWait = (name: "seek_matched" | "seek_cancelled") =>
  z.strictObject({ name: z.literal(name), user_id: uuid, props: waitProps });

const eventSchema = z.discriminatedUnion("name", [
  userOnly("user_registered"),
  userOnly("user_active"),
  userOnly("seek_started"),
  seekWait("seek_matched"),
  seekWait("seek_cancelled"),
  z.strictObject({ name: z.literal("game_started"), user_id: uuid, game_id: uuid }),
  z.strictObject({ name: z.literal("game_finished"), user_id: uuid, game_id: uuid, props: finishProps }),
  z.strictObject({ name: z.literal("analysis_opened"), user_id: uuid.nullable(), game_id: uuid }),
]);

/** Только имена ключей (без значений): верхний уровень и props. */
function keysOf(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  const props = (value as { props?: unknown }).props;
  const nested = typeof props === "object" && props !== null ? Object.keys(props).map((k) => `props.${k}`) : [];
  return [...Object.keys(value), ...nested];
}

export function createAnalyticsService(deps: {
  db: Db<Database>;
  time: TimeSource;
  log: FastifyBaseLogger;
  reporter: ErrorReporter;
}): AnalyticsService {
  const pending = new Set<Promise<void>>();
  // user_active: не чаще раза в сутки UTC на пользователя (EC-19, EC-25); смена суток очищает map.
  const activeDay = new Map<string, string>();
  let currentDay = "";

  const write = async (row: AnalyticsEventRecord): Promise<void> => {
    try {
      await insertEvent(deps.db, row);
    } catch (err) {
      deps.log.error({ err }, "analytics event write failed");
      try {
        deps.reporter.captureException(err);
      } catch {
        // отчёт об ошибке не должен ломать вызывающего
      }
    }
  };

  return {
    record(event) {
      try {
        const createdAt = deps.time.wallNow();
        const parsed = eventSchema.safeParse(event);
        if (!parsed.success) {
          const name = (event as { name?: unknown } | null)?.name;
          deps.log.warn({ name: typeof name === "string" ? name : null, keys: keysOf(event) }, "analytics event rejected");
          return;
        }
        const ev = parsed.data;
        if (ev.name === "user_active") {
          const day = createdAt.toISOString().slice(0, 10);
          if (day !== currentDay) {
            activeDay.clear();
            currentDay = day;
          }
          if (activeDay.get(ev.user_id) === day) return;
          activeDay.set(ev.user_id, day);
        }
        const props: Record<string, unknown> = "props" in ev ? ev.props : {};
        const gameId = "game_id" in ev ? ev.game_id : null;
        const task = write({ name: ev.name, user_id: ev.user_id, game_id: gameId, props, created_at: createdAt });
        pending.add(task);
        void task.finally(() => pending.delete(task));
      } catch (err) {
        try {
          deps.log.error({ err }, "analytics event write failed");
        } catch {
          // не бросаем
        }
      }
    },
    async drain() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };
}
