// Конфиг Sentry клиента в <meta> index.html (ADR-0010 п.3; SECURITY §6 — без inline-скриптов).
// Вставку вызывает app.ts при отдаче SPA; модуль seo (публичные страницы) вызовет ту же функцию.
import type { AppEnv } from "./config.ts";

export interface ClientConfig {
  environment: AppEnv;
  release: string;
  /** null — <meta name="chezz-sentry-dsn"> не вставляется, SDK клиента не инициализируется. */
  sentryDsn: string | null;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Экранирование значения атрибута HTML. */
export function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

function meta(name: string, content: string): string {
  return `<meta name="${name}" content="${escapeHtmlAttribute(content)}">`;
}

/** Теги <meta>: chezz-environment, chezz-release и, только при заданном DSN, chezz-sentry-dsn. */
export function clientConfigMetaTags(config: ClientConfig): string {
  const tags = [meta("chezz-environment", config.environment), meta("chezz-release", config.release)];
  if (config.sentryDsn !== null) tags.push(meta("chezz-sentry-dsn", config.sentryDsn));
  return tags.join("\n");
}

/** Вставляет <meta> конфига перед первым </head>; без </head> — в начало документа. Остальной HTML не меняется. */
export function injectClientConfig(html: string, config: ClientConfig): string {
  const tags = `${clientConfigMetaTags(config)}\n`;
  const at = html.search(/<\/head\s*>/i);
  return at === -1 ? tags + html : html.slice(0, at) + tags + html.slice(at);
}
