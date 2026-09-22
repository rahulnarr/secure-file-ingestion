import type { FileRecord, FileUpload } from "./file.types.js";

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

export async function toFileUpload(file: File): Promise<FileUpload> {
  return {
    filename: file.name || "upload.bin",
    contentType: file.type || "application/octet-stream",
    data: Buffer.from(await file.arrayBuffer()),
  };
}
