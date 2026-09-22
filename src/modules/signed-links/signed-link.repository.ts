import type { Pool } from "pg";
import type { NewSignedLink, SignedLinkRecord } from "./signed-link.types.js";

export interface SignedLinkRepository {
  insert(link: NewSignedLink): Promise<void>;
  listByFile(fileId: string): Promise<SignedLinkRecord[]>;
  findByFileAndSignature(fileId: string, signature: string): Promise<SignedLinkRecord | null>;
  /** Returns false when the link doesn't exist or was already revoked. */
  revoke(linkId: string, fileId: string): Promise<boolean>;
}

const COLUMNS =
  "id, file_id, user_id, signature, ttl_seconds, expires_at, created_at, revoked_at";

export class PgSignedLinkRepository implements SignedLinkRepository {
  constructor(private readonly db: Pool) {}

  async insert(link: NewSignedLink): Promise<void> {
    await this.db.query(
      `INSERT INTO signed_links (id, file_id, user_id, signature, ttl_seconds, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [link.id, link.fileId, link.userId, link.signature, link.ttlSeconds, link.expiresAt],
    );
  }

  async listByFile(fileId: string): Promise<SignedLinkRecord[]> {
    const result = await this.db.query<SignedLinkRecord>(
      `SELECT ${COLUMNS} FROM signed_links WHERE file_id = $1 ORDER BY created_at DESC`,
      [fileId],
    );
    return result.rows;
  }

  async findByFileAndSignature(
    fileId: string,
    signature: string,
  ): Promise<SignedLinkRecord | null> {
    const result = await this.db.query<SignedLinkRecord>(
      `SELECT ${COLUMNS} FROM signed_links WHERE file_id = $1 AND signature = $2`,
      [fileId, signature],
    );
    return result.rows[0] ?? null;
  }

  async revoke(linkId: string, fileId: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE signed_links SET revoked_at = now()
       WHERE id = $1 AND file_id = $2 AND revoked_at IS NULL`,
      [linkId, fileId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
