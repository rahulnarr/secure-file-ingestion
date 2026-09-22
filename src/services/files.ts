import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import type { AuditEvent, FileRecord, SignedLinkRecord } from "../db/client.js";
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
    private readonly db: Pool,
    private readonly config: AppConfig,
  ) {}

  async upload(input: UploadedFileInput): Promise<FileRecord> {
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

    const contentType = input.contentType || "application/octet-stream";

    try {
      const result = await this.db.query<FileRecord>(
        `INSERT INTO files (id, user_id, original_filename, content_type, size_bytes, storage_path)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, user_id, original_filename, content_type, size_bytes, storage_path, created_at`,
        [id, input.userId, input.filename, contentType, input.data.byteLength, storagePath],
      );
      return result.rows[0];
    } catch (error) {
      fs.unlinkSync(storagePath);
      throw error;
    }
  }

  async listForUser(userId: string): Promise<FileRecord[]> {
    const result = await this.db.query<FileRecord>(
      `SELECT id, user_id, original_filename, content_type, size_bytes, storage_path, created_at
       FROM files
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows;
  }

  async getOwnedFile(fileId: string, userId: string): Promise<FileRecord> {
    const file = await this.getById(fileId);
    if (file.user_id !== userId) {
      throw new HttpError(403, "You do not own this file", "FORBIDDEN");
    }
    return file;
  }

  async getById(fileId: string): Promise<FileRecord> {
    assertUuid(fileId, "fileId");
    const result = await this.db.query<FileRecord>(
      `SELECT id, user_id, original_filename, content_type, size_bytes, storage_path, created_at
       FROM files WHERE id = $1`,
      [fileId],
    );
    const file = result.rows[0];
    if (!file) {
      throw new HttpError(404, "File not found", "FILE_NOT_FOUND");
    }
    return file;
  }

  /**
   * Cryptographically derives a signed download URL from fileId + TTL (HMAC-SHA256),
   * then persists the signature, TTL, and expiry in Postgres so the link survives
   * restarts, can be audited, and can be revoked before it naturally expires.
   */
  async createSignedLink(
    fileId: string,
    userId: string,
    ttlSeconds: number,
  ): Promise<{
    downloadUrl: string;
    expiresAt: number;
    ttlSeconds: number;
    fileId: string;
    signedLinkId: string;
  }> {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 86_400) {
      throw new HttpError(
        400,
        "ttlSeconds must be an integer between 1 and 86400",
        "INVALID_TTL",
      );
    }

    const file = await this.getOwnedFile(fileId, userId);
    const signed = createSignedDownloadUrl({
      baseUrl: this.config.BASE_URL,
      secret: this.config.SIGNING_SECRET,
      fileId: file.id,
      ttlSeconds,
    });

    const signedLinkId = randomUUID();
    const expiresAtIso = new Date(signed.expiresAt * 1000).toISOString();

    await this.db.query(
      `INSERT INTO signed_links (id, file_id, user_id, signature, ttl_seconds, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [signedLinkId, file.id, userId, signed.signature, ttlSeconds, expiresAtIso],
    );

    await this.recordAuditEvent({
      fileId: file.id,
      userId,
      eventType: "signed_link_generated",
      ttlSeconds,
      expiresAt: expiresAtIso,
    });

    return {
      downloadUrl: signed.url,
      expiresAt: signed.expiresAt,
      ttlSeconds,
      fileId: file.id,
      signedLinkId,
    };
  }

  /**
   * Uploads multiple files for a user in one call, isolating failures per
   * file so one bad upload (e.g. empty file, too large) doesn't abort the
   * rest of the batch.
   */
  async batchUpload(
    userId: string,
    inputs: Array<{ filename: string; contentType: string; data: Buffer }>,
  ): Promise<{
    uploaded: FileRecord[];
    failed: Array<{ filename: string; error: string; code?: string }>;
  }> {
    if (inputs.length === 0) {
      throw new HttpError(400, "At least one file is required", "EMPTY_BATCH");
    }
    if (inputs.length > this.config.MAX_BATCH_SIZE) {
      throw new HttpError(
        400,
        `Batch exceeds max of ${this.config.MAX_BATCH_SIZE} files`,
        "BATCH_TOO_LARGE",
      );
    }

    const uploaded: FileRecord[] = [];
    const failed: Array<{ filename: string; error: string; code?: string }> = [];

    for (const input of inputs) {
      try {
        const record = await this.upload({ userId, ...input });
        uploaded.push(record);
      } catch (error) {
        if (error instanceof HttpError) {
          failed.push({ filename: input.filename, error: error.message, code: error.code });
        } else {
          failed.push({ filename: input.filename, error: "Upload failed" });
        }
      }
    }

    return { uploaded, failed };
  }

  /**
   * Deletes multiple files owned by the caller in one call. Each id is
   * isolated so one missing/forbidden id doesn't block the rest.
   */
  async batchDelete(
    userId: string,
    fileIds: string[],
  ): Promise<{
    deleted: string[];
    failed: Array<{ fileId: string; error: string; code?: string }>;
  }> {
    if (fileIds.length === 0) {
      throw new HttpError(400, "At least one fileId is required", "EMPTY_BATCH");
    }
    if (fileIds.length > this.config.MAX_BATCH_SIZE) {
      throw new HttpError(
        400,
        `Batch exceeds max of ${this.config.MAX_BATCH_SIZE} files`,
        "BATCH_TOO_LARGE",
      );
    }

    const deleted: string[] = [];
    const failed: Array<{ fileId: string; error: string; code?: string }> = [];

    for (const fileId of fileIds) {
      try {
        await this.delete(fileId, userId);
        deleted.push(fileId);
      } catch (error) {
        if (error instanceof HttpError) {
          failed.push({ fileId, error: error.message, code: error.code });
        } else {
          failed.push({ fileId, error: "Delete failed" });
        }
      }
    }

    return { deleted, failed };
  }

  /**
   * Deletes a single file owned by the caller: removes the blob from disk,
   * removes the DB row (cascading its signed_links), and preserves a
   * "file_deleted" audit event with a metadata snapshot of what was removed.
   */
  async delete(fileId: string, userId: string): Promise<void> {
    const file = await this.getOwnedFile(fileId, userId);

    await this.recordAuditEvent({
      fileId: file.id,
      userId,
      eventType: "file_deleted",
      ttlSeconds: null,
      expiresAt: null,
      metadata: {
        filename: file.original_filename,
        sizeBytes: Number(file.size_bytes),
        contentType: file.content_type,
      },
    });

    await this.db.query(`DELETE FROM files WHERE id = $1`, [file.id]);

    if (fs.existsSync(file.storage_path)) {
      fs.unlinkSync(file.storage_path);
    }
  }

  /**
   * Updates metadata (currently: filename) for a file owned by the caller.
   */
  async updateMetadata(
    fileId: string,
    userId: string,
    updates: { filename?: string },
  ): Promise<FileRecord> {
    const file = await this.getOwnedFile(fileId, userId);

    if (updates.filename === undefined) {
      throw new HttpError(400, "No updatable fields provided", "NO_UPDATES");
    }

    const trimmed = updates.filename.trim();
    if (!trimmed) {
      throw new HttpError(400, "filename cannot be empty", "INVALID_FILENAME");
    }

    const result = await this.db.query<FileRecord>(
      `UPDATE files SET original_filename = $1 WHERE id = $2
       RETURNING id, user_id, original_filename, content_type, size_bytes, storage_path, created_at`,
      [trimmed, file.id],
    );

    await this.recordAuditEvent({
      fileId: file.id,
      userId,
      eventType: "file_renamed",
      ttlSeconds: null,
      expiresAt: null,
      metadata: { previousFilename: file.original_filename, filename: trimmed },
    });

    return result.rows[0];
  }

  async listSignedLinks(fileId: string, userId: string): Promise<SignedLinkRecord[]> {
    await this.getOwnedFile(fileId, userId);
    const result = await this.db.query<SignedLinkRecord>(
      `SELECT id, file_id, user_id, signature, ttl_seconds, expires_at, created_at, revoked_at
       FROM signed_links
       WHERE file_id = $1
       ORDER BY created_at DESC`,
      [fileId],
    );
    return result.rows;
  }

  async revokeSignedLink(fileId: string, linkId: string, userId: string): Promise<void> {
    await this.getOwnedFile(fileId, userId);
    assertUuid(linkId, "linkId");

    const result = await this.db.query<SignedLinkRecord>(
      `UPDATE signed_links
       SET revoked_at = now()
       WHERE id = $1 AND file_id = $2 AND revoked_at IS NULL
       RETURNING id`,
      [linkId, fileId],
    );

    if (result.rowCount === 0) {
      throw new HttpError(
        404,
        "Signed link not found or already revoked",
        "SIGNED_LINK_NOT_FOUND",
      );
    }

    await this.recordAuditEvent({
      fileId,
      userId,
      eventType: "signed_link_revoked",
      ttlSeconds: null,
      expiresAt: null,
    });
  }

  /**
   * Looks up a signed link by its HMAC signature to confirm it was actually
   * issued by this service (not merely well-formed) and has not been revoked.
   * Also records a download-attempt audit event.
   */
  async consumeSignedLink(
    fileId: string,
    signature: string,
  ): Promise<{ file: FileRecord; link: SignedLinkRecord }> {
    const file = await this.getById(fileId);

    const result = await this.db.query<SignedLinkRecord>(
      `SELECT id, file_id, user_id, signature, ttl_seconds, expires_at, created_at, revoked_at
       FROM signed_links
       WHERE file_id = $1 AND signature = $2`,
      [fileId, signature],
    );
    const link = result.rows[0];

    if (!link) {
      await this.recordAuditEvent({
        fileId,
        userId: "unknown",
        eventType: "signed_link_download_rejected",
        ttlSeconds: null,
        expiresAt: null,
      });
      throw new HttpError(403, "Signed link was not issued by this service", "UNKNOWN_LINK");
    }

    if (link.revoked_at) {
      await this.recordAuditEvent({
        fileId,
        userId: link.user_id,
        eventType: "signed_link_download_rejected",
        ttlSeconds: link.ttl_seconds,
        expiresAt: link.expires_at,
      });
      throw new HttpError(403, "Signed link has been revoked", "LINK_REVOKED");
    }

    await this.recordAuditEvent({
      fileId,
      userId: link.user_id,
      eventType: "signed_link_downloaded",
      ttlSeconds: link.ttl_seconds,
      expiresAt: link.expires_at,
    });

    return { file, link };
  }

  /**
   * Audit events are intentionally readable even for a file that no longer
   * exists (e.g. after deletion), so this checks ownership via any surviving
   * audit record for that fileId + userId rather than requiring a live file.
   */
  async listAuditEvents(fileId: string, userId: string): Promise<AuditEvent[]> {
    assertUuid(fileId, "fileId");

    const stillExists = await this.db.query<{ user_id: string }>(
      `SELECT user_id FROM files WHERE id = $1`,
      [fileId],
    );

    if (stillExists.rows[0]) {
      if (stillExists.rows[0].user_id !== userId) {
        throw new HttpError(403, "You do not own this file", "FORBIDDEN");
      }
    } else {
      const hasOwnAuditTrail = await this.db.query(
        `SELECT 1 FROM audit_events WHERE file_id = $1 AND user_id = $2 LIMIT 1`,
        [fileId, userId],
      );
      if (hasOwnAuditTrail.rowCount === 0) {
        throw new HttpError(404, "File not found", "FILE_NOT_FOUND");
      }
    }

    const result = await this.db.query<AuditEvent>(
      `SELECT id, file_id, user_id, event_type, ttl_seconds, expires_at, metadata, created_at
       FROM audit_events
       WHERE file_id = $1
       ORDER BY created_at DESC`,
      [fileId],
    );
    return result.rows;
  }

  readFileBytes(file: FileRecord): Buffer {
    if (!fs.existsSync(file.storage_path)) {
      throw new HttpError(410, "Stored file blob is missing", "BLOB_MISSING");
    }
    return fs.readFileSync(file.storage_path);
  }

  private async recordAuditEvent(event: {
    fileId: string;
    userId: string;
    eventType: string;
    ttlSeconds: number | null;
    expiresAt: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_events (id, file_id, user_id, event_type, ttl_seconds, expires_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        event.fileId,
        event.userId,
        event.eventType,
        event.ttlSeconds,
        event.expiresAt,
        event.metadata ? JSON.stringify(event.metadata) : null,
      ],
    );
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    throw new HttpError(400, `${field} must be a valid UUID`, "INVALID_ID");
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
    sizeBytes: Number(file.size_bytes),
    uploadedAt: file.created_at,
    status: "stored" as const,
  };
}

export function toPublicSignedLink(link: SignedLinkRecord) {
  return {
    id: link.id,
    fileId: link.file_id,
    ttlSeconds: link.ttl_seconds,
    expiresAt: link.expires_at,
    createdAt: link.created_at,
    revokedAt: link.revoked_at,
    status: link.revoked_at ? ("revoked" as const) : ("active" as const),
  };
}
