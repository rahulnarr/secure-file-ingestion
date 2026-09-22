import { DatabaseError, RetryExhaustedError, StorageError } from "../../common/errors/infrastructure-errors.js";
import { isRetryableDatabaseError, isRetryableStorageError } from "./error-classifiers.js";

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function wrapDatabaseError(cause: unknown, context: { operation: string }): Error {
  const retryable = isRetryableDatabaseError(cause);
  return retryable
    ? new RetryExhaustedError(`Database operation "${context.operation}" failed after retries: ${messageOf(cause)}`, {
        cause,
        context,
      })
    : new DatabaseError(`Database operation "${context.operation}" failed: ${messageOf(cause)}`, {
        cause,
        context,
        isRetryable: false,
      });
}

export function wrapStorageError(cause: unknown, context: { operation: string }): Error {
  const retryable = isRetryableStorageError(cause);
  return retryable
    ? new RetryExhaustedError(`Storage operation "${context.operation}" failed after retries: ${messageOf(cause)}`, {
        cause,
        context,
      })
    : new StorageError(`Storage operation "${context.operation}" failed: ${messageOf(cause)}`, {
        cause,
        context,
        isRetryable: false,
      });
}
