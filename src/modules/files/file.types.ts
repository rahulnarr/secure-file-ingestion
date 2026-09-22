export type FileRecord = {
  id: string;
  user_id: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
};

export type NewFileRecord = {
  id: string;
  userId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  storagePath: string;
};

export type FileUpload = {
  filename: string;
  contentType: string;
  data: Buffer;
};
