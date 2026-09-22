import { ValidationError } from "../errors/domain-errors.js";

export function assertBatchSize(count: number, max: number, emptyMessage: string): void {
  if (count === 0) {
    throw new ValidationError(emptyMessage, "EMPTY_BATCH", { count, max });
  }
  if (count > max) {
    throw new ValidationError(`Batch exceeds max of ${max} files`, "BATCH_TOO_LARGE", { count, max });
  }
}
