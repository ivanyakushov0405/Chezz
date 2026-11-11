import { z } from "zod";
import type { ErrorCode } from "../errors.ts";
import { GetHealthResponse } from "./health.ts";
import { CompleteOnboardingBody, GetMeResponse, MeResponse, UpdateMeBody } from "./me.ts";

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
  /** Код отказа «Кто» вместо общего (API §12.1: `completeOnboarding` Игроку — `onboarding_completed`). */
  refusals?: Partial<Record<Who, ErrorCode>>;
}

const NO_CONTENT = z.undefined();

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
  getMe: {
    method: "GET",
    path: "/api/me",
    who: ["guest", "onboarding", "player"],
    response: GetMeResponse,
    status: 200,
    errors: [],
  },
  completeOnboarding: {
    method: "POST",
    path: "/api/me/onboarding",
    who: ["onboarding"],
    refusals: { player: "onboarding_completed" },
    body: CompleteOnboardingBody,
    response: MeResponse,
    status: 200,
    errors: ["nickname_invalid", "nickname_reserved", "nickname_taken", "onboarding_completed"],
  },
  updateMe: {
    method: "PATCH",
    path: "/api/me",
    who: ["player"],
    body: UpdateMeBody,
    response: MeResponse,
    status: 200,
    errors: [],
  },
  logout: {
    method: "POST",
    path: "/api/auth/logout",
    who: ["onboarding", "player"],
    response: NO_CONTENT,
    status: 204,
    errors: [],
  },
  logoutAll: {
    method: "POST",
    path: "/api/auth/logout-all",
    who: ["onboarding", "player"],
    response: NO_CONTENT,
    status: 204,
    errors: [],
  },
} as const satisfies Record<string, RouteDef>;
