import { HttpError } from "../../../common/errors/http-error.js";
import { assertUuid } from "../../../common/validation/uuid.js";
import type { FileRepository } from "../file.repository.js";
import type { FileRecord } from "../file.types.js";

/** Single place that resolves a file and enforces ownership. */
export class FileAccessService {
  constructor(private readonly files: FileRepository) {}

  async getById(fileId: string): Promise<FileRecord> {
    assertUuid(fileId, "fileId");
    const file = await this.files.findById(fileId);
    if (!file) {
      throw new HttpError(404, "File not found", "FILE_NOT_FOUND");
    }
    return file;
  }

  async getOwned(fileId: string, userId: string): Promise<FileRecord> {
    const file = await this.getById(fileId);
    if (file.user_id !== userId) {
      throw new HttpError(403, "You do not own this file", "FORBIDDEN");
    }
    return file;
  }
}
