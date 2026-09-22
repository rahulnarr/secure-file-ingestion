import type { FileRepository } from "../file.repository.js";
import type { FileRecord } from "../file.types.js";

export class ListFilesService {
  constructor(private readonly files: FileRepository) {}

  execute(userId: string): Promise<FileRecord[]> {
    return this.files.listByUser(userId);
  }
}
