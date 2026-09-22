export interface BlobStorage {
  /** Persists bytes and returns an opaque location used for later reads/deletes. */
  save(fileId: string, filename: string, data: Buffer): Promise<string>;
  exists(location: string): Promise<boolean>;
  read(location: string): Promise<Buffer>;
  remove(location: string): Promise<void>;
}
