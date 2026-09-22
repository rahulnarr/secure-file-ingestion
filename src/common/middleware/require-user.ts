import type { MiddlewareHandler } from "hono";
import { UnauthorizedError } from "../errors/domain-errors.js";
import type { AppEnv } from "../types/app-env.js";

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const userId = c.req.header("x-user-id")?.trim();
  if (!userId) {
    throw new UnauthorizedError("Missing required header X-User-Id", "MISSING_USER");
  }
  c.set("userId", userId);
  await next();
};
