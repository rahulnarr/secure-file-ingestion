import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import type { AuditEvent, FileRecord } from "../db/client.js";
import { createSignedDownloadUrl } from "../lib/signing.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export type UploadedFileInput = {
  userId: string;
  filename: string;
  contentType: string;
  data: Buffer;
};

export class FileService {
  constructor(
    private readonly db: Database.Database,
    private readonly config: AppConfig,
  ) {}

  upload(input: UploadedFileInput): FileRecord {
    if (!input.userId.trim()) {
      throw new HttpError(400, "userId is required", "MISSING_USER");
    }
    if (!input.filename.trim()) {
      throw new HttpError(400, "filename is required", "MISSING_FILENAME");
    }
    if (input.data.byteLength === 0) {
      throw new HttpError(400, "Empty files are not allowed", "EMPTY_FILE");
    }
    if (input.data.byteLength > this.config.MAX_UPLOAD_BYTES) {
      throw new HttpError(
        413,
        `File exceeds max size of ${this.config.MAX_UPLOAD_BYTES} bytes`,
        "FILE_TOO_LARGE",
      );
    }

    const id = randomUUID();
    const safeName = sanitizeFilename(input.filename);
    const storageName = `${id}-${safeName}`;
    const storagePath = path.join(this.config.uploadDirAbsolute, storageName);

    fs.writeFileSync(storagePath, input.data);

    const createdAt = new Date().toISOString();
    const record: FileRecord = {
      id,
      user_id: input.userId,
      original_filename: input.filename,
      content_type: input.contentType || "application/octet-stream",
      size_bytes: input.data.byteLength,
      storage_path: storagePath,
      created_at: createdAt,
    };

    try {
      this.db
        .prepare(
          `INSERT INTO files (
            id, user_id, original_filename, content_type, size_bytes, storage_path, created_at
          ) VALUES (
            @id, @user_id, @original_filename, @content_type, @size_bytes, @storage_path, @created_at
          )`,
        )
        .run(record);
    } catch (error) {
      fs.unlinkSync(storagePath);
      throw error;
    }

    return record;
  }

  listForUser(userId: string): FileRecord[] {
    return this.db
      .prepare(
        `SELECT id, user_id, original_filename, content_type, size_bytes, storage_path, created_at
         FROM files
         WHERE user_id = ?
         ORDER BY created_at DESC`,
      )
      .all(userId) as FileRecord[];
  }

  getOwnedFile(fileId: string, userId: string): FileRecord {
    const file = this.db
      .prepare(
        `SELECT id, user_id, original_filename, content_type, size_bytes, storage_path, created_at
         FROM files WHERE id = ?`,
      )
      .get(fileId) as FileRecord | undefined;

    if (!file) {
      throw new HttpError(404, "File not found", "FILE_NOT_FOUND");
    }
    if (file.user_id !== userId) {
      throw new HttpError(403, "You do not own this file", "FORBIDDEN");
    }
    return file;
  }

  getById(fileId: string): FileRecord {
    const file = this.db
      .prepare(
        `SELECT id, user_id, original_filename, content_type, size_bytes, storage_path, created_at
         FROM files WHERE id = ?`,
      )
      .get(fileId) as FileRecord | undefined;

    if (!file) {
      throw new HttpError(404, "File not found", "FILE_NOT_FOUND");
    }
    return file;
  }

  createSignedLink(
    fileId: string,
    userId: string,
    ttlSeconds: number,
  ): {
    downloadUrl: string;
    expiresAt: number;
    ttlSeconds: number;
    fileId: string;
    auditEventId: string;
  } {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 86_400) {
      throw new HttpError(
        400,
        "ttlSeconds must be an integer between 1 and 86400",
        "INVALID_TTL",
      );
    }

    const file = this.getOwnedFile(fileId, userId);
    const signed = createSignedDownloadUrl({
      baseUrl: this.config.BASE_URL,
      secret: this.config.SIGNING_SECRET,
      fileId: file.id,
      ttlSeconds,
    });

    const auditId = randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO audit_events (
          id, file_id, user_id, event_type, ttl_seconds, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        auditId,
        file.id,
        userId,
        "signed_link_generated",
        ttlSeconds,
        new Date(signed.expiresAt * 1000).toISOString(),
        createdAt,
      );

    return {
      downloadUrl: signed.url,
      expiresAt: signed.expiresAt,
      ttlSeconds,
      fileId: file.id,
      auditEventId: auditId,
    };
  }

  listAuditEvents(fileId: string, userId: string): AuditEvent[] {
    this.getOwnedFile(fileId, userId);
    return this.db
      .prepare(
        `SELECT id, file_id, user_id, event_type, ttl_seconds, expires_at, created_at
         FROM audit_events
         WHERE file_id = ?
         ORDER BY created_at DESC`,
      )
      .all(fileId) as AuditEvent[];
  }

  readFileBytes(file: FileRecord): Buffer {
    if (!fs.existsSync(file.storage_path)) {
      throw new HttpError(410, "Stored file blob is missing", "BLOB_MISSING");
    }
    return fs.readFileSync(file.storage_path);
  }
}

function sanitizeFilename(filename: string): string {
  const base = path.basename(filename).replace(/[^\w.\-()+ ]+/g, "_");
  return base.slice(0, 180) || "upload.bin";
}

export function toPublicFile(file: FileRecord) {
  return {
    id: file.id,
    userId: file.user_id,
    filename: file.original_filename,
    contentType: file.content_type,
    sizeBytes: file.size_bytes,
    uploadedAt: file.created_at,
    status: "stored" as const,
  };
}
