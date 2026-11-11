// HTTP-шлюз platform: «Кто» (ADR-0005 п.7), rate limit (ADR-0006), разбор тела, ошибки (API §5),
// registerRoute (API §3, §7, §15; SECURITY §6, §7, §9). platform об auth не знает: резолвер передаёт app.ts.
import { PROTOCOL_VERSION, type RouteDef, type Who } from "@chezz/protocol";
import fastifyCookie from "@fastify/cookie";
import rateLimit, { normalizeIP, type RateLimitOptions } from "@fastify/rate-limit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError, createErrorHandler, errorBody, validationError, zodIssues } from "./errors.ts";
import { SharedRateLimitStore } from "./rate-limit-store.ts";
import type { ErrorReporter } from "./sentry.ts";
import type { TimeSource } from "./time.ts";

/** Значения «Кто» — столбец API §12: Г (guest), П1 (onboarding), И (player). */
export type Caller = { who: "guest" } | { who: "onboarding" | "player"; user_id: string; session_id: string };

export type CallerResolver = (req: FastifyRequest) => Promise<Caller>;

const GUEST: Caller = Object.freeze({ who: "guest" });

/** Резолвер до фичи auth: любой запрос, в том числе с cookie, — гость (EC-5). */
export const alwaysGuest: CallerResolver = () => Promise.resolve(GUEST);

/** Тело REST ≤ 16 КБ (API §3, SECURITY §9). */
export const BODY_LIMIT_BYTES = 16_384;
/** Базовый лимит (SECURITY §9): 300/мин Игрок; гость — config.rateLimitIpPerMin (300 по умолчанию). */
export const USER_RATE_LIMIT_PER_MIN = 300;
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Что не так с телом запроса; проверяется в registerRoute на шаге схем (порядок — design.md E01). */
export type BodyIssue = "too_large" | "content_type" | "json";

declare module "fastify" {
  interface FastifyRequest {
    caller: Caller;
    bodyIssue: BodyIssue | null;
  }
}

/** Ключ лимита (ADR-0006 п.1): Session (П1 и Игрок) — по User, гость — по адресу сокета (IPv6 — подсеть /64). */
export function rateLimitKey(caller: Caller, ip: string): string {
  return caller.who === "guest" ? `ip:${normalizeIP(ip)}` : `user:${caller.user_id}`;
}

/** Путь под /api (сам /api или /api/…), без строки запроса. */
export function isApiPath(url: string): boolean {
  return /^\/api(?:[/?#]|$)/.test(url);
}

/** Путь WebSocket-шлюза (/ws, API §8.1), без строки запроса. */
export function isWsPath(url: string): boolean {
  return /^\/ws(?:[/?#]|$)/.test(url);
}

/** Любой WebSocket-upgrade (не только /ws: плагин принимает рукопожатие и на других GET) с чужим Origin. */
function isForeignWsUpgrade(request: FastifyRequest, appOrigin: string): boolean {
  return request.headers.upgrade?.toLowerCase() === "websocket" && request.headers.origin !== appOrigin;
}

/** Пути сервера, которые не отдаются SPA-фолбэком (design.md E01). */
const SERVER_PATH = /^\/(?:api|auth|ws)(?:[/?#]|$)/;

export interface RouteRateLimit {
  max: number;
  timeWindowMs: number;
}

/** Настройка config.rateLimit маршрута (ADR-0006 п.2): без opts — общий счётчик ключа; с opts — отдельный (groupId). */
export type RouteRateLimitConfig = RateLimitOptions;

export function apiRateLimit(opts?: RouteRateLimit & { group: string }): RouteRateLimitConfig {
  if (opts === undefined) return { timeWindow: RATE_LIMIT_WINDOW_MS };
  return { max: opts.max, timeWindow: opts.timeWindowMs, groupId: `#${opts.group}` };
}

export interface HttpOptions {
  appOrigin: string;
  rateLimitIpPerMin: number;
  resolveCaller: CallerResolver;
  time: TimeSource;
  /** Секрет подписанных cookie (`__Host-oidc`, SECURITY §4); cookie разбираются до «Кто» (`__Host-sid`). */
  cookieSecret?: string;
  /** GET/HEAD пути вне /api, /auth, /ws без маршрута — например, index.html SPA; нет — 404 not_found. */
  notFoundFallback?: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  /** Sentry: 5xx errorHandler — одно событие на ошибку; нет — только лог. */
  reporter?: ErrorReporter;
}

/** Настройки шлюза на экземпляре (декоратор): registerRoute читает appOrigin. */
const HTTP_OPTIONS = Symbol("chezz.httpOptions");

function httpOptionsOf(app: FastifyInstance): HttpOptions | undefined {
  return app.hasDecorator(HTTP_OPTIONS) ? (app as unknown as Record<symbol, HttpOptions>)[HTTP_OPTIONS] : undefined;
}

function isJsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false;
  const type = value.split(";")[0]?.trim().toLowerCase();
  return type === "application/json";
}

/**
 * Шлюз HTTP на экземпляре Fastify (buildApp; в тестах — голый Fastify).
 * Хуки: onRequest — X-Request-Id и «Кто»; onSend — Cache-Control: no-store на /api;
 * разбор тела не бросает ошибок, а отмечает request.bodyIssue — отказ после Origin, версии и «Кто»,
 * и он считается в лимит (design.md E01, ADR «Проверки в registerRoute»).
 */
export async function installHttp(app: FastifyInstance, options: HttpOptions): Promise<void> {
  if (httpOptionsOf(app) !== undefined) throw new Error("installHttp: already installed");
  app.decorate(HTTP_OPTIONS, options);

  // Cookie разбираются в onRequest плагина — раньше хука «Кто» ниже.
  await app.register(fastifyCookie, options.cookieSecret === undefined ? {} : { secret: options.cookieSecret });
  app.decorateRequest("caller", null as never);
  app.decorateRequest("bodyIssue", null);
  app.addHook("onRequest", async (request, reply) => {
    void reply.header("X-Request-Id", request.id);
    // WebSocket-upgrade: Origin — до проверки Session (SECURITY §6): с чужим Origin Session не читается,
    // отказ 403 — в preValidation ниже (после onRequest @fastify/websocket, который закрывает сокет отказа).
    request.caller = isForeignWsUpgrade(request, options.appOrigin) ? GUEST : await options.resolveCaller(request);
  });
  app.addHook("preValidation", async (request) => {
    if (isForeignWsUpgrade(request, options.appOrigin)) throw new AppError("origin_forbidden");
  });
  app.addHook("onSend", async (request, reply) => {
    if (isApiPath(request.url)) void reply.header("Cache-Control", "no-store");
  });

  app.removeAllContentTypeParsers();
  const parseJson = app.getDefaultJsonParser("error", "error");
  app.addContentTypeParser("*", (request, payload, done) => {
    const fail = (issue: BodyIssue): void => {
      request.bodyIssue = issue;
      done(null, undefined);
    };
    const declared = Number(request.headers["content-length"]);
    if (Number.isFinite(declared) && declared > BODY_LIMIT_BYTES) {
      fail("too_large");
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let finished = false;
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > BODY_LIMIT_BYTES) {
        finished = true;
        payload.removeListener("data", onData);
        // Остаток тела Node дочитает и выбросит сам после ответа.
        fail("too_large");
        return;
      }
      chunks.push(chunk);
    };
    payload.on("data", onData);
    payload.on("error", (err) => {
      if (finished) return;
      finished = true;
      done(err, undefined);
    });
    payload.on("end", () => {
      if (finished) return;
      finished = true;
      if (size === 0) {
        done(null, undefined);
        return;
      }
      if (!isJsonContentType(request.headers["content-type"])) {
        fail("content_type");
        return;
      }
      parseJson(request, Buffer.concat(chunks).toString("utf8"), (err, body) => {
        if (err) fail("json");
        else done(null, body);
      });
    });
  });

  const time = options.time;
  await app.register(rateLimit, {
    global: false,
    hook: "preHandler",
    timeWindow: RATE_LIMIT_WINDOW_MS,
    max: (_request, key) => (key.startsWith("ip:") ? options.rateLimitIpPerMin : USER_RATE_LIMIT_PER_MIN),
    keyGenerator: (request) => rateLimitKey(request.caller, request.ip),
    store: class extends SharedRateLimitStore {
      constructor() {
        super(time);
      }
    },
    errorResponseBuilder: (_request, context) => new AppError("rate_limited", { retry_after_ms: Math.max(1, Math.ceil(context.ttl)) }),
  });

  app.setErrorHandler(createErrorHandler(options.reporter));

  // /api/<нет такого> — 404 в формате §5, со счётчиком лимита (design.md E01, ADR «SPA-фолбэк»).
  const apiLimiter = app.rateLimit(apiRateLimit());
  app.setNotFoundHandler(
    {
      preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
        if (isApiPath(request.url)) await apiLimiter.call(app, request, reply);
      },
    },
    async (request, reply) => {
      const method = request.method;
      if (!SERVER_PATH.test(request.url) && options.notFoundFallback && (method === "GET" || method === "HEAD")) {
        return options.notFoundFallback(request, reply);
      }
      return reply.code(404).send(errorBody("not_found", null, request.id));
    },
  );
}

type Infer<S> = S extends z.ZodType ? z.output<S> : undefined;

export interface RouteContext<R extends RouteDef> {
  caller: Caller;
  params: Infer<R["params"]>;
  query: Infer<R["query"]>;
  body: Infer<R["body"]>;
  request: FastifyRequest;
  /** Статус по умолчанию — def.status; другой успешный (getHealth 503) обработчик ставит reply.code(). */
  reply: FastifyReply;
}

export type RouteResponse<R extends RouteDef> = z.input<R["response"]>;

export interface RegisterRouteOptions {
  /** Особый лимит маршрута (Feedback, SECURITY §9) — свой счётчик; без него — общий 300/мин. */
  rateLimit?: RouteRateLimit;
  /** false — без проверки X-Protocol-Version: /api/health (API §7). */
  checkProtocolVersion?: boolean;
}

const WHO_REFUSAL: Readonly<Record<Who, "unauthenticated" | "onboarding_required" | "forbidden">> = {
  guest: "unauthenticated",
  onboarding: "onboarding_required",
  player: "forbidden",
};

const NO_INPUT = z.undefined();

/** details.issues[].path — путь внутри тела, params или query (API §5.1); значений нет. */
function parsePart<S extends z.ZodType | undefined>(schema: S, value: unknown): unknown {
  const result = (schema ?? NO_INPUT).safeParse(value);
  if (!result.success) throw validationError(zodIssues(result.error));
  return result.data;
}

/**
 * Маршрут /api из REST_ROUTES (API §15). Порядок (после onRequest с «Кто» и preHandler лимита):
 * Origin (POST/PATCH) → X-Protocol-Version → «Кто» → тело, params, query (строгие схемы) → обработчик →
 * def.response.parse(результат) (несовпадение — 500 internal) → def.status.
 */
export function registerRoute<R extends RouteDef>(
  app: FastifyInstance,
  def: R,
  handler: (ctx: RouteContext<R>) => Promise<RouteResponse<R>>,
  opts: RegisterRouteOptions = {},
): void {
  const options = httpOptionsOf(app);
  if (options === undefined) throw new Error("registerRoute: installHttp() first");
  if (!isApiPath(def.path)) throw new Error(`registerRoute: ${def.path} is not under /api`);
  const checkVersion = opts.checkProtocolVersion !== false;
  const changes = def.method === "POST" || def.method === "PATCH";
  const rateLimitConfig = opts.rateLimit
    ? apiRateLimit({ ...opts.rateLimit, group: `${def.method} ${def.path}` })
    : apiRateLimit();

  app.route({
    method: def.method,
    url: def.path,
    config: { rateLimit: rateLimitConfig },
    handler: async (request, reply) => {
      if (changes && request.headers.origin !== options.appOrigin) throw new AppError("origin_forbidden");
      if (checkVersion && request.headers["x-protocol-version"] !== String(PROTOCOL_VERSION)) {
        throw new AppError("client_outdated");
      }
      const caller = request.caller;
      if (!def.who.includes(caller.who)) throw new AppError(def.refusals?.[caller.who] ?? WHO_REFUSAL[caller.who]);

      if (request.bodyIssue === "too_large") throw new AppError("payload_too_large");
      if (request.bodyIssue !== null) throw validationError([{ path: "", rule: request.bodyIssue }]);
      const body = parsePart(def.body, request.body);
      const params = def.params ? parsePart(def.params, request.params) : undefined;
      // Без схемы query строка запроса не читается (например, /api/health?x=1 — тот же ответ).
      const query = def.query ? parsePart(def.query, request.query) : undefined;

      void reply.code(def.status);
      const result = await handler({ caller, params, query, body, request, reply } as RouteContext<R>);
      const parsed = def.response.safeParse(result);
      if (!parsed.success) throw new Error(`response of ${def.method} ${def.path} does not match its schema`);
      return parsed.data;
    },
  });
}
