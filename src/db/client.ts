import fs from "node:fs";
import { Pool } from "pg";
import type { AppConfig } from "../config.js";

export type FileRecord = {
  id: string;
  user_id: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
};

export type AuditEvent = {
  id: string;
  file_id: string;
  user_id: string;
  event_type: string;
  ttl_seconds: number | null;
  expires_at: string | null;
  created_at: string;
};

export type SignedLinkRecord = {
  id: string;
  file_id: string;
  user_id: string;
  signature: string;
  ttl_seconds: number;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
};

const MIGRATIONS_SQL = `
  CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    storage_path TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);

  -- Every cryptographically signed download link we mint (fileId + TTL -> HMAC
  -- signature) is persisted here so it survives restarts, can be audited, and
  -- can be revoked before its natural expiry.
  CREATE TABLE IF NOT EXISTS signed_links (
    id UUID PRIMARY KEY,
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    signature TEXT NOT NULL UNIQUE,
    ttl_seconds INTEGER NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
  );

  CREATE INDEX IF NOT EXISTS idx_signed_links_file_id ON signed_links(file_id);
  CREATE INDEX IF NOT EXISTS idx_signed_links_signature ON signed_links(signature);

  CREATE TABLE IF NOT EXISTS audit_events (
    id UUID PRIMARY KEY,
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    ttl_seconds INTEGER,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_audit_file_id ON audit_events(file_id);
  CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_events(user_id);
`;

export async function openDatabase(config: AppConfig): Promise<Pool> {
  fs.mkdirSync(config.uploadDirAbsolute, { recursive: true });

  const pool = new Pool({ connectionString: config.DATABASE_URL });

  // Fail fast with a clear message if Postgres is unreachable, rather than
  // surfacing an opaque error on the first request.
  const client = await pool.connect();
  try {
    await client.query(MIGRATIONS_SQL);
  } finally {
    client.release();
  }

  return pool;
}
