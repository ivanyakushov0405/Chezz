// Sentry клиента (SECURITY §15; OPERATIONS §12.4, O22): конфигурация — только из <meta> (их вставляет сервер).
// Без chezz-sentry-dsn init не вызывается и запросов к Sentry нет. Без Session Replay и трассировки.
// Фильтр — scrubSentryEvent / scrubSentryBreadcrumb из @chezz/protocol, второй реализации нет.
import { scrubSentryBreadcrumb, scrubSentryEvent } from "@chezz/protocol";
import * as Sentry from "@sentry/browser";

function meta(name: string): string | undefined {
  const content = document.querySelector(`meta[name="${name}"]`)?.getAttribute("content")?.trim();
  return content ? content : undefined;
}

let enabled = false;
const reportedKeys = new Set<string>();

/** Вызывать до createRoot. Возвращает true, если SDK инициализирован. */
export function initSentry(): boolean {
  const dsn = meta("chezz-sentry-dsn");
  if (!dsn) return false;
  const environment = meta("chezz-environment");
  const release = meta("chezz-release");
  Sentry.init({
    dsn,
    ...(environment ? { environment } : {}),
    ...(release ? { release } : {}),
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubSentryBreadcrumb(breadcrumb),
  });
  enabled = true;
  return true;
}

/** «Нет ключа перевода» (AC-21, EC-26): одно сообщение на ключ за сессию страницы; без SDK — ничего. */
export function reportMissingI18nKey(key: string): void {
  if (reportedKeys.has(key)) return;
  reportedKeys.add(key);
  if (!enabled) return;
  Sentry.captureMessage(`i18n: missing key "${key}"`, "error");
}

/** Только для тестов. */
export function resetSentryForTests(): void {
  enabled = false;
  reportedKeys.clear();
}
