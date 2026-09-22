import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { BlobStorage } from "./blob-storage.js";

export type SpacesConfig = {
  endpoint: string; // e.g. https://nyc3.digitaloceanspaces.com
  region: string; // e.g. nyc3
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/**
 * File blobs in a DigitalOcean Spaces bucket (S3-compatible object storage)
 * instead of local disk. This is what makes the API stateless: any instance
 * can serve any file, which is the actual precondition for running on App
 * Platform (ephemeral, horizontally-scaled containers) instead of a single
 * Droplet with a persistent volume — see docs/architecture.md.
 *
 * `location` returned by save() is the object key; existing rows written
 * under LocalBlobStorage aren't portable to this (and vice versa), since
 * the two store fundamentally different kinds of path in the same DB
 * column. That's expected: this is a deployment-target choice, not a live
 * migration tool.
 */
export class SpacesBlobStorage implements BlobStorage {
  private readonly client: S3Client;

  constructor(private readonly config: SpacesConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // DO Spaces (and most S3-compatible providers) need path-style off;
      // the SDK's virtual-hosted-style default matches Spaces' bucket.endpoint layout.
      forcePathStyle: false,
    });
  }

  async save(fileId: string, filename: string, data: Buffer): Promise<string> {
    const key = `${fileId}-${sanitizeKey(filename)}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: data,
        ACL: "private",
      }),
    );
    return key;
  }

  async exists(location: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: location }));
      return true;
    } catch (error) {
      if (error instanceof NotFound) return false;
      if ((error as { name?: string }).name === "NotFound") return false;
      throw error;
    }
  }

  async read(location: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: location }),
    );
    const bytes = await result.Body?.transformToByteArray();
    return Buffer.from(bytes ?? new Uint8Array());
  }

  async remove(location: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: location }));
  }
}

function sanitizeKey(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "";
  const cleaned = base.replace(/[^\w.\-()+ ]+/g, "_");
  return cleaned.slice(0, 180) || "upload.bin";
}
