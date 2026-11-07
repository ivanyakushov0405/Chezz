import { z } from "zod";
import { ErrorCode } from "./errors.ts";

/** Категория контроля времени (GLOSSARY §6). */
export const Category = z.enum(["bullet", "blitz", "rapid"]);
export type Category = z.infer<typeof Category>;

/** Ошибка REST, формат API §5.1. `details`: у `validation_failed` — `{issues}`, у `rate_limited` — `{retry_after_ms}`, иначе `null`. */
export const ErrorResponse = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.unknown(),
    request_id: z.uuid(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;
