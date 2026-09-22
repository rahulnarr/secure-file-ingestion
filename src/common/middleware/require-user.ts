import type { MiddlewareHandler } from "hono";
import { HttpError } from "../errors/http-error.js";
import type { AppEnv } from "../types/app-env.js";

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const userId = c.req.header("x-user-id")?.trim();
  if (!userId) {
    throw new HttpError(401, "Missing required header X-User-Id", "MISSING_USER");
  }
  c.set("userId", userId);
  await next();
};
