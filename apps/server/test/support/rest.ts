// Клиент REST для int-тестов (TESTING §7.3): ставит cookie, Origin своего app и X-Protocol-Version.
import { PROTOCOL_VERSION } from "@chezz/protocol";

export interface RestResponse {
  status: number;
  body: unknown;
  headers: Headers;
  /** Все Set-Cookie ответа. */
  setCookies: string[];
}

export interface RestClient {
  get(path: string): Promise<RestResponse>;
  post(path: string, body?: unknown): Promise<RestResponse>;
  patch(path: string, body: unknown): Promise<RestResponse>;
}

export function rest(baseUrl: string, cookie: string | null = null): RestClient {
  const call = async (method: string, path: string, body?: unknown): Promise<RestResponse> => {
    const headers: Record<string, string> = { "X-Protocol-Version": String(PROTOCOL_VERSION), Origin: baseUrl };
    if (cookie !== null) headers["Cookie"] = cookie;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      redirect: "manual",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed: unknown = null;
    if (text !== "") {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: res.status, body: parsed, headers: res.headers, setCookies: res.headers.getSetCookie() };
  };
  return {
    get: (path) => call("GET", path),
    post: (path, body) => call("POST", path, body),
    patch: (path, body) => call("PATCH", path, body),
  };
}
