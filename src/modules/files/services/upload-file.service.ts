import { randomUUID } from "node:crypto";
import { HttpError } from "../../../common/errors/http-error.js";
import type { BlobStorage } from "../../../infrastructure/storage/blob-storage.js";
import type { FileRepository } from "../file.repository.js";
import type { FileRecord, FileUpload } from "../file.types.js";

export class UploadFileService {
  constructor(
    private readonly files: FileRepository,
    private readonly storage: BlobStorage,
    private readonly maxUploadBytes: number,
  ) {}

  async execute(userId: string, upload: FileUpload): Promise<FileRecord> {
    this.validate(userId, upload);

    const id = randomUUID();
    const storagePath = await this.storage.save(id, upload.filename, upload.data);

    try {
      return await this.files.insert({
        id,
        userId,
        filename: upload.filename,
        contentType: upload.contentType || "application/octet-stream",
        sizeBytes: upload.data.byteLength,
        storagePath,
      });
    } catch (error) {
      await this.storage.remove(storagePath);
      throw error;
    }
  }

  private validate(userId: string, upload: FileUpload): void {
    if (!userId.trim()) {
      throw new HttpError(400, "userId is required", "MISSING_USER");
    }
    if (!upload.filename.trim()) {
      throw new HttpError(400, "filename is required", "MISSING_FILENAME");
    }
    if (upload.data.byteLength === 0) {
      throw new HttpError(400, "Empty files are not allowed", "EMPTY_FILE");
    }
    if (upload.data.byteLength > this.maxUploadBytes) {
      throw new HttpError(
        413,
        `File exceeds max size of ${this.maxUploadBytes} bytes`,
        "FILE_TOO_LARGE",
      );
    }
  }
}
