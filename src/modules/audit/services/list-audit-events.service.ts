import { ForbiddenError, NotFoundError } from "../../../common/errors/domain-errors.js";
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
        throw new ForbiddenError("You do not own this file", "FORBIDDEN", { fileId, userId });
      }
    } else if (!(await this.audit.existsForFileAndUser(fileId, userId))) {
      throw new NotFoundError("File not found", "FILE_NOT_FOUND", { fileId });
    }

    return this.audit.listByFile(fileId);
  }
}
