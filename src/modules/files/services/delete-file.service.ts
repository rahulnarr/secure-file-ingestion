import type { BlobStorage } from "../../../infrastructure/storage/blob-storage.js";
import type { RecordAuditEventService } from "../../audit/services/record-audit-event.service.js";
import type { FileRepository } from "../file.repository.js";
import type { FileAccessService } from "./file-access.service.js";

/**
 * Removes the blob and the file row (cascading its signed links) but keeps a
 * "file_deleted" audit event with a snapshot of what was removed.
 */
export class DeleteFileService {
  constructor(
    private readonly access: FileAccessService,
    private readonly files: FileRepository,
    private readonly storage: BlobStorage,
    private readonly recordAudit: RecordAuditEventService,
  ) {}

  async execute(fileId: string, userId: string): Promise<void> {
    const file = await this.access.getOwned(fileId, userId);

    await this.recordAudit.execute({
      fileId: file.id,
      userId,
      eventType: "file_deleted",
      metadata: {
        filename: file.original_filename,
        sizeBytes: Number(file.size_bytes),
        contentType: file.content_type,
      },
    });

    await this.files.deleteById(file.id);
    await this.storage.remove(file.storage_path);
  }
}
