import type { ErrorHandler, NotFoundHandler } from "hono";
import type { Logger } from "../../infrastructure/logging/logger.js";
import type { Metrics } from "../../infrastructure/metrics/metrics.js";
import { AppError } from "./app-error.js";
import { HttpError } from "./http-error.js";
import { DatabaseError, RetryExhaustedError, StorageError } from "./infrastructure-errors.js";

/**
 * Every exception that reaches the HTTP boundary is logged AND counted here
 * — full structured context (request method/path plus the error's own
 * metadata) via the logger, and a `service_errors_total{layer,code,
 * retryable}` increment via metrics. This is the one place guaranteed to
 * see every unhandled failure in the service, regardless of which layer it
 * originated in, which is exactly what makes a single choke point useful
 * for both debugging (logs) and alerting (metrics).
 */
export function createErrorHandler(logger: Logger, metrics: Metrics): ErrorHandler {
  return (err, c) => {
    const requestContext = { method: c.req.method, path: c.req.path };

    if (err instanceof AppError) {
      const level = err.statusCode >= 500 ? "error" : "warn";
      logger[level]({ ...requestContext, ...err.toLogObject() }, "request failed");
      metrics.recordServiceError(deriveLayer(err), err.code, err.isRetryable);
      return c.json({ error: err.message, code: err.code }, err.statusCode as 400);
    }

    logger.error(
      { ...requestContext, name: err.name, message: err.message, stack: err.stack },
      "unhandled error",
    );
    metrics.recordServiceError("unknown", "INTERNAL", false);
    return c.json({ error: "Internal server error", code: "INTERNAL" }, 500);
  };
}

export function createNotFoundHandler(logger: Logger): NotFoundHandler {
  return (c) => {
    logger.warn({ method: c.req.method, path: c.req.path }, "route not found");
    return c.json({ error: "Not found", code: "NOT_FOUND" }, 404);
  };
}

/**
 * Maps an AppError to the architectural layer it came from, for metric
 * cardinality that's useful to alert on (e.g. "database layer error rate")
 * without exploding into one label value per error code.
 */
function deriveLayer(error: AppError): "domain" | "database" | "storage" | "unknown" {
  if (error instanceof DatabaseError) return "database";
  if (error instanceof StorageError) return "storage";
  if (error instanceof RetryExhaustedError) {
    const operation = String(error.context?.operation ?? "");
    if (operation.startsWith("BlobStorage")) return "storage";
    if (operation) return "database";
    return "unknown";
  }
  // Every domain error (ValidationError, NotFoundError, ForbiddenError,
  // UnauthorizedError, GoneError, PayloadTooLargeError) extends HttpError,
  // so this catches all of them without listing each individually.
  if (error instanceof HttpError) return "domain";
  return "unknown";
}
