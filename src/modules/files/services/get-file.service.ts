import type { FileRecord } from "../file.types.js";
import type { FileAccessService } from "./file-access.service.js";

export class GetFileService {
  constructor(private readonly access: FileAccessService) {}

  execute(fileId: string, userId: string): Promise<FileRecord> {
    return this.access.getOwned(fileId, userId);
  }
}
