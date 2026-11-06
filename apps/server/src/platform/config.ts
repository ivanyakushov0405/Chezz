// Конфиг процесса app из окружения (design.md E01, «Сигнатуры скелета»).
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export type AppEnv = "dev" | "staging" | "prod";

/** То, что получает buildApp (в тестах собирает startApp). */
export interface AppConfig {
  appEnv: AppEnv;
  appOrigin: string;
  rateLimitIpPerMin: number;
  /** Каталог собранного SPA; null — SPA не раздаётся. */
  webDistDir: string | null;
  logLevel: string;
}

/** То, что дополнительно нужно main.ts. */
export type ProcessConfig = AppConfig & { host: string; port: number; databaseUrl: string };

/** Корень репозитория: apps/server/src/platform → ../../../.. */
export const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
export const DEFAULT_WEB_DIST_DIR = path.join(REPO_ROOT, "apps/web/dist");
export const DEV_APP_ORIGIN = "http://localhost:5173";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

const envSchema = z.object({
  APP_ENV: z.enum(["dev", "staging", "prod"]).default("dev"),
  APP_ORIGIN: z.url({ protocol: /^https?$/ }).optional(),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "postgres://…"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  RATE_LIMIT_IP_PER_MIN: z.coerce.number().int().positive().default(300),
  WEB_DIST_DIR: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
});

/** Ошибка конфига: в тексте только имена переменных, не значения (в них может быть пароль БД). */
export class ConfigError extends Error {
  override name = "ConfigError";
}

export function loadConfig(env: NodeJS.ProcessEnv): ProcessConfig {
  // Пустая строка = переменная не задана (так ведут себя compose и .env).
  const cleaned: Record<string, string> = {};
  for (const key of Object.keys(envSchema.shape)) {
    const value = env[key];
    if (value !== undefined && value !== "") cleaned[key] = value;
  }
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "?")))];
    throw new ConfigError(`invalid or missing environment variables: ${names.join(", ")}`);
  }
  const e = parsed.data;
  if (e.APP_ENV !== "dev" && e.APP_ORIGIN === undefined) {
    throw new ConfigError(`APP_ORIGIN is required when APP_ENV=${e.APP_ENV}`);
  }
  const webDistDir = path.resolve(REPO_ROOT, e.WEB_DIST_DIR ?? DEFAULT_WEB_DIST_DIR);
  return {
    appEnv: e.APP_ENV,
    appOrigin: (e.APP_ORIGIN ?? DEV_APP_ORIGIN).replace(/\/+$/, ""),
    rateLimitIpPerMin: e.RATE_LIMIT_IP_PER_MIN,
    webDistDir: existsSync(webDistDir) ? webDistDir : null,
    logLevel: e.LOG_LEVEL,
    host: e.HOST,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
  };
}
