// Логирование app (pino, SECURITY §15): путь без строки запроса, без заголовков и тел,
// redact cookie / authorization / set-cookie. Маскировка id вызова (maskChallengeIds) — E03.
import { LogController, type FastifyReply, type FastifyRequest } from "fastify";
import { pino, type DestinationStream, type Logger, type LoggerOptions } from "pino";

export const REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  'res.headers["set-cookie"]',
  "headers.cookie",
  "headers.authorization",
  'headers["set-cookie"]',
];

/** Путь без строки запроса и фрагмента. */
export function pathOnly(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

type SerializableRequest = { method?: string; url?: string };
type SerializableReply = { statusCode?: number };

export const logSerializers = {
  // Любой объект запроса в логе — только метод и путь (без заголовков, тела, строки запроса).
  req: (req: SerializableRequest) => ({ method: req.method, path: pathOnly(req.url ?? "") }),
  res: (res: SerializableReply) => ({ status: res.statusCode }),
};

export function createLogger(level: string, destination?: DestinationStream): Logger {
  const options: LoggerOptions = {
    level,
    base: null,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    serializers: { ...logSerializers, err: pino.stdSerializers.err },
  };
  return destination ? pino(options, destination) : pino(options);
}

/**
 * Строки лога Fastify о запросе (Fastify LogController): одна строка на запрос — метод, путь,
 * статус, мс, request_id (метка child-логгера), IP, user_id (если не гость). Встроенные
 * «incoming request» и «Route … not found» не пишутся: в них полный URL со строкой запроса.
 * Пример: {"level":30,"request_id":"…","req":{"method":"GET","path":"/api/health"},"status":200,"ms":3,"ip":"127.0.0.1","msg":"request"}
 */
export class RequestLogController extends LogController {
  constructor() {
    super({ requestIdLogLabel: "request_id" });
  }

  override incomingRequest(): void {}

  override routeNotFound(): void {}

  override requestCompleted(error: Error | null | undefined, request: FastifyRequest, reply: FastifyReply): void {
    const caller = request.caller as FastifyRequest["caller"] | undefined;
    const line = {
      req: request,
      status: reply.statusCode,
      ms: Math.round(reply.elapsedTime),
      ip: request.ip,
      ...(caller && caller.who !== "guest" ? { user_id: caller.user_id } : {}),
    };
    if (error) request.log.error({ ...line, err: error }, "request");
    else request.log.info(line, "request");
  }

  override defaultErrorLog(error: Error, _request: FastifyRequest, reply: FastifyReply): void {
    // 4xx уже видны по статусу в строке запроса; текст ошибок разбора может содержать куски тела.
    if (reply.statusCode >= 500) reply.log.error({ err: error }, "unhandled error");
  }
}
