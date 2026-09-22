import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalBlobStorage } from "../../src/infrastructure/storage/local-blob-storage.js";

describe("LocalBlobStorage", () => {
  let root: string;
  let storage: LocalBlobStorage;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "blob-storage-"));
    storage = new LocalBlobStorage(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("creates the root directory if it doesn't exist", () => {
    const fresh = path.join(root, "nested", "dir");
    expect(fs.existsSync(fresh)).toBe(false);
    new LocalBlobStorage(fresh);
    expect(fs.existsSync(fresh)).toBe(true);
  });

  it("saves, reads, checks existence of, and removes a blob", async () => {
    const location = await storage.save("file-1", "notes.txt", Buffer.from("hello"));
    expect(location).toContain("file-1-notes.txt");

    await expect(storage.exists(location)).resolves.toBe(true);
    await expect(storage.read(location)).resolves.toEqual(Buffer.from("hello"));

    await storage.remove(location);
    await expect(storage.exists(location)).resolves.toBe(false);
  });

  it("sanitizes unsafe characters and path traversal attempts in the filename", async () => {
    const location = await storage.save("file-2", "../../etc/passwd", Buffer.from("x"));
    expect(path.dirname(location)).toBe(root);
    expect(path.basename(location)).toBe("file-2-passwd");
  });

  it("falls back to a default name when given an empty filename", async () => {
    const location = await storage.save("file-3", "", Buffer.from("x"));
    expect(path.basename(location)).toBe("file-3-upload.bin");
  });

  it("collapses a run of unsafe characters into a single underscore", async () => {
    const location = await storage.save("file-4", "???.txt", Buffer.from("x"));
    expect(path.basename(location)).toBe("file-4-_.txt");
  });

  it("remove() on a missing blob does not throw", async () => {
    await expect(storage.remove(path.join(root, "does-not-exist"))).resolves.toBeUndefined();
  });
});
