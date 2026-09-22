import { HttpError } from "./http-error.js";

/** The requested resource doesn't exist (or is scoped out of view for this caller). */
export class NotFoundError extends HttpError {
  constructor(message: string, code = "NOT_FOUND", context?: Record<string, unknown>) {
    super(404, message, code, { context });
  }
}

/** The resource exists but the caller doesn't own it / isn't allowed to act on it. */
export class ForbiddenError extends HttpError {
  constructor(message: string, code = "FORBIDDEN", context?: Record<string, unknown>) {
    super(403, message, code, { context });
  }
}

/** The request is well-formed but fails a business or input validation rule. */
export class ValidationError extends HttpError {
  constructor(message: string, code = "VALIDATION_ERROR", context?: Record<string, unknown>) {
    super(400, message, code, { context });
  }
}

/** The caller did not present valid credentials (missing/invalid X-User-Id today). */
export class UnauthorizedError extends HttpError {
  constructor(message: string, code = "UNAUTHORIZED", context?: Record<string, unknown>) {
    super(401, message, code, { context });
  }
}

/** The resource used to exist / be valid but no longer does (e.g. blob removed). */
export class GoneError extends HttpError {
  constructor(message: string, code = "GONE", context?: Record<string, unknown>) {
    super(410, message, code, { context });
  }
}

/** The request is valid but its payload exceeds a configured size limit. */
export class PayloadTooLargeError extends HttpError {
  constructor(message: string, code = "PAYLOAD_TOO_LARGE", context?: Record<string, unknown>) {
    super(413, message, code, { context });
  }
}
