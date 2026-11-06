// «Кто» в HTTP (ADR-0005 п.7). platform об auth не знает: резолвер передаёт app.ts.
// registerRoute и apiRateLimit — задача T-4 E01.
import type { FastifyRequest } from "fastify";

/** Значения «Кто» — столбец API §12: Г (guest), П1 (onboarding), И (player). */
export type Caller =
  | { who: "guest" }
  | { who: "onboarding" | "player"; user_id: string; session_id: string };

export type CallerResolver = (req: FastifyRequest) => Promise<Caller>;

const GUEST: Caller = Object.freeze({ who: "guest" });

/** Резолвер до фичи auth: любой запрос, в том числе с cookie, — гость (EC-5). */
export const alwaysGuest: CallerResolver = () => Promise.resolve(GUEST);

declare module "fastify" {
  interface FastifyRequest {
    caller: Caller;
  }
}
