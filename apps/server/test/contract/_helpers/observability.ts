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
