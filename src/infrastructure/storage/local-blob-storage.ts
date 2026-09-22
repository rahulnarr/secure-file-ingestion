import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { BlobStorage } from "./blob-storage.js";

export class LocalBlobStorage implements BlobStorage {
  constructor(private readonly rootDir: string) {
    fs.mkdirSync(rootDir, { recursive: true });
  }

  async save(fileId: string, filename: string, data: Buffer): Promise<string> {
    const location = path.join(this.rootDir, `${fileId}-${sanitizeFilename(filename)}`);
    await fsp.writeFile(location, data);
    return location;
  }

  async exists(location: string): Promise<boolean> {
    try {
      await fsp.access(location);
      return true;
    } catch {
      return false;
    }
  }

  read(location: string): Promise<Buffer> {
    return fsp.readFile(location);
  }

  async remove(location: string): Promise<void> {
    await fsp.rm(location, { force: true });
  }
}

function sanitizeFilename(filename: string): string {
  const base = path.basename(filename).replace(/[^\w.\-()+ ]+/g, "_");
  return base.slice(0, 180) || "upload.bin";
}
