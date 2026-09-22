import type { RetryPolicyConfig } from "../../config/env.js";
import type { Logger } from "../logging/logger.js";
import type { Metrics } from "../metrics/metrics.js";
import { computeBackoffDelay, sleep } from "./backoff.js";

export type RetryContext = {
  /** e.g. "FileRepository.insert" — identifies the operation in logs. */
  operation: string;
};

/**
 * Runs `fn`, retrying with exponential backoff + jitter while `isRetryable`
 * says the failure is transient, up to whichever comes first: `maxAttempts`
 * total tries, or `maxElapsedMs` of wall-clock time — the "limited period"
 * the retry policy is bounded to. Every retry (and the final give-up) is
 * logged with the attempt number and delay, and recorded as a metric, for
 * observability.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicyConfig,
  isRetryable: (error: unknown) => boolean,
  logger: Logger,
  context: RetryContext,
  metrics?: Metrics,
): Promise<T> {
  const startedAt = Date.now();
  let attempt = 0;
  let lastError: unknown;

  while (attempt < policy.maxAttempts) {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const elapsedMs = Date.now() - startedAt;
      const attemptsRemain = attempt < policy.maxAttempts;
      const timeRemains = elapsedMs < policy.maxElapsedMs;

      if (!isRetryable(error) || !attemptsRemain || !timeRemains) {
        logger.error(
          {
            ...context,
            attempt,
            elapsedMs,
            retryable: isRetryable(error),
            err: serializeForLog(error),
          },
          attemptsRemain && timeRemains
            ? "operation failed with a non-retryable error"
            : "retry budget exhausted",
        );
        if (attempt > 1) {
          metrics?.recordRetryExhausted(context.operation);
        }
        throw error;
      }

      metrics?.recordRetryAttempt(context.operation);
      const delayMs = computeBackoffDelay(attempt, policy.baseDelayMs, policy.maxDelayMs);
      logger.warn(
        { ...context, attempt, delayMs, elapsedMs, err: serializeForLog(error) },
        "retrying after transient failure",
      );
      await sleep(delayMs);
    }
  }

  // Unreachable in practice (the loop always returns or throws), but keeps
  // the type checker honest and avoids a silent `undefined` return.
  throw lastError;
}

function serializeForLog(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, code: (error as { code?: unknown }).code };
  }
  return { value: String(error) };
}
