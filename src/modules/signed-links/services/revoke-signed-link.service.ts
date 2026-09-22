import { NotFoundError } from "../../../common/errors/domain-errors.js";
import { assertUuid } from "../../../common/validation/uuid.js";
import type { RecordAuditEventService } from "../../audit/services/record-audit-event.service.js";
import type { FileAccessService } from "../../files/services/file-access.service.js";
import type { SignedLinkRepository } from "../signed-link.repository.js";

export class RevokeSignedLinkService {
  constructor(
    private readonly access: FileAccessService,
    private readonly links: SignedLinkRepository,
    private readonly recordAudit: RecordAuditEventService,
  ) {}

  async execute(fileId: string, linkId: string, userId: string): Promise<void> {
    const file = await this.access.getOwned(fileId, userId);
    assertUuid(linkId, "linkId");

    if (!(await this.links.revoke(linkId, file.id))) {
      throw new NotFoundError(
        "Signed link not found or already revoked",
        "SIGNED_LINK_NOT_FOUND",
        { fileId, linkId },
      );
    }

    await this.recordAudit.execute({
      fileId: file.id,
      userId,
      eventType: "signed_link_revoked",
      metadata: { signedLinkId: linkId },
    });
  }
}
