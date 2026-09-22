import { HttpError } from "../../../common/errors/http-error.js";
import { assertBatchSize } from "../../../common/validation/batch-size.js";
import type { FileRecord, FileUpload } from "../file.types.js";
import type { UploadFileService } from "./upload-file.service.js";

export type BatchUploadResult = {
  uploaded: FileRecord[];
  failed: Array<{ filename: string; error: string; code?: string }>;
};

/** Uploads each file independently so one bad file doesn't abort the batch. */
export class BatchUploadFilesService {
  constructor(
    private readonly uploadFile: UploadFileService,
    private readonly maxBatchSize: number,
  ) {}

  async execute(userId: string, uploads: FileUpload[]): Promise<BatchUploadResult> {
    assertBatchSize(uploads.length, this.maxBatchSize, "At least one file is required");

    const result: BatchUploadResult = { uploaded: [], failed: [] };
    for (const upload of uploads) {
      try {
        result.uploaded.push(await this.uploadFile.execute(userId, upload));
      } catch (error) {
        result.failed.push(
          error instanceof HttpError
            ? { filename: upload.filename, error: error.message, code: error.code }
            : { filename: upload.filename, error: "Upload failed" },
        );
      }
    }
    return result;
  }
}
