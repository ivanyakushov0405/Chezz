// Ошибки REST (API §5): AppError, статусы §5.2, перевод любых ошибок в формат §5.1 (design.md E01, «Перевод ошибок»).
import type { ErrorCode, ErrorResponse } from "@chezz/protocol";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { pathOnly } from "./log.ts";
import type { ErrorContext, ErrorReporter } from "./sentry.ts";

/** HTTP-статус кода (API §5.2). null — код только WebSocket: в REST его не бросают (иначе 500). */
export const HTTP_STATUS: Readonly<Record<ErrorCode, number | null>> = {
  validation_failed: 400,
  invalid_time_control: 400,
  nickname_invalid: 400,
  nickname_reserved: 400,
  unauthenticated: 401,
  onboarding_required: 403,
  origin_forbidden: 403,
  forbidden: 403,
  delete_confirmation_invalid: 403,
  not_found: 404,
  client_outdated: 409,
  onboarding_completed: 409,
  nickname_taken: 409,
  nickname_change_used: 409,
  open_challenge_exists: 409,
  player_busy: 409,
  opponent_busy: 409,
  own_challenge: 409,
  rating_out_of_range: 409,
  challenge_expired: 409,
  challenge_cancelled: 409,
  challenge_taken: 409,
  account_has_active_game: 409,
  game_not_active: 409,
  payload_too_large: 413,
  screenshot_unsupported: 415,
  rate_limited: 429,
  internal: 500,
  too_many_connections: null,
  not_a_participant: null,
  ply_mismatch: null,
  not_your_turn: null,
  illegal_move: null,
  takeback_not_allowed: null,
  abort_not_allowed: null,
  offer_not_open: null,
  own_offer: null,
  abandonment_choice_not_open: null,
};

/** Ошибка, которую бросает сервис или platform; статус ставит обработчик ошибок по HTTP_STATUS. */
export class AppError extends Error {
  override name = "AppError";
  readonly code: ErrorCode;
  /** details §5.1: у validation_failed — {issues}, у rate_limited — {retry_after_ms}, иначе null. */
  readonly details: unknown;

  constructor(code: ErrorCode, details?: unknown) {
    super(code);
    this.code = code;
    this.details = details ?? null;
  }
}

/** Правило проверки в details.issues (API §5.1, P35). */
export type IssueRule = "max" | "min" | "unknown_key" | "type" | "enum" | "format" | "content_type" | "json" | "invalid";
export interface Issue {
  path: string;
  rule: IssueRule;
}

const RULE_BY_ZOD_CODE: Readonly<Record<string, IssueRule>> = {
  too_big: "max",
  too_small: "min",
  unrecognized_keys: "unknown_key",
  invalid_type: "type",
  invalid_value: "enum",
  invalid_format: "format",
};

function joinPath(path: readonly PropertyKey[]): string {
  return path.map((p) => String(p)).join(".");
}

/** Ошибка zod → issues без входных значений (SECURITY §15): только путь и правило. */
export function zodIssues(error: z.ZodError): Issue[] {
  const issues: Issue[] = [];
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) issues.push({ path: joinPath([...issue.path, key]), rule: "unknown_key" });
    } else {
      issues.push({ path: joinPath(issue.path), rule: RULE_BY_ZOD_CODE[issue.code] ?? "invalid" });
    }
  }
  return issues;
}

export function validationError(issues: Issue[]): AppError {
  return new AppError("validation_failed", { issues });
}

/** Короткий английский текст без данных пользователя (API §5.1): «rate_limited» → «Rate limited». */
export function errorMessage(code: ErrorCode): string {
  const text = code.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function errorBody(code: ErrorCode, details: unknown, requestId: string): ErrorResponse {
  return { error: { code, message: errorMessage(code), details: details ?? null, request_id: requestId } };
}

/** Перевод ошибки в код и details. Неизвестное → internal (подробности — только в лог). */
function classify(error: unknown): AppError {
  if (error instanceof AppError) return HTTP_STATUS[error.code] === null ? new AppError("internal") : error;
  if (error instanceof z.ZodError) return validationError(zodIssues(error));
  const fastifyError = error as Partial<FastifyError> | null;
  switch (fastifyError?.code) {
    case "FST_ERR_CTP_BODY_TOO_LARGE":
      return new AppError("payload_too_large");
    case "FST_ERR_CTP_INVALID_MEDIA_TYPE":
    case "FST_ERR_CTP_INVALID_CONTENT_LENGTH":
      return validationError([{ path: "", rule: "content_type" }]);
    case "FST_ERR_CTP_INVALID_JSON_BODY":
    case "FST_ERR_CTP_EMPTY_JSON_BODY":
      return validationError([{ path: "", rule: "json" }]);
    default:
      break;
  }
  const status = fastifyError?.statusCode;
  if (status === 404) return new AppError("not_found");
  if (status === 413) return new AppError("payload_too_large");
  if (typeof status === "number" && status >= 400 && status < 500) return validationError([{ path: "", rule: "invalid" }]);
  return new AppError("internal");
}

/** Контекст события Sentry из запроса: путь без строки запроса, шаблон маршрута, пользователь — только id. */
export function errorContextOf(request: FastifyRequest): ErrorContext {
  const caller = request.caller as FastifyRequest["caller"] | undefined;
  const route = request.routeOptions.url;
  return {
    request_id: request.id,
    method: request.method,
    ...(route !== undefined ? { route } : {}),
    path: pathOnly(request.url),
    ...(caller && caller.who !== "guest" ? { user_id: caller.user_id } : {}),
  };
}

/**
 * Обработчик ошибок Fastify (setErrorHandler): формат §5.1, request_id = X-Request-Id.
 * ≥ 500 — в лог и ровно одно событие Sentry с тем же request_id (API §5.1); 4xx в Sentry не идут (AC-11).
 */
export function createErrorHandler(reporter?: ErrorReporter) {
  return function errorHandler(error: unknown, request: FastifyRequest, reply: FastifyReply): FastifyReply {
    const appError = classify(error);
    const status = HTTP_STATUS[appError.code] ?? 500;
    if (status >= 500) {
      // Причина — в лог с request_id (метка child-логгера запроса); наружу — без подробностей (API §5.1).
      request.log.error({ err: error }, "internal error");
      reporter?.captureException(error, errorContextOf(request));
    }
    return reply.code(status).send(errorBody(appError.code, appError.code === "internal" ? null : appError.details, request.id));
  };
}

/** Обработчик без Sentry (голый Fastify в тестах шлюза). */
export const errorHandler = createErrorHandler();
