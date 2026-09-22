import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AuditEvent, NewAuditEvent } from "./audit.types.js";

export interface AuditRepository {
  insert(event: NewAuditEvent): Promise<void>;
  listByFile(fileId: string): Promise<AuditEvent[]>;
  existsForFileAndUser(fileId: string, userId: string): Promise<boolean>;
}

export class PgAuditRepository implements AuditRepository {
  constructor(private readonly db: Pool) {}

  async insert(event: NewAuditEvent): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_events (id, file_id, user_id, event_type, ttl_seconds, expires_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        event.fileId,
        event.userId,
        event.eventType,
        event.ttlSeconds ?? null,
        event.expiresAt ?? null,
        event.metadata ? JSON.stringify(event.metadata) : null,
      ],
    );
  }

  async listByFile(fileId: string): Promise<AuditEvent[]> {
    const result = await this.db.query<AuditEvent>(
      `SELECT id, file_id, user_id, event_type, ttl_seconds, expires_at, metadata, created_at
       FROM audit_events
       WHERE file_id = $1
       ORDER BY created_at DESC`,
      [fileId],
    );
    return result.rows;
  }

  async existsForFileAndUser(fileId: string, userId: string): Promise<boolean> {
    const result = await this.db.query(
      `SELECT 1 FROM audit_events WHERE file_id = $1 AND user_id = $2 LIMIT 1`,
      [fileId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
