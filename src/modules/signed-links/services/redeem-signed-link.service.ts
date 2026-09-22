import { ForbiddenError } from "../../../common/errors/domain-errors.js";
import type { RecordAuditEventService } from "../../audit/services/record-audit-event.service.js";
import type { SignedLinkRepository } from "../signed-link.repository.js";
import type { SignedLinkRecord } from "../signed-link.types.js";

/**
 * Confirms a cryptographically valid signature was actually issued by this
 * service and is not revoked, auditing the outcome either way.
 */
export class RedeemSignedLinkService {
  constructor(
    private readonly links: SignedLinkRepository,
    private readonly recordAudit: RecordAuditEventService,
  ) {}

  async execute(fileId: string, signature: string): Promise<SignedLinkRecord> {
    const link = await this.links.findByFileAndSignature(fileId, signature);

    if (!link) {
      await this.recordAudit.execute({
        fileId,
        userId: "unknown",
        eventType: "signed_link_download_rejected",
        metadata: { reason: "UNKNOWN_LINK" },
      });
      throw new ForbiddenError("Signed link was not issued by this service", "UNKNOWN_LINK", {
        fileId,
      });
    }

    if (link.revoked_at) {
      await this.recordAudit.execute({
        fileId,
        userId: link.user_id,
        eventType: "signed_link_download_rejected",
        ttlSeconds: link.ttl_seconds,
        expiresAt: link.expires_at,
        metadata: { reason: "LINK_REVOKED", signedLinkId: link.id },
      });
      throw new ForbiddenError("Signed link has been revoked", "LINK_REVOKED", {
        fileId,
        signedLinkId: link.id,
      });
    }

    await this.recordAudit.execute({
      fileId,
      userId: link.user_id,
      eventType: "signed_link_downloaded",
      ttlSeconds: link.ttl_seconds,
      expiresAt: link.expires_at,
      metadata: { signedLinkId: link.id },
    });

    return link;
  }
}
