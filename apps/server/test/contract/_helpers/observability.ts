// Помощники contract-тестов E03: startApp с полями T-2 (appVersion, metrics, metricsUrl) и захват лога.
// Сигнатура — design.md E03, «Тестовая инфраструктура»; реализует разработчик (T-2).
import type { DestinationStream } from "pino";
import { startApp, type StartAppOptions, type TestApp } from "../../support/app.ts";

export type MetricsTestApp = TestApp & { metricsUrl: string };

export interface MetricsAppOptions extends Omit<StartAppOptions, "config"> {
  config?: Record<string, unknown>;
}

export async function startMetricsApp(options: MetricsAppOptions = {}): Promise<MetricsTestApp> {
  return (await startApp(options as StartAppOptions)) as MetricsTestApp;
}

export interface LogCapture {
  stream: DestinationStream;
  raw(): string;
  lines(): Array<Record<string, unknown>>;
}

export function captureLog(): LogCapture {
  const chunks: string[] = [];
  return {
    stream: { write: (chunk: string) => void chunks.push(chunk) },
    raw: () => chunks.join(""),
    lines: () =>
      chunks
        .join("")
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

export function requestPaths(log: LogCapture): string[] {
  return log
    .lines()
    .filter((l) => l["msg"] === "request")
    .map((l) => (l["req"] as { path?: string } | undefined)?.path ?? "");
}

// --- T-3: Sentry сервера и <meta> клиента (design.md E03, «Тестовая инфраструктура», «HTTP») ---

/** Событие Sentry после scrub, как его отдаёт TestApp.sentryEvents(). Поля — только читаемые тестами. */
export interface CapturedSentryEvent {
  event_id?: string;
  level?: string;
  environment?: string;
  release?: string;
  transaction?: string;
  message?: string;
  tags?: Record<string, unknown>;
  user?: Record<string, unknown>;
  request?: Record<string, unknown>;
  exception?: { values?: Array<{ type?: string; value?: string }> };
  [key: string]: unknown;
}

export type SentryTestApp = MetricsTestApp & {
  /** flush + отправленные события (после scrub); без sentry: [] */
  sentryEvents(): Promise<CapturedSentryEvent[]>;
};

export interface SentryAppOptions extends MetricsAppOptions {
  /** true: DSN "https://public@o0.ingest.sentry.io/0" и транспорт в память. */
  sentry?: boolean;
}

/** DSN, который startApp({ sentry: true }) ставит в конфиг (design.md E03, «Тестовая инфраструктура»). */
export const TEST_SENTRY_DSN = "https://public@o0.ingest.sentry.io/0";

export async function startSentryApp(options: SentryAppOptions = {}): Promise<SentryTestApp> {
  return (await startApp(options as StartAppOptions)) as SentryTestApp;
}
