import { describe, expect, it } from "vitest";
import { toPublicAuditEvent } from "../../src/modules/audit/audit.mapper.js";
import { toFileUpload, toPublicFile } from "../../src/modules/files/file.mapper.js";
import type { FileRecord } from "../../src/modules/files/file.types.js";
import { toPublicSignedLink } from "../../src/modules/signed-links/signed-link.mapper.js";

describe("mappers", () => {
  it("toPublicFile converts snake_case DB columns to camelCase and numeric size", () => {
    const record: FileRecord = {
      id: "f1",
      user_id: "alice",
      original_filename: "a.txt",
      content_type: "text/plain",
      size_bytes: 123,
      storage_path: "/data/f1-a.txt",
      created_at: "2026-01-01T00:00:00.000Z",
    };
    expect(toPublicFile(record)).toEqual({
      id: "f1",
      userId: "alice",
      filename: "a.txt",
      contentType: "text/plain",
      sizeBytes: 123,
      uploadedAt: "2026-01-01T00:00:00.000Z",
      status: "stored",
    });
  });

  it("toFileUpload reads a File's name, type, and bytes, defaulting missing fields", async () => {
    const file = new File([Buffer.from("hello")], "notes.txt", { type: "text/plain" });
    const upload = await toFileUpload(file);
    expect(upload).toMatchObject({ filename: "notes.txt", contentType: "text/plain" });
    expect(upload.data.toString()).toBe("hello");

    const unnamed = new File([Buffer.from("x")], "");
    const fallback = await toFileUpload(unnamed);
    expect(fallback.filename).toBe("upload.bin");
    expect(fallback.contentType).toBe("application/octet-stream");
  });

  it("toPublicSignedLink reports active vs revoked status", () => {
    const base = {
      id: "l1",
      file_id: "f1",
      user_id: "alice",
      signature: "sig",
      ttl_seconds: 60,
      expires_at: "2026-01-01T00:01:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
      revoked_at: null,
    };
    expect(toPublicSignedLink(base).status).toBe("active");
    expect(toPublicSignedLink({ ...base, revoked_at: "2026-01-01T00:00:30.000Z" }).status).toBe("revoked");
  });

  it("toPublicAuditEvent passes through fields as camelCase", () => {
    const event = {
      id: "e1",
      file_id: "f1",
      user_id: "alice",
      event_type: "file_renamed" as const,
      ttl_seconds: null,
      expires_at: null,
      metadata: { previousFilename: "old.txt", filename: "new.txt" },
      created_at: "2026-01-01T00:00:00.000Z",
    };
    expect(toPublicAuditEvent(event)).toEqual({
      id: "e1",
      fileId: "f1",
      userId: "alice",
      eventType: "file_renamed",
      ttlSeconds: null,
      expiresAt: null,
      metadata: { previousFilename: "old.txt", filename: "new.txt" },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });
});
