import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
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

export function openDatabase(config: AppConfig): Database.Database {
  fs.mkdirSync(path.dirname(config.databasePathAbsolute), { recursive: true });
  fs.mkdirSync(config.uploadDirAbsolute, { recursive: true });

  const db = new Database(config.databasePathAbsolute);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      ttl_seconds INTEGER,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_audit_file_id ON audit_events(file_id);
    CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_events(user_id);
  `);

  return db;
}
