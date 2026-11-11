// REST модуля auth (API §12.1): logout, logoutAll. Вход через Google (/auth/google/*) — oidc-api.ts (шаг 5).
import { REST_ROUTES } from "@chezz/protocol";
import type { FastifyInstance, FastifyReply } from "fastify";
import { registerRoute } from "../platform/http.ts";
import { SESSION_COOKIE, SESSION_TTL_MS, type AuthService } from "./service.ts";

const SESSION_COOKIE_OPTIONS = { path: "/", httpOnly: true, secure: true, sameSite: "lax" } as const;

/** Ставит `__Host-sid` (S4, `Max-Age` = 30 дней). */
export function setSessionCookie(reply: FastifyReply, token: string): void {
  void reply.setCookie(SESSION_COOKIE, token, { ...SESSION_COOKIE_OPTIONS, maxAge: SESSION_TTL_MS / 1000 });
}

export function clearSessionCookie(reply: FastifyReply): void {
  void reply.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
}

export function registerAuthRoutes(app: FastifyInstance, deps: { auth: AuthService }): void {
  const { auth } = deps;

  registerRoute(app, REST_ROUTES.logout, async ({ caller, reply }) => {
    await auth.logout(caller);
    clearSessionCookie(reply);
    return undefined;
  });

  registerRoute(app, REST_ROUTES.logoutAll, async ({ caller, reply }) => {
    await auth.logoutAll(caller);
    clearSessionCookie(reply);
    return undefined;
  });
}
