import { beforeEach, describe, expect, it } from "vitest";
import { RecordAuditEventService } from "../../src/modules/audit/services/record-audit-event.service.js";
import { BatchDeleteFilesService } from "../../src/modules/files/services/batch-delete-files.service.js";
import { BatchUploadFilesService } from "../../src/modules/files/services/batch-upload-files.service.js";
import { DeleteFileService } from "../../src/modules/files/services/delete-file.service.js";
import { FileAccessService } from "../../src/modules/files/services/file-access.service.js";
import { UpdateFileService } from "../../src/modules/files/services/update-file.service.js";
import { UploadFileService } from "../../src/modules/files/services/upload-file.service.js";
import { InMemoryAuditRepository, InMemoryBlobStorage, InMemoryFileRepository } from "./fakes.js";

const upload = (filename: string, content: string) => ({
  filename,
  contentType: "text/plain",
  data: Buffer.from(content),
});

describe("file services", () => {
  let files: InMemoryFileRepository;
  let storage: InMemoryBlobStorage;
  let audit: InMemoryAuditRepository;
  let uploadFile: UploadFileService;
  let deleteFile: DeleteFileService;
  let access: FileAccessService;
  let recordAudit: RecordAuditEventService;

  beforeEach(() => {
    files = new InMemoryFileRepository();
    storage = new InMemoryBlobStorage();
    audit = new InMemoryAuditRepository();
    recordAudit = new RecordAuditEventService(audit);
    access = new FileAccessService(files);
    uploadFile = new UploadFileService(files, storage, 10);
    deleteFile = new DeleteFileService(access, files, storage, recordAudit);
  });

  describe("UploadFileService", () => {
    it("generates a file id and stores the blob and the record", async () => {
      const record = await uploadFile.execute("alice", upload("a.txt", "hello"));

      expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(record.user_id).toBe("alice");
      expect(storage.blobs.get(record.storage_path)?.toString()).toBe("hello");
    });

    it("rejects empty and oversized files before touching storage", async () => {
      await expect(uploadFile.execute("alice", upload("e.txt", ""))).rejects.toMatchObject({
        code: "EMPTY_FILE",
      });
      await expect(
        uploadFile.execute("alice", upload("big.txt", "01234567890")),
      ).rejects.toMatchObject({ status: 413, code: "FILE_TOO_LARGE" });
      expect(storage.blobs.size).toBe(0);
    });

    it("removes the orphaned blob when the database insert fails", async () => {
      files.failNextInsert = true;
      await expect(uploadFile.execute("alice", upload("a.txt", "hello"))).rejects.toThrow();
      expect(storage.blobs.size).toBe(0);
    });
  });

  describe("BatchUploadFilesService", () => {
    it("isolates per-file failures and enforces the batch limit", async () => {
      const batch = new BatchUploadFilesService(uploadFile, 3);

      const result = await batch.execute("alice", [upload("ok.txt", "1"), upload("bad.txt", "")]);
      expect(result.uploaded.map((f) => f.original_filename)).toEqual(["ok.txt"]);
      expect(result.failed).toEqual([
        { filename: "bad.txt", error: "Empty files are not allowed", code: "EMPTY_FILE" },
      ]);

      await expect(
        batch.execute("alice", [1, 2, 3, 4].map((n) => upload(`${n}.txt`, "x"))),
      ).rejects.toMatchObject({ code: "BATCH_TOO_LARGE" });
      await expect(batch.execute("alice", [])).rejects.toMatchObject({ code: "EMPTY_BATCH" });
    });
  });

  describe("DeleteFileService", () => {
    it("removes blob and record, and audits a snapshot of the deleted file", async () => {
      const record = await uploadFile.execute("alice", upload("a.txt", "hello"));

      await deleteFile.execute(record.id, "alice");

      expect(files.rows.has(record.id)).toBe(false);
      expect(storage.blobs.size).toBe(0);
      expect(audit.events).toEqual([
        expect.objectContaining({
          eventType: "file_deleted",
          metadata: { filename: "a.txt", sizeBytes: 5, contentType: "text/plain" },
        }),
      ]);
    });

    it("refuses to delete another user's file", async () => {
      const record = await uploadFile.execute("alice", upload("a.txt", "hello"));
      await expect(deleteFile.execute(record.id, "mallory")).rejects.toMatchObject({
        status: 403,
      });
      expect(files.rows.has(record.id)).toBe(true);
    });
  });

  describe("BatchDeleteFilesService", () => {
    it("deletes owned files and reports the rest without aborting", async () => {
      const mine = await uploadFile.execute("alice", upload("a.txt", "1"));
      const theirs = await uploadFile.execute("bob", upload("b.txt", "2"));

      const result = await new BatchDeleteFilesService(deleteFile, 10).execute("alice", [
        mine.id,
        theirs.id,
      ]);

      expect(result.deleted).toEqual([mine.id]);
      expect(result.failed).toEqual([
        { fileId: theirs.id, error: "You do not own this file", code: "FORBIDDEN" },
      ]);
    });
  });

  describe("UpdateFileService", () => {
    it("renames the file and records the previous name", async () => {
      const record = await uploadFile.execute("alice", upload("old.txt", "1"));
      const updated = await new UpdateFileService(access, files, recordAudit).execute(
        record.id,
        "alice",
        { filename: "  new.txt  " },
      );

      expect(updated.original_filename).toBe("new.txt");
      expect(audit.events[0]).toMatchObject({
        eventType: "file_renamed",
        metadata: { previousFilename: "old.txt", filename: "new.txt" },
      });
    });
  });
});
