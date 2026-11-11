// addGauge (E22, шаг 2): gauge модуля читается при каждом запросе /metrics. К-10.
import { afterEach, describe, expect, it } from "vitest";
import { createMetrics, type MetricsService } from "./metrics.ts";

const started: MetricsService[] = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((m) => m.stop()));
});

async function scrape(metrics: MetricsService): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${metrics.port()}/metrics`, { signal: AbortSignal.timeout(5_000) });
  return res.text();
}

describe("addGauge", () => {
  it("К-10: значение gauge — результат collect на момент запроса", async () => {
    const metrics = createMetrics({ config: { host: "127.0.0.1", port: 0 }, version: "test" });
    let value = 3;
    metrics.addGauge({ name: "chezz_test_gauge", help: "тест", collect: () => value });
    await metrics.start();
    started.push(metrics);

    expect(await scrape(metrics)).toMatch(/^chezz_test_gauge 3$/m);
    value = 0;
    expect(await scrape(metrics)).toMatch(/^chezz_test_gauge 0$/m);
  });

  it("К-10: повтор имени — ошибка", () => {
    const metrics = createMetrics({ config: null, version: "test" });
    metrics.addGauge({ name: "chezz_dup", help: "тест", collect: () => 1 });
    expect(() => metrics.addGauge({ name: "chezz_dup", help: "тест", collect: () => 1 })).toThrow();
  });

  it("К-10: два экземпляра не делят реестр", () => {
    const a = createMetrics({ config: null, version: "test" });
    const b = createMetrics({ config: null, version: "test" });
    a.addGauge({ name: "chezz_shared", help: "тест", collect: () => 1 });
    expect(() => b.addGauge({ name: "chezz_shared", help: "тест", collect: () => 1 })).not.toThrow();
  });
});
