import type { BlobStorage } from "../../src/infrastructure/storage/blob-storage.js";
import type { AuditRepository } from "../../src/modules/audit/audit.repository.js";
import type { AuditEvent, NewAuditEvent } from "../../src/modules/audit/audit.types.js";
import type { FileRepository } from "../../src/modules/files/file.repository.js";
import type { FileRecord, NewFileRecord } from "../../src/modules/files/file.types.js";
import type { SignedLinkRepository } from "../../src/modules/signed-links/signed-link.repository.js";
import type { NewSignedLink, SignedLinkRecord } from "../../src/modules/signed-links/signed-link.types.js";

export class InMemoryBlobStorage implements BlobStorage {
  readonly blobs = new Map<string, Buffer>();

  async save(fileId: string, filename: string, data: Buffer): Promise<string> {
    const location = `mem://${fileId}/${filename}`;
    this.blobs.set(location, data);
    return location;
  }
  async exists(location: string) {
    return this.blobs.has(location);
  }
  async read(location: string) {
    return this.blobs.get(location)!;
  }
  async remove(location: string) {
    this.blobs.delete(location);
  }
}

export class InMemoryFileRepository implements FileRepository {
  readonly rows = new Map<string, FileRecord>();
  failNextInsert = false;

  async insert(file: NewFileRecord): Promise<FileRecord> {
    if (this.failNextInsert) {
      this.failNextInsert = false;
      throw new Error("simulated database failure");
    }
    const record: FileRecord = {
      id: file.id,
      user_id: file.userId,
      original_filename: file.filename,
      content_type: file.contentType,
      size_bytes: file.sizeBytes,
      storage_path: file.storagePath,
      created_at: new Date().toISOString(),
    };
    this.rows.set(file.id, record);
    return record;
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async listByUser(userId: string) {
    return [...this.rows.values()].filter((r) => r.user_id === userId);
  }
  async updateFilename(id: string, filename: string) {
    const row = { ...this.rows.get(id)!, original_filename: filename };
    this.rows.set(id, row);
    return row;
  }
  async deleteById(id: string) {
    this.rows.delete(id);
  }
}

export class InMemorySignedLinkRepository implements SignedLinkRepository {
  readonly rows: SignedLinkRecord[] = [];

  async insert(link: NewSignedLink) {
    this.rows.push({
      id: link.id,
      file_id: link.fileId,
      user_id: link.userId,
      signature: link.signature,
      ttl_seconds: link.ttlSeconds,
      expires_at: link.expiresAt,
      created_at: new Date().toISOString(),
      revoked_at: null,
    });
  }
  async listByFile(fileId: string) {
    return this.rows.filter((r) => r.file_id === fileId);
  }
  async findByFileAndSignature(fileId: string, signature: string) {
    return this.rows.find((r) => r.file_id === fileId && r.signature === signature) ?? null;
  }
  async revoke(linkId: string, fileId: string) {
    const row = this.rows.find((r) => r.id === linkId && r.file_id === fileId && !r.revoked_at);
    if (!row) return false;
    row.revoked_at = new Date().toISOString();
    return true;
  }
}

export class InMemoryAuditRepository implements AuditRepository {
  readonly events: NewAuditEvent[] = [];

  async insert(event: NewAuditEvent) {
    this.events.push(event);
  }
  async listByFile(fileId: string): Promise<AuditEvent[]> {
    return this.events
      .filter((e) => e.fileId === fileId)
      .map((e, i) => ({
        id: String(i),
        file_id: e.fileId,
        user_id: e.userId,
        event_type: e.eventType,
        ttl_seconds: e.ttlSeconds ?? null,
        expires_at: e.expiresAt ?? null,
        metadata: e.metadata ?? null,
        created_at: new Date().toISOString(),
      }));
  }
  async existsForFileAndUser(fileId: string, userId: string) {
    return this.events.some((e) => e.fileId === fileId && e.userId === userId);
  }
}
