// auth: Session, «Кто» (resolveCaller), выход, событие sessions_closed (ARCHITECTURE §7.1, §7.3; SECURITY §5).
// Вход через Google — oidc.ts (шаг 5 E04).
import { createHash, randomBytes } from "node:crypto";
import type { FastifyBaseLogger, FastifyRequest } from "fastify";
import type { AnalyticsService } from "../analytics/service.ts";
import type { Database } from "../database.ts";
import type { Db } from "../platform/db.ts";
import type { Caller, CallerResolver } from "../platform/http.ts";
import { every, type ScheduledTask } from "../platform/schedule.ts";
import type { ErrorReporter } from "../platform/sentry.ts";
import type { TimeSource } from "../platform/time.ts";
import type { UsersService } from "../users/service.ts";
import { deleteExpiredSessions, deleteSession, deleteUserSessions, findValidSession, insertSession, type SessionRow } from "./repo.ts";

/** Cookie Session (S4): `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, без `Domain`. */
export const SESSION_COOKIE = "__Host-sid";
/** Срок Session — 30 дней (ТЗ §4.1 п.5). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

const GUEST: Caller = Object.freeze({ who: "guest" });

/** Событие «Session закрыты» (ARCHITECTURE §7.3): подписчик — realtime (E22). */
export interface SessionsClosedEvent {
  session_ids: string[];
}

export interface AuthService {
  resolveCaller: CallerResolver;
  /** Новая Session; токен — только для cookie (MUST NOT: в теле, логах, URL). */
  createSession(userId: string): Promise<{ token: string; session: SessionRow }>;
  /** «Выйти»: текущая Session. */
  logout(caller: Caller): Promise<void>;
  /** «Выйти со всех устройств»: все Session User. */
  logoutAll(caller: Caller): Promise<void>;
  onSessionsClosed(listener: (event: SessionsClosedEvent) => void): () => void;
  start(): void;
  stop(): Promise<void>;
}

/** SHA-256 токена (S3); в БД — только он. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createAuthService(deps: {
  db: Db<Database>;
  time: TimeSource;
  log: FastifyBaseLogger;
  reporter?: ErrorReporter;
  users: UsersService;
  analytics: AnalyticsService;
}): AuthService {
  const { db, time, users, analytics } = deps;
  const listeners = new Set<(event: SessionsClosedEvent) => void>();

  const publishClosed = (ids: string[]): void => {
    if (ids.length === 0) return;
    const event: SessionsClosedEvent = { session_ids: ids };
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (err) {
        deps.log.error({ err }, "sessions_closed listener failed");
      }
    }
  };

  const cleanup: ScheduledTask = every(
    { time, log: deps.log, ...(deps.reporter ? { reporter: deps.reporter } : {}) },
    { name: "auth.sessions_cleanup", interval_ms: CLEANUP_INTERVAL_MS, run_at_start: true },
    async () => {
      const removed = await deleteExpiredSessions(db, time.wallNow());
      if (removed > 0) deps.log.info({ removed }, "expired sessions removed");
    },
  );

  return {
    async resolveCaller(request: FastifyRequest): Promise<Caller> {
      const token = request.cookies[SESSION_COOKIE];
      if (token === undefined || token === "") return GUEST;
      const session = await findValidSession(db, hashToken(token), time.wallNow());
      if (session === null) return GUEST;
      const user = await users.getUser(session.user_id);
      if (user === null || user.deleted_at !== null) return GUEST;
      analytics.record({ name: "user_active", user_id: user.id });
      return { who: users.isOnboarded(user) ? "player" : "onboarding", user_id: user.id, session_id: session.id };
    },

    async createSession(userId) {
      const token = newSessionToken();
      const created = time.wallNow();
      const session = await insertSession(db, {
        token_hash: hashToken(token),
        user_id: userId,
        created_at: created,
        expires_at: new Date(created.getTime() + SESSION_TTL_MS),
      });
      return { token, session };
    },

    async logout(caller) {
      if (caller.who === "guest") return;
      publishClosed(await deleteSession(db, caller.session_id));
    },

    async logoutAll(caller) {
      if (caller.who === "guest") return;
      publishClosed(await deleteUserSessions(db, caller.user_id));
    },

    onSessionsClosed(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    start() {
      cleanup.start();
    },

    stop() {
      return cleanup.stop();
    },
  };
}
