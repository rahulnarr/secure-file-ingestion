import { AppError } from "./app-error.js";

/**
 * Generic HTTP-facing operational error. Prefer the semantic subclasses in
 * domain-errors.ts (NotFoundError, ForbiddenError, ValidationError,
 * UnauthorizedError) when one fits — they give the dev team a typed,
 * greppable signal instead of "some 4xx happened". HttpError itself stays
 * available for one-off statuses that don't warrant their own class.
 */
export class HttpError extends AppError {
  readonly isRetryable = false;

  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string,
    options?: { context?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, options);
  }
}
