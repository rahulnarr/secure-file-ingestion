import type { ErrorHandler, NotFoundHandler } from "hono";
import type { Logger } from "../../infrastructure/logging/logger.js";
import { AppError } from "./app-error.js";

/**
 * Every exception that reaches the HTTP boundary is logged here with full
 * structured context (request method/path plus the error's own metadata)
 * before it's translated into a response. This is the one place guaranteed
 * to see every unhandled failure in the service, regardless of which layer
 * it originated in.
 */
export function createErrorHandler(logger: Logger): ErrorHandler {
  return (err, c) => {
    const requestContext = { method: c.req.method, path: c.req.path };

    if (err instanceof AppError) {
      const level = err.statusCode >= 500 ? "error" : "warn";
      logger[level]({ ...requestContext, ...err.toLogObject() }, "request failed");
      return c.json({ error: err.message, code: err.code }, err.statusCode as 400);
    }

    logger.error(
      { ...requestContext, name: err.name, message: err.message, stack: err.stack },
      "unhandled error",
    );
    return c.json({ error: "Internal server error", code: "INTERNAL" }, 500);
  };
}

export function createNotFoundHandler(logger: Logger): NotFoundHandler {
  return (c) => {
    logger.warn({ method: c.req.method, path: c.req.path }, "route not found");
    return c.json({ error: "Not found", code: "NOT_FOUND" }, 404);
  };
}
