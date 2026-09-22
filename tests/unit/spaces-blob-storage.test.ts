import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpacesBlobStorage } from "../../src/infrastructure/storage/spaces-blob-storage.js";

const config = {
  endpoint: "https://nyc3.digitaloceanspaces.com",
  region: "nyc3",
  bucket: "test-bucket",
  accessKeyId: "AKIA_TEST",
  secretAccessKey: "secret",
};

describe("SpacesBlobStorage", () => {
  let sendSpy: ReturnType<typeof vi.spyOn>;
  const objects = new Map<string, Buffer>();

  beforeEach(() => {
    objects.clear();
    sendSpy = vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command: unknown) => {
      if (command instanceof PutObjectCommand) {
        objects.set(command.input.Key!, Buffer.from(command.input.Body as Buffer));
        expect(command.input.Bucket).toBe(config.bucket);
        expect(command.input.ACL).toBe("private");
        return {};
      }
      if (command instanceof HeadObjectCommand) {
        if (!objects.has(command.input.Key!)) {
          throw new NotFound({ message: "not found", $metadata: {} });
        }
        return {};
      }
      if (command instanceof GetObjectCommand) {
        const body = objects.get(command.input.Key!);
        if (!body) throw new NotFound({ message: "not found", $metadata: {} });
        return { Body: { transformToByteArray: async () => new Uint8Array(body) } };
      }
      if (command instanceof DeleteObjectCommand) {
        objects.delete(command.input.Key!);
        return {};
      }
      throw new Error(`Unexpected command: ${command?.constructor?.name}`);
    });
  });

  afterEach(() => {
    sendSpy.mockRestore();
  });

  it("saves, checks existence of, reads, and removes a blob by object key", async () => {
    const storage = new SpacesBlobStorage(config);

    const key = await storage.save("file-1", "notes.txt", Buffer.from("hello"));
    expect(key).toBe("file-1-notes.txt");

    await expect(storage.exists(key)).resolves.toBe(true);
    await expect(storage.read(key)).resolves.toEqual(Buffer.from("hello"));

    await storage.remove(key);
    await expect(storage.exists(key)).resolves.toBe(false);
  });

  it("sanitizes path separators and unsafe characters out of the object key", async () => {
    const storage = new SpacesBlobStorage(config);
    const key = await storage.save("file-2", "../../etc/passwd", Buffer.from("x"));
    expect(key).toBe("file-2-passwd");
  });

  it("propagates non-NotFound errors from exists()", async () => {
    sendSpy.mockRejectedValueOnce(new Error("network blip"));
    const storage = new SpacesBlobStorage(config);
    await expect(storage.exists("whatever")).rejects.toThrow("network blip");
  });
});
