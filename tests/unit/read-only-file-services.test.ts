import { beforeEach, describe, expect, it } from "vitest";
import { ListAuditEventsService } from "../../src/modules/audit/services/list-audit-events.service.js";
import { RecordAuditEventService } from "../../src/modules/audit/services/record-audit-event.service.js";
import { GetFileService } from "../../src/modules/files/services/get-file.service.js";
import { FileAccessService } from "../../src/modules/files/services/file-access.service.js";
import { ListFilesService } from "../../src/modules/files/services/list-files.service.js";
import { UploadFileService } from "../../src/modules/files/services/upload-file.service.js";
import { ListSignedLinksService } from "../../src/modules/signed-links/services/list-signed-links.service.js";
import {
  InMemoryAuditRepository,
  InMemoryBlobStorage,
  InMemoryFileRepository,
  InMemorySignedLinkRepository,
} from "./fakes.js";

describe("read-only services", () => {
  let files: InMemoryFileRepository;
  let uploadFile: UploadFileService;

  beforeEach(() => {
    files = new InMemoryFileRepository();
    uploadFile = new UploadFileService(files, new InMemoryBlobStorage(), 1024);
  });

  describe("ListFilesService", () => {
    it("returns only the caller's files", async () => {
      await uploadFile.execute("alice", { filename: "a.txt", contentType: "text/plain", data: Buffer.from("1") });
      await uploadFile.execute("bob", { filename: "b.txt", contentType: "text/plain", data: Buffer.from("2") });

      const result = await new ListFilesService(files).execute("alice");
      expect(result.map((f) => f.original_filename)).toEqual(["a.txt"]);
    });
  });

  describe("GetFileService", () => {
    it("delegates to FileAccessService and enforces ownership", async () => {
      const record = await uploadFile.execute("alice", {
        filename: "a.txt",
        contentType: "text/plain",
        data: Buffer.from("1"),
      });
      const getFile = new GetFileService(new FileAccessService(files));

      await expect(getFile.execute(record.id, "alice")).resolves.toMatchObject({ id: record.id });
      await expect(getFile.execute(record.id, "mallory")).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("ListSignedLinksService", () => {
    it("lists links for an owned file and rejects non-owners", async () => {
      const record = await uploadFile.execute("alice", {
        filename: "a.txt",
        contentType: "text/plain",
        data: Buffer.from("1"),
      });
      const links = new InMemorySignedLinkRepository();
      await links.insert({
        id: "11111111-1111-1111-1111-111111111111",
        fileId: record.id,
        userId: "alice",
        signature: "sig",
        ttlSeconds: 60,
        expiresAt: new Date().toISOString(),
      });

      const service = new ListSignedLinksService(new FileAccessService(files), links);
      await expect(service.execute(record.id, "alice")).resolves.toHaveLength(1);
      await expect(service.execute(record.id, "mallory")).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("ListAuditEventsService", () => {
    it("authorizes via the live file when it still exists", async () => {
      const record = await uploadFile.execute("alice", {
        filename: "a.txt",
        contentType: "text/plain",
        data: Buffer.from("1"),
      });
      const audit = new InMemoryAuditRepository();
      await new RecordAuditEventService(audit).execute({
        fileId: record.id,
        userId: "alice",
        eventType: "file_renamed",
      });

      const service = new ListAuditEventsService(files, audit);
      await expect(service.execute(record.id, "alice")).resolves.toHaveLength(1);
      await expect(service.execute(record.id, "mallory")).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("authorizes via a surviving audit record once the file is gone", async () => {
      const audit = new InMemoryAuditRepository();
      const fileId = "22222222-2222-2222-2222-222222222222";
      await new RecordAuditEventService(audit).execute({
        fileId,
        userId: "alice",
        eventType: "file_deleted",
      });

      const service = new ListAuditEventsService(files, audit);
      await expect(service.execute(fileId, "alice")).resolves.toHaveLength(1);
      await expect(service.execute(fileId, "mallory")).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });

    it("rejects a malformed fileId", async () => {
      const audit = new InMemoryAuditRepository();
      await expect(
        new ListAuditEventsService(files, audit).execute("not-a-uuid", "alice"),
      ).rejects.toMatchObject({ code: "INVALID_ID" });
    });
  });
});
