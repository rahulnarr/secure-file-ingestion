import { HttpError } from "../../../common/errors/http-error.js";
import { assertBatchSize } from "../../../common/validation/batch-size.js";
import type { DeleteFileService } from "./delete-file.service.js";

export type BatchDeleteResult = {
  deleted: string[];
  failed: Array<{ fileId: string; error: string; code?: string }>;
};

/** Deletes each file independently so one missing/forbidden id doesn't block the rest. */
export class BatchDeleteFilesService {
  constructor(
    private readonly deleteFile: DeleteFileService,
    private readonly maxBatchSize: number,
  ) {}

  async execute(userId: string, fileIds: string[]): Promise<BatchDeleteResult> {
    assertBatchSize(fileIds.length, this.maxBatchSize, "At least one fileId is required");

    const result: BatchDeleteResult = { deleted: [], failed: [] };
    for (const fileId of fileIds) {
      try {
        await this.deleteFile.execute(fileId, userId);
        result.deleted.push(fileId);
      } catch (error) {
        result.failed.push(
          error instanceof HttpError
            ? { fileId, error: error.message, code: error.code }
            : { fileId, error: "Delete failed" },
        );
      }
    }
    return result;
  }
}
