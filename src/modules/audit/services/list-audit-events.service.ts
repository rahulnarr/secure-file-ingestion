import { HttpError } from "../../../common/errors/http-error.js";
import { assertUuid } from "../../../common/validation/uuid.js";
import type { FileRepository } from "../../files/file.repository.js";
import type { AuditRepository } from "../audit.repository.js";
import type { AuditEvent } from "../audit.types.js";

/**
 * Audit history stays readable after a file is deleted. When the file still
 * exists, ownership comes from the file row; otherwise the caller must have
 * their own audit record for that fileId.
 */
export class ListAuditEventsService {
  constructor(
    private readonly files: FileRepository,
    private readonly audit: AuditRepository,
  ) {}

  async execute(fileId: string, userId: string): Promise<AuditEvent[]> {
    assertUuid(fileId, "fileId");

    const file = await this.files.findById(fileId);
    if (file) {
      if (file.user_id !== userId) {
        throw new HttpError(403, "You do not own this file", "FORBIDDEN");
      }
    } else if (!(await this.audit.existsForFileAndUser(fileId, userId))) {
      throw new HttpError(404, "File not found", "FILE_NOT_FOUND");
    }

    return this.audit.listByFile(fileId);
  }
}
