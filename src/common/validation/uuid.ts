import { HttpError } from "../errors/http-error.js";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    throw new HttpError(400, `${field} must be a valid UUID`, "INVALID_ID");
  }
}
