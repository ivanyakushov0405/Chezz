// /auth/google/start и /auth/google/callback (API §12.1; SECURITY §4, S30). Вне REST_ROUTES — лимит platform (ADR-0006 п.2).
// Ошибка входа — экран `login-failed`: index.html SPA со статусом 400 на адресе callback (бриф E04, «Решения»).
import { PAGES, safeLocalPath } from "@chezz/protocol";
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AnalyticsService } from "../analytics/service.ts";
import { apiRateLimit } from "../platform/http.ts";
import type { TimeSource } from "../platform/time.ts";
import type { UsersService } from "../users/service.ts";
import { setSessionCookie } from "./api.ts";
import { codeChallenge, randomCodeVerifier, randomNonce, randomState, verifyIdTokenClaims, type OidcProvider } from "./oidc.ts";
import type { AuthService } from "./service.ts";

export const OIDC_COOKIE = "__Host-oidc";
const OIDC_TTL_S = 10 * 60;
const OIDC_COOKIE_OPTIONS = { path: "/", httpOnly: true, secure: true, sameSite: "lax" } as const;
export const START_PATH = "/auth/google/start";
export const CALLBACK_PATH = "/auth/google/callback";

/** Содержимое `__Host-oidc` (подписанная cookie): цель только `login` (удаление — E19, SECURITY §4.1). */
const OidcCookie = z.strictObject({
  purpose: z.literal("login"),
  state: z.string().min(1),
  nonce: z.string().min(1),
  code_verifier: z.string().min(1),
  return_to: z.string(),
});
type OidcCookie = z.infer<typeof OidcCookie>;

const StartQuery = z.object({ return_to: z.string().max(2048).optional() }).loose();
const CallbackQuery = z.object({ state: z.string().optional(), code: z.string().optional(), error: z.string().optional() }).loose();

export interface OidcRouteDeps {
  appOrigin: string;
  clientId: string | null;
  /** null — вход выключен (dev без GOOGLE_*): start сразу ведёт на login-failed. */
  provider: OidcProvider | null;
  time: TimeSource;
  log: FastifyBaseLogger;
  users: UsersService;
  auth: AuthService;
  analytics: AnalyticsService;
  /** Отдать экран login-failed (index.html SPA) со статусом 400. */
  sendLoginFailed: (reply: FastifyReply) => Promise<unknown> | FastifyReply;
}

/** Язык нового User — из браузера (SECURITY §4 п.5, ТЗ §5): `Accept-Language` начинается с ru → ru. */
export function localeFromAcceptLanguage(header: string | undefined): "ru" | "en" {
  return header?.trim().toLowerCase().startsWith("ru") ? "ru" : "en";
}

function clearOidcCookie(reply: FastifyReply): void {
  void reply.clearCookie(OIDC_COOKIE, OIDC_COOKIE_OPTIONS);
}

function readOidcCookie(request: FastifyRequest): OidcCookie | null {
  const raw = request.cookies[OIDC_COOKIE];
  if (raw === undefined) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || unsigned.value === null) return null;
  try {
    const parsed = OidcCookie.safeParse(JSON.parse(unsigned.value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function registerOidcRoutes(app: FastifyInstance, deps: OidcRouteDeps): void {
  const redirectUri = `${deps.appOrigin}${CALLBACK_PATH}`;
  const rateLimit = apiRateLimit();

  app.get(START_PATH, { config: { rateLimit } }, async (request, reply) => {
    const query = StartQuery.safeParse(request.query);
    const returnTo = safeLocalPath(query.success ? query.data.return_to : null, deps.appOrigin);
    if (deps.provider === null) return reply.redirect(redirectUri, 302);
    const state = randomState();
    const nonce = randomNonce();
    const verifier = randomCodeVerifier();
    const cookie: OidcCookie = { purpose: "login", state, nonce, code_verifier: verifier, return_to: returnTo };
    void reply.setCookie(OIDC_COOKIE, JSON.stringify(cookie), { ...OIDC_COOKIE_OPTIONS, maxAge: OIDC_TTL_S, signed: true });
    const url = deps.provider.authorizationUrl({ redirect_uri: redirectUri, state, nonce, code_challenge: await codeChallenge(verifier) });
    return reply.redirect(url, 302);
  });

  app.get(CALLBACK_PATH, { config: { rateLimit } }, async (request, reply) => {
    // __Host-oidc стирается в любом исходе (SECURITY §4 п.2): повтор того же state — login-failed (E-2).
    const saved = readOidcCookie(request);
    clearOidcCookie(reply);
    const fail = (reason: string): Promise<unknown> | FastifyReply => {
      // Причина — в лог; без code, state, токенов (SECURITY §4, §15).
      deps.log.warn({ reason }, "google sign-in failed");
      return deps.sendLoginFailed(reply);
    };
    if (deps.provider === null || deps.clientId === null) return fail("disabled");
    if (saved === null) return fail("no_oidc_cookie");
    const query = CallbackQuery.safeParse(request.query);
    if (!query.success) return fail("query");
    if (query.data.error !== undefined) return fail("provider_error");
    if (query.data.state === undefined || query.data.state !== saved.state) return fail("state");
    if (query.data.code === undefined) return fail("no_code");

    let claims: Record<string, unknown>;
    try {
      claims = await deps.provider.exchange(new URL(request.url, deps.appOrigin), redirectUri, saved);
    } catch (err) {
      deps.log.warn({ reason: "exchange", error: err instanceof Error ? err.name : "unknown" }, "google sign-in failed");
      return deps.sendLoginFailed(reply);
    }
    const checked = verifyIdTokenClaims(claims, { clientId: deps.clientId, nonce: saved.nonce, now: deps.time.wallNow() });
    if (!checked.ok) return fail(`claims_${checked.reason}`);

    const { user, created } = await deps.users.signInWithGoogle(checked.identity, localeFromAcceptLanguage(request.headers["accept-language"]));
    if (user.deleted_at !== null) return fail("deleted");
    if (created) deps.analytics.record({ name: "user_registered", user_id: user.id });
    const { token } = await deps.auth.createSession(user.id);
    setSessionCookie(reply, token);

    // return_to уже проверен safeLocalPath при start (абсолютный href своего origin, S30).
    const target = new URL(saved.return_to);
    const local = `${target.pathname}${target.search}${target.hash}`;
    const destination = deps.users.isOnboarded(user)
      ? target.href
      : `${deps.appOrigin}${PAGES.welcome(local === "/" ? undefined : local)}`;
    return reply.redirect(destination, 302);
  });
}
