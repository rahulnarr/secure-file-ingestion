import { beforeEach, describe, expect, it } from "vitest";
import { UrlSigner } from "../../src/infrastructure/crypto/url-signer.js";
import { RecordAuditEventService } from "../../src/modules/audit/services/record-audit-event.service.js";
import { DownloadFileService } from "../../src/modules/downloads/services/download-file.service.js";
import { FileAccessService } from "../../src/modules/files/services/file-access.service.js";
import { UploadFileService } from "../../src/modules/files/services/upload-file.service.js";
import { CreateSignedLinkService } from "../../src/modules/signed-links/services/create-signed-link.service.js";
import { RedeemSignedLinkService } from "../../src/modules/signed-links/services/redeem-signed-link.service.js";
import { RevokeSignedLinkService } from "../../src/modules/signed-links/services/revoke-signed-link.service.js";
import {
  InMemoryAuditRepository,
  InMemoryBlobStorage,
  InMemoryFileRepository,
  InMemorySignedLinkRepository,
} from "./fakes.js";

function queryOf(url: string) {
  const params = new URL(url).searchParams;
  return {
    fileId: params.get("fileId")!,
    expires: params.get("expires")!,
    signature: params.get("sig")!,
  };
}

describe("signed link lifecycle (services only, no HTTP or database)", () => {
  let links: InMemorySignedLinkRepository;
  let audit: InMemoryAuditRepository;
  let storage: InMemoryBlobStorage;
  let uploadFile: UploadFileService;
  let createLink: CreateSignedLinkService;
  let revokeLink: RevokeSignedLinkService;
  let download: DownloadFileService;

  beforeEach(() => {
    const files = new InMemoryFileRepository();
    links = new InMemorySignedLinkRepository();
    audit = new InMemoryAuditRepository();
    storage = new InMemoryBlobStorage();
    const signer = new UrlSigner("unit-test-signing-secret", "http://localhost");
    const access = new FileAccessService(files);
    const recordAudit = new RecordAuditEventService(audit);

    uploadFile = new UploadFileService(files, storage, 1024);
    createLink = new CreateSignedLinkService(access, signer, links, recordAudit);
    revokeLink = new RevokeSignedLinkService(access, links, recordAudit);
    download = new DownloadFileService(
      signer,
      access,
      new RedeemSignedLinkService(links, recordAudit),
      storage,
    );
  });

  it("persists the generated signature and serves the file", async () => {
    const file = await uploadFile.execute("alice", {
      filename: "a.txt",
      contentType: "text/plain",
      data: Buffer.from("secret"),
    });
    const link = await createLink.execute(file.id, "alice", 60);

    expect(links.rows).toHaveLength(1);
    expect(links.rows[0]).toMatchObject({ file_id: file.id, ttl_seconds: 60 });

    const result = await download.execute(queryOf(link.downloadUrl));
    expect(result.bytes.toString()).toBe("secret");
    expect(audit.events.map((e) => e.eventType)).toEqual([
      "signed_link_generated",
      "signed_link_downloaded",
    ]);
  });

  it("rejects a tampered signature before any repository lookup", async () => {
    await expect(
      download.execute({ fileId: "x", expires: "9999999999", signature: "deadbeef" }),
    ).rejects.toMatchObject({ status: 403, code: "INVALID_SIGNED_URL" });
    expect(audit.events).toHaveLength(0);
  });

  it("rejects a revoked link even though its signature is still valid", async () => {
    const file = await uploadFile.execute("alice", {
      filename: "a.txt",
      contentType: "text/plain",
      data: Buffer.from("secret"),
    });
    const link = await createLink.execute(file.id, "alice", 3600);
    await revokeLink.execute(file.id, link.signedLinkId, "alice");

    await expect(download.execute(queryOf(link.downloadUrl))).rejects.toMatchObject({
      code: "LINK_REVOKED",
    });
  });

  it("returns 410 when the record exists but the blob is gone", async () => {
    const file = await uploadFile.execute("alice", {
      filename: "a.txt",
      contentType: "text/plain",
      data: Buffer.from("secret"),
    });
    const link = await createLink.execute(file.id, "alice", 60);
    storage.blobs.clear();

    await expect(download.execute(queryOf(link.downloadUrl))).rejects.toMatchObject({
      status: 410,
      code: "BLOB_MISSING",
    });
  });
});
