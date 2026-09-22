import { HttpError } from "../../../common/errors/http-error.js";
import type { RecordAuditEventService } from "../../audit/services/record-audit-event.service.js";
import type { FileRepository } from "../file.repository.js";
import type { FileRecord } from "../file.types.js";
import type { FileAccessService } from "./file-access.service.js";

export class UpdateFileService {
  constructor(
    private readonly access: FileAccessService,
    private readonly files: FileRepository,
    private readonly recordAudit: RecordAuditEventService,
  ) {}

  async execute(
    fileId: string,
    userId: string,
    updates: { filename?: string },
  ): Promise<FileRecord> {
    const file = await this.access.getOwned(fileId, userId);

    if (updates.filename === undefined) {
      throw new HttpError(400, "No updatable fields provided", "NO_UPDATES");
    }
    const filename = updates.filename.trim();
    if (!filename) {
      throw new HttpError(400, "filename cannot be empty", "INVALID_FILENAME");
    }

    const updated = await this.files.updateFilename(file.id, filename);

    await this.recordAudit.execute({
      fileId: file.id,
      userId,
      eventType: "file_renamed",
      metadata: { previousFilename: file.original_filename, filename },
    });

    return updated;
  }
}
