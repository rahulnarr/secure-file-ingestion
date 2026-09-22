import { randomUUID } from "node:crypto";
import { HttpError } from "../../../common/errors/http-error.js";
import type { UrlSigner } from "../../../infrastructure/crypto/url-signer.js";
import type { RecordAuditEventService } from "../../audit/services/record-audit-event.service.js";
import type { FileAccessService } from "../../files/services/file-access.service.js";
import type { SignedLinkRepository } from "../signed-link.repository.js";
import { MAX_TTL_SECONDS } from "../signed-link.schemas.js";

export type CreatedSignedLink = {
  signedLinkId: string;
  fileId: string;
  downloadUrl: string;
  expiresAt: number;
  ttlSeconds: number;
};

/**
 * Derives an HMAC signature from fileId + TTL, persists it so it can be
 * listed and revoked, and records a "signed_link_generated" audit event.
 */
export class CreateSignedLinkService {
  constructor(
    private readonly access: FileAccessService,
    private readonly signer: UrlSigner,
    private readonly links: SignedLinkRepository,
    private readonly recordAudit: RecordAuditEventService,
  ) {}

  async execute(fileId: string, userId: string, ttlSeconds: number): Promise<CreatedSignedLink> {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS) {
      throw new HttpError(
        400,
        `ttlSeconds must be an integer between 1 and ${MAX_TTL_SECONDS}`,
        "INVALID_TTL",
      );
    }

    const file = await this.access.getOwned(fileId, userId);
    const signed = this.signer.sign(file.id, ttlSeconds);
    const signedLinkId = randomUUID();
    const expiresAtIso = new Date(signed.expiresAt * 1000).toISOString();

    await this.links.insert({
      id: signedLinkId,
      fileId: file.id,
      userId,
      signature: signed.signature,
      ttlSeconds,
      expiresAt: expiresAtIso,
    });

    await this.recordAudit.execute({
      fileId: file.id,
      userId,
      eventType: "signed_link_generated",
      ttlSeconds,
      expiresAt: expiresAtIso,
    });

    return {
      signedLinkId,
      fileId: file.id,
      downloadUrl: signed.url,
      expiresAt: signed.expiresAt,
      ttlSeconds,
    };
  }
}
