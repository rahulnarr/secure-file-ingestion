import { HttpError } from "../errors/http-error.js";

export function assertBatchSize(count: number, max: number, emptyMessage: string): void {
  if (count === 0) {
    throw new HttpError(400, emptyMessage, "EMPTY_BATCH");
  }
  if (count > max) {
    throw new HttpError(400, `Batch exceeds max of ${max} files`, "BATCH_TOO_LARGE");
  }
}
