import { describe, expect, it } from "vitest";
import { ConfigError, DEV_APP_ORIGIN, loadConfig } from "./config.ts";

const DB = "postgres://chezz:chezz@127.0.0.1:54329/chezz_dev";

describe("loadConfig", () => {
  it("значения по умолчанию в dev", () => {
    const c = loadConfig({ DATABASE_URL: DB, WEB_DIST_DIR: "no/such/dir" });
    expect(c).toMatchObject({
      appEnv: "dev",
      appOrigin: DEV_APP_ORIGIN,
      host: "127.0.0.1",
      port: 3000,
      rateLimitIpPerMin: 300,
      logLevel: "info",
      databaseUrl: DB,
      webDistDir: null,
    });
  });

  it("staging и prod требуют APP_ORIGIN", () => {
    expect(() => loadConfig({ DATABASE_URL: DB, APP_ENV: "prod" })).toThrow(ConfigError);
    expect(() => loadConfig({ DATABASE_URL: DB, APP_ENV: "staging" })).toThrow(/APP_ORIGIN/);
    expect(loadConfig({ DATABASE_URL: DB, APP_ENV: "prod", APP_ORIGIN: "https://chezz.test/" }).appOrigin).toBe(
      "https://chezz.test",
    );
  });

  it("ошибка называет переменные, но не их значения", () => {
    const secretish = "postgres://user:hunter2@db/x";
    let message = "";
    try {
      loadConfig({ DATABASE_URL: secretish, PORT: "not-a-port", APP_ENV: "qa" });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("PORT");
    expect(message).toContain("APP_ENV");
    expect(message).not.toContain("hunter2");
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("числа и уровень лога из окружения", () => {
    const c = loadConfig({ DATABASE_URL: DB, PORT: "3100", RATE_LIMIT_IP_PER_MIN: "100000", LOG_LEVEL: "warn", HOST: "0.0.0.0" });
    expect(c).toMatchObject({ port: 3100, rateLimitIpPerMin: 100000, logLevel: "warn", host: "0.0.0.0" });
  });
});
