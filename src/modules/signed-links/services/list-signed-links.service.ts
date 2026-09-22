import type { FileAccessService } from "../../files/services/file-access.service.js";
import type { SignedLinkRepository } from "../signed-link.repository.js";
import type { SignedLinkRecord } from "../signed-link.types.js";

export class ListSignedLinksService {
  constructor(
    private readonly access: FileAccessService,
    private readonly links: SignedLinkRepository,
  ) {}

  async execute(fileId: string, userId: string): Promise<SignedLinkRecord[]> {
    const file = await this.access.getOwned(fileId, userId);
    return this.links.listByFile(file.id);
  }
}
