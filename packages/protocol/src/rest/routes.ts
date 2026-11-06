import type { z } from "zod";
import type { ErrorCode } from "../errors.ts";
import { GetHealthResponse } from "./health.ts";

/** Кто вызывает: гость, Session без первого входа (П1), Игрок (API §12). */
export type Who = "guest" | "onboarding" | "player";

export interface RouteDef {
  method: "GET" | "POST" | "PATCH";
  /** Путь с параметрами вида `:id`, как в каталоге API §12. */
  path: string;
  who: readonly Who[];
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  response: z.ZodType;
  /** Код успешного ответа. */
  status: number;
  /** Особые коды маршрута (колонка «Ошибки» каталога). */
  errors: readonly ErrorCode[];
}

/** Реализованные операции. Остальные каталога — в `PENDING_CATALOG` (ADR-0009). */
export const REST_ROUTES = {
  getHealth: {
    method: "GET",
    path: "/api/health",
    who: ["guest", "onboarding", "player"],
    response: GetHealthResponse,
    status: 200,
    errors: [],
  },
} as const satisfies Record<string, RouteDef>;
