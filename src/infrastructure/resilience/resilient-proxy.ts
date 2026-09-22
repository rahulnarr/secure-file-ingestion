import type { RetryPolicyConfig } from "../../config/env.js";
import type { Logger } from "../logging/logger.js";
import type { Metrics } from "../metrics/metrics.js";
import { withRetry } from "./with-retry.js";

/**
 * Wraps every async method of `target` with the retry policy, purely via
 * composition — the repository/storage implementation itself stays focused
 * on SQL or filesystem calls (Single Responsibility); this is the one place
 * that adds the cross-cutting "retry transient failures" concern, applied
 * in the composition root (container.ts).
 *
 * On final failure (non-retryable, or retries exhausted), the raw
 * driver-level error is wrapped into a typed AppError via `wrapError` so it
 * carries the same observability metadata as every other exception, instead
 * of leaking an unclassified `pg`/`fs` error up to the HTTP boundary.
 */
export function makeResilient<T extends object>(
  target: T,
  policy: RetryPolicyConfig,
  isRetryable: (error: unknown) => boolean,
  wrapError: (cause: unknown, context: { operation: string }) => Error,
  logger: Logger,
  label: string,
  metrics?: Metrics,
): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }

      const operation = `${label}.${String(prop)}`;
      return async (...args: unknown[]) => {
        try {
          return await withRetry(
            () => value.apply(obj, args),
            policy,
            isRetryable,
            logger,
            { operation },
            metrics,
          );
        } catch (cause) {
          throw wrapError(cause, { operation });
        }
      };
    },
  });
}
