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

  async listAuditEvents(fileId: string, userId: string): Promise<AuditEvent[]> {
    await this.getOwnedFile(fileId, userId);
    const result = await this.db.query<AuditEvent>(
      `SELECT id, file_id, user_id, event_type, ttl_seconds, expires_at, created_at
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
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_events (id, file_id, user_id, event_type, ttl_seconds, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), event.fileId, event.userId, event.eventType, event.ttlSeconds, event.expiresAt],
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
