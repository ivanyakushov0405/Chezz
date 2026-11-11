// REST модуля users (API §12.1): getMe, completeOnboarding, updateMe. Регистрирует app.ts.
import { REST_ROUTES, type GetMeResponse, type MeResponse } from "@chezz/protocol";
import type { FastifyInstance } from "fastify";
import { AppError } from "../platform/errors.ts";
import { registerRoute, type Caller } from "../platform/http.ts";
import type { UsersService } from "./service.ts";

function userIdOf(caller: Caller): string {
  if (caller.who === "guest") throw new AppError("unauthenticated");
  return caller.user_id;
}

export function registerUsersRoutes(app: FastifyInstance, deps: { users: UsersService }): void {
  const { users } = deps;

  registerRoute(app, REST_ROUTES.getMe, async ({ caller }): Promise<GetMeResponse> => {
    if (caller.who === "guest") return { user: null };
    const user = await users.getUser(caller.user_id);
    return { user: user === null ? null : users.toMe(user) };
  });

  registerRoute(app, REST_ROUTES.completeOnboarding, async ({ caller, body }): Promise<MeResponse> => {
    const user = await users.completeOnboarding(userIdOf(caller), body.nickname);
    return { user: users.toMe(user) };
  });

  registerRoute(app, REST_ROUTES.updateMe, async ({ caller, body }): Promise<MeResponse> => {
    const user = await users.updateMe(userIdOf(caller), body);
    return { user: users.toMe(user) };
  });
}
