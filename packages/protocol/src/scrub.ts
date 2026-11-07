import { maskChallengeIds } from "./mask.ts";

// Фильтр событий и хлебных крошек Sentry сервера и клиента (SECURITY §15, S37): один и тот же
// в beforeSend, beforeSendTransaction и beforeBreadcrumb. Типы структурные — без зависимости от @sentry/*.

// Поля, которые фильтр не трогает, перечислены как `unknown`: без них TypeScript отвергает «слабый тип» (крошка или
// событие без общих с ним полей). Индексной сигнатуры нет — иначе интерфейсы @sentry/* не подошли бы под ограничение.

/** Хлебная крошка Sentry: поля, которые читает фильтр, и прочие известные поля. */
export interface SentryBreadcrumbLike {
  type?: unknown;
  category?: unknown;
  level?: unknown;
  timestamp?: unknown;
  event_id?: unknown;
  message?: string | undefined;
  data?: { [key: string]: unknown } | undefined;
}

/** Событие Sentry (ошибка или трассировка): поля, которые читает фильтр, и прочие известные поля. */
export interface SentryEventLike {
  event_id?: unknown;
  type?: unknown;
  level?: unknown;
  platform?: unknown;
  timestamp?: unknown;
  environment?: unknown;
  release?: unknown;
  tags?: unknown;
  extra?: unknown;
  contexts?: unknown;
  fingerprint?: unknown;
  transaction?: string | undefined;
  message?: string | undefined;
  logentry?: { message?: string | undefined; params?: unknown } | undefined;
  exception?:
    | {
        values?:
          | {
              type?: unknown;
              value?: string | undefined;
              stacktrace?: unknown;
              mechanism?: unknown;
            }[]
          | undefined;
      }
    | undefined;
  request?:
    | {
        method?: unknown;
        url?: string | undefined;
        cookies?: unknown;
        headers?: unknown;
        data?: unknown;
        query_string?: unknown;
        env?: unknown;
      }
    | undefined;
  user?:
    | {
        id?: unknown;
        email?: unknown;
        ip_address?: unknown;
        username?: unknown;
      }
    | undefined;
  breadcrumbs?: SentryBreadcrumbLike[] | undefined;
}

type Rec = Record<string, unknown>;

const isRecord = (value: unknown): value is Rec => typeof value === "object" && value !== null;

/** Строка запроса и фрагмент несут `code`/`state` OAuth и прочее — удаляются целиком (SECURITY §15). */
const stripQuery = (url: string): string => url.replace(/[?#][\s\S]*$/, "");

/** Маскирует строковое поле `obj[key]`; с `stripUrl` сначала отрезает `?…` и `#…`. Записывает, только если значение изменилось. */
function scrubText(obj: Rec, key: string, stripUrl = false): void {
  const value = obj[key];
  if (typeof value !== "string") return;
  const next = maskChallengeIds(stripUrl ? stripQuery(value) : value);
  if (next !== value) obj[key] = next;
}

const REQUEST_DROPPED = ["cookies", "headers", "data", "query_string", "env"] as const;
const BREADCRUMB_URLS = ["url", "to", "from"] as const;

function scrubBreadcrumbFields(crumb: unknown): void {
  if (!isRecord(crumb)) return;
  scrubText(crumb, "message");
  const data = crumb["data"];
  if (isRecord(data)) for (const key of BREADCRUMB_URLS) scrubText(data, key, true);
}

function scrubEventFields(event: Rec): void {
  const request = event["request"];
  if (isRecord(request)) {
    for (const key of REQUEST_DROPPED) if (key in request) delete request[key];
    scrubText(request, "url", true);
  }

  if ("user" in event) {
    const user = event["user"];
    const id = isRecord(user) ? user["id"] : undefined;
    if (id === undefined || id === null || id === "") delete event["user"];
    else event["user"] = { id };
  }

  scrubText(event, "transaction");
  scrubText(event, "message");

  const logentry = event["logentry"];
  if (isRecord(logentry)) scrubText(logentry, "message");

  const exception = event["exception"];
  const values = isRecord(exception) ? exception["values"] : undefined;
  if (Array.isArray(values)) for (const value of values) if (isRecord(value)) scrubText(value, "value");

  const breadcrumbs = event["breadcrumbs"];
  if (Array.isArray(breadcrumbs)) for (const crumb of breadcrumbs) scrubBreadcrumbFields(crumb);
}

/**
 * Очищает событие Sentry перед отправкой: удаляет cookie, заголовки, тело, строку запроса и окружение запроса,
 * оставляет у `user` только `id`, маскирует `id` вызова в URL, `transaction`, сообщениях, исключениях и крошках.
 * Не бросает; возвращает тот же объект (мутирует его).
 */
export function scrubSentryEvent<E extends SentryEventLike>(event: E): E {
  try {
    if (isRecord(event)) scrubEventFields(event as Rec);
  } catch {
    // Вход не изменяем дальше: фильтр не должен ронять отправку и приложение.
  }
  return event;
}

/**
 * Очищает хлебную крошку Sentry: маскирует `id` вызова в `message`, `data.url`, `data.to`, `data.from`;
 * у `data.*` удаляет строку запроса и фрагмент. Другие поля не трогает. Не бросает; возвращает тот же объект.
 */
export function scrubSentryBreadcrumb<B extends SentryBreadcrumbLike>(breadcrumb: B): B {
  try {
    scrubBreadcrumbFields(breadcrumb);
  } catch {
    // См. scrubSentryEvent.
  }
  return breadcrumb;
}
