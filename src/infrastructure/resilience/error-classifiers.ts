/**
 * Classifies whether a *raw* driver-level error (not one of our own
 * AppErrors) is a known-transient condition worth retrying. Anything not
 * recognized here is treated as permanent — retrying a syntax error or a
 * constraint violation would just waste the retry budget.
 */

// Postgres SQLSTATE codes for conditions that are expected to clear up on
// their own: serialization/deadlock conflicts and short-lived unavailability.
const RETRYABLE_POSTGRES_SQLSTATES = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "53300", // too_many_connections
  "55P03", // lock_not_available
  "57P03", // cannot_connect_now (server starting up / in recovery)
  "08000", // connection_exception
  "08003", // connection_does_not_exist
  "08006", // connection_failure
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
]);

// OS/network-level error codes surfaced by the `pg` driver or Node's `net`
// module when the connection itself is the problem, not a query.
const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
]);

export function isRetryableDatabaseError(error: unknown): boolean {
  const code = extractErrorCode(error);
  return code !== undefined && (RETRYABLE_POSTGRES_SQLSTATES.has(code) || RETRYABLE_NETWORK_CODES.has(code));
}

// Node fs error codes for transient contention (file locked, too many open
// handles, a momentary I/O hiccup). ENOENT/EACCES/ENOSPC are deliberately
// excluded — retrying won't fix a missing file, a permissions error, or a
// full disk within this request's lifetime.
const RETRYABLE_FS_CODES = new Set(["EBUSY", "EAGAIN", "EMFILE", "ENFILE", "EIO"]);

export function isRetryableStorageError(error: unknown): boolean {
  const code = extractErrorCode(error);
  return code !== undefined && RETRYABLE_FS_CODES.has(code);
}

function extractErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}
