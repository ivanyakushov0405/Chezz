// Метрики Prometheus (E03, ADR-0010): свой Registry на экземпляр app, отдельный порт на node:http.
// Не Fastify: нет лимита, строк лога запроса и CORS; через edge порта нет (SECURITY S32).
// Состояние — в замыкании фабрики (ARCHITECTURE §7.2); start/stop — в onReady/onClose.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { collectDefaultMetrics, Gauge, Registry } from "prom-client";

export interface MetricsService {
  /** Поднимает сервер метрик; отклоняется, если порт занят (EC-17). Без конфига — ничего не делает. */
  start(): Promise<void>;
  /** Закрывает сервер; повторный вызов безопасен. */
  stop(): Promise<void>;
  /** Фактический порт после start (для METRICS_PORT=0); null — не запущен. */
  port(): number | null;
}

export interface MetricsDeps {
  config: { host: string; port: number } | null;
  version: string;
}

export function createMetrics(deps: MetricsDeps): MetricsService {
  const registry = new Registry();
  // Наблюдатели GC и event loop живут до конца процесса: без сервера метрик не создаём.
  if (deps.config !== null) collectDefaultMetrics({ register: registry });
  new Gauge({ name: "app_info", help: "Версия сборки", labelNames: ["version"], registers: [registry] }).set(
    { version: deps.version },
    1,
  );

  let server: Server | null = null;

  return {
    async start() {
      if (deps.config === null || server !== null) return;
      const srv = createServer((req, res) => {
        const url = req.url ?? "";
        const cut = url.search(/[?#]/);
        const path = cut === -1 ? url : url.slice(0, cut);
        if (req.method !== "GET" || path !== "/metrics") {
          res.writeHead(404, { "Content-Length": "0" }).end();
          return;
        }
        registry.metrics().then(
          (body) => res.writeHead(200, { "Content-Type": registry.contentType }).end(body),
          () => res.writeHead(500, { "Content-Length": "0" }).end(),
        );
      });
      await new Promise<void>((resolve, reject) => {
        srv.once("error", reject);
        srv.listen(deps.config!.port, deps.config!.host, () => {
          srv.off("error", reject);
          resolve();
        });
      });
      server = srv;
    },
    async stop() {
      const srv = server;
      server = null;
      if (srv === null) return;
      await new Promise<void>((resolve) => {
        srv.close(() => resolve());
        srv.closeAllConnections();
      });
    },
    port() {
      return server === null ? null : (server.address() as AddressInfo).port;
    },
  };
}
