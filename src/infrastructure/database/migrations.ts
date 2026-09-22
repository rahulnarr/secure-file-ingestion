import type { Pool } from "pg";

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

  -- No foreign key to files: an audit trail must outlive the resource it
  -- describes (e.g. "file_deleted" stays queryable after the row is gone).
  CREATE TABLE IF NOT EXISTS audit_events (
    id UUID PRIMARY KEY,
    file_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    ttl_seconds INTEGER,
    expires_at TIMESTAMPTZ,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_audit_file_id ON audit_events(file_id);
  CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_events(user_id);

  -- Upgrade path for databases created before audit_events was decoupled.
  ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_file_id_fkey;
  ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS metadata JSONB;
`;

export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(MIGRATIONS_SQL);
  } finally {
    client.release();
  }
}
