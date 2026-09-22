import type { Pool } from "pg";
import type { FileRecord, NewFileRecord } from "./file.types.js";

export interface FileRepository {
  insert(file: NewFileRecord): Promise<FileRecord>;
  findById(id: string): Promise<FileRecord | null>;
  listByUser(userId: string): Promise<FileRecord[]>;
  updateFilename(id: string, filename: string): Promise<FileRecord>;
  deleteById(id: string): Promise<void>;
}

const COLUMNS =
  "id, user_id, original_filename, content_type, size_bytes, storage_path, created_at";

export class PgFileRepository implements FileRepository {
  constructor(private readonly db: Pool) {}

  async insert(file: NewFileRecord): Promise<FileRecord> {
    const result = await this.db.query<FileRecord>(
      `INSERT INTO files (id, user_id, original_filename, content_type, size_bytes, storage_path)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNS}`,
      [file.id, file.userId, file.filename, file.contentType, file.sizeBytes, file.storagePath],
    );
    return result.rows[0];
  }

  async findById(id: string): Promise<FileRecord | null> {
    const result = await this.db.query<FileRecord>(
      `SELECT ${COLUMNS} FROM files WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listByUser(userId: string): Promise<FileRecord[]> {
    const result = await this.db.query<FileRecord>(
      `SELECT ${COLUMNS} FROM files WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows;
  }

  async updateFilename(id: string, filename: string): Promise<FileRecord> {
    const result = await this.db.query<FileRecord>(
      `UPDATE files SET original_filename = $1 WHERE id = $2 RETURNING ${COLUMNS}`,
      [filename, id],
    );
    return result.rows[0];
  }

  async deleteById(id: string): Promise<void> {
    await this.db.query(`DELETE FROM files WHERE id = $1`, [id]);
  }
}
