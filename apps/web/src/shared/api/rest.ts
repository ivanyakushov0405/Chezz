// Клиент REST поверх REST_ROUTES (ARCHITECTURE §12; API §3, §5, §7). Своих типов ответа нет — только схемы protocol.
import { ErrorResponse, PROTOCOL_VERSION, type ErrorCode, type RouteDef } from "@chezz/protocol";
import type { z } from "zod";

/** Код ошибки для интерфейса: `error.<code>` (DESIGN §11); `network` — нет ответа сервера, `unknown` — ответ не по формату. */
export type ApiErrorCode = ErrorCode | "network" | "unknown";

export class ApiError extends Error {
  override name = "ApiError";
  readonly code: ApiErrorCode;
  readonly status: number | null;

  constructor(code: ApiErrorCode, status: number | null) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

type Out<S> = S extends z.ZodType ? z.output<S> : undefined;
type In<S> = S extends z.ZodType ? z.input<S> : undefined;

export type ApiInput<R extends RouteDef> = (R["params"] extends z.ZodType ? { params: In<R["params"]> } : { params?: never }) &
  (R["body"] extends z.ZodType ? { body: In<R["body"]> } : { body?: never });

/** Путь с подставленными `:name` (encodeURIComponent). */
export function buildPath(path: string, params: Record<string, unknown> | undefined): string {
  return path.replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(String(params?.[name] ?? "")));
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Вызов операции каталога; ответ разбирается схемой операции. Ошибка — ApiError. */
export async function callApi<R extends RouteDef>(
  def: R,
  input: ApiInput<R>,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
): Promise<Out<R["response"]>> {
  const { params, body } = input as { params?: Record<string, unknown>; body?: unknown };
  const headers: Record<string, string> = { "X-Protocol-Version": String(PROTOCOL_VERSION) };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetchImpl(buildPath(def.path, params), {
      method: def.method,
      headers,
      credentials: "same-origin",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError("network", null);
  }
  const text = await res.text().catch(() => "");
  const json: unknown = text === "" ? undefined : safeJson(text);
  if (!res.ok) {
    const parsed = ErrorResponse.safeParse(json);
    throw new ApiError(parsed.success ? parsed.data.error.code : "unknown", res.status);
  }
  const parsed = def.response.safeParse(json);
  if (!parsed.success) throw new ApiError("unknown", res.status);
  return parsed.data as Out<R["response"]>;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
