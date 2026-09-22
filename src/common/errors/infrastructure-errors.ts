import { AppError } from "./app-error.js";

type InfrastructureErrorOptions = {
  cause?: unknown;
  code?: string;
  isRetryable: boolean;
  context?: Record<string, unknown>;
};

/**
 * Wraps a low-level Postgres/driver failure so it carries the same
 * observability metadata as every other exception in the service, instead
 * of a raw `pg` error leaking up as an unclassified 500. `isRetryable`
 * reflects whether the *underlying* failure looked transient — by the time
 * this is thrown, retries (if any) have already been exhausted.
 */
export class DatabaseError extends AppError {
  readonly statusCode = 503;
  readonly code: string;
  readonly isRetryable: boolean;

  constructor(message: string, options: InfrastructureErrorOptions) {
    super(message, { context: options.context, cause: options.cause });
    this.code = options.code ?? "DATABASE_ERROR";
    this.isRetryable = options.isRetryable;
  }
}

/** Same idea as {@link DatabaseError}, for the blob storage backend. */
export class StorageError extends AppError {
  readonly statusCode = 502;
  readonly code: string;
  readonly isRetryable: boolean;

  constructor(message: string, options: InfrastructureErrorOptions) {
    super(message, { context: options.context, cause: options.cause });
    this.code = options.code ?? "STORAGE_ERROR";
    this.isRetryable = options.isRetryable;
  }
}

/**
 * Terminal failure after the retry policy's attempt/time budget ran out on a
 * transient error. Distinct from DatabaseError/StorageError with
 * isRetryable=true so logs can tell "still might succeed on the next
 * request" apart from "we gave up after N attempts over T ms".
 */
export class RetryExhaustedError extends AppError {
  readonly statusCode = 503;
  readonly code = "RETRY_EXHAUSTED";
  readonly isRetryable = false;

  constructor(message: string, options: { cause?: unknown; context?: Record<string, unknown> }) {
    super(message, options);
  }
}
