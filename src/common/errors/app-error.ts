/**
 * Common base every custom exception in the service derives from. Carries
 * the metadata the dev team needs to actually debug an incident from a log
 * line alone: a stable machine-readable code, the HTTP status it maps to,
 * whether it's known to be safe to retry, freeform structured context, and
 * a timestamp. Native `Error.cause` (ES2022) is used to keep the original
 * low-level error (a pg driver error, an fs error, ...) attached when one
 * exists, without losing its stack trace.
 */
export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;
  abstract readonly isRetryable: boolean;

  readonly timestamp: string;
  readonly context?: Record<string, unknown>;

  constructor(message: string, options?: { context?: Record<string, unknown>; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = this.constructor.name;
    this.timestamp = new Date().toISOString();
    this.context = options?.context;
  }

  /** Structured representation for logging — never for the HTTP response body. */
  toLogObject(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      statusCode: this.statusCode,
      isRetryable: this.isRetryable,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp,
      cause: serializeCause(this.cause),
      stack: this.stack,
    };
  }
}

function serializeCause(cause: unknown): Record<string, unknown> | undefined {
  if (!(cause instanceof Error)) return undefined;
  return {
    name: cause.name,
    message: cause.message,
    code: (cause as { code?: unknown }).code,
    stack: cause.stack,
  };
}
