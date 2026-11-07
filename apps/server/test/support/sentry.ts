// Sentry в тестах (design.md E03, «Тестовая инфраструктура»): транспорт в память, сети нет (TESTING §1).
import type { TransportFactory } from "../../src/platform/sentry.ts";

/** DSN, который startApp({ sentry: true }) ставит в конфиг. */
export const TEST_SENTRY_DSN = "https://public@o0.ingest.sentry.io/0";

/** Событие Sentry, как оно ушло в транспорт (после beforeSend, то есть после scrub). */
export type SentryEvent = Record<string, unknown>;

export interface MemorySentryTransport {
  transport: TransportFactory;
  /** События из конвертов (item type "event"), в порядке отправки. */
  events(): SentryEvent[];
}

type Transport = ReturnType<TransportFactory>;
type Envelope = Parameters<Transport["send"]>[0];

export function memorySentryTransport(): MemorySentryTransport {
  const events: SentryEvent[] = [];
  const transport: TransportFactory = () => ({
    send: (envelope: Envelope) => {
      for (const [header, payload] of envelope[1]) {
        if (header.type === "event") events.push(structuredClone(payload) as SentryEvent);
      }
      return Promise.resolve({ statusCode: 200 });
    },
    flush: () => Promise.resolve(true),
  });
  return { transport, events: () => [...events] };
}
