import { ForbiddenError, NotFoundError } from "../../../common/errors/domain-errors.js";
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
      throw new NotFoundError("File not found", "FILE_NOT_FOUND", { fileId });
    }
    return file;
  }

  async getOwned(fileId: string, userId: string): Promise<FileRecord> {
    const file = await this.getById(fileId);
    if (file.user_id !== userId) {
      throw new ForbiddenError("You do not own this file", "FORBIDDEN", { fileId, userId });
    }
    return file;
  }
}
