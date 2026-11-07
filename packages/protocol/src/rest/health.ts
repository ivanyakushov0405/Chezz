import { z } from "zod";

/** `GET /api/health` (API §12.6): не формат раздела 5. */
export const GetHealthResponse = z.object({
  status: z.enum(["ok", "unavailable"]),
});
export type GetHealthResponse = z.infer<typeof GetHealthResponse>;
