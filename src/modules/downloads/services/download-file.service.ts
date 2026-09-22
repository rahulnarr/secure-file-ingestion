import { HttpError } from "../../../common/errors/http-error.js";
import type { UrlSigner } from "../../../infrastructure/crypto/url-signer.js";
import type { BlobStorage } from "../../../infrastructure/storage/blob-storage.js";
import type { FileRecord } from "../../files/file.types.js";
import type { FileAccessService } from "../../files/services/file-access.service.js";
import type { RedeemSignedLinkService } from "../../signed-links/services/redeem-signed-link.service.js";

export type DownloadRequest = {
  fileId: string;
  expires: string;
  signature: string;
};

/**
 * Two-phase validation: a stateless HMAC + expiry check rejects tampered or
 * expired links without touching Postgres; only then is the link redeemed
 * against the database (provenance + revocation) and the blob read.
 */
export class DownloadFileService {
  constructor(
    private readonly signer: UrlSigner,
    private readonly access: FileAccessService,
    private readonly redeemSignedLink: RedeemSignedLinkService,
    private readonly storage: BlobStorage,
  ) {}

  async execute(request: DownloadRequest): Promise<{ file: FileRecord; bytes: Buffer }> {
    const verification = this.signer.verify(request);
    if (!verification.ok) {
      throw new HttpError(403, verification.reason, "INVALID_SIGNED_URL");
    }

    const file = await this.access.getById(verification.fileId);
    await this.redeemSignedLink.execute(file.id, request.signature);

    if (!(await this.storage.exists(file.storage_path))) {
      throw new HttpError(410, "Stored file blob is missing", "BLOB_MISSING");
    }

    return { file, bytes: await this.storage.read(file.storage_path) };
  }
}
