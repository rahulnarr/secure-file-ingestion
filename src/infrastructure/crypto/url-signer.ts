import { createHmac, timingSafeEqual } from "node:crypto";

export type SignedUrl = {
  url: string;
  expiresAt: number;
  signature: string;
};

export type SignatureVerification =
  | { ok: true; fileId: string; expiresAt: number }
  | { ok: false; reason: string };

/**
 * HMAC-SHA256 over `fileId.expiresAt`. Validity depends only on the secret and
 * the claims, never on in-memory state, so links survive process restarts.
 */
export class UrlSigner {
  constructor(
    private readonly secret: string,
    private readonly baseUrl: string,
  ) {}

  sign(fileId: string, ttlSeconds: number, nowMs: number = Date.now()): SignedUrl {
    const expiresAt = Math.floor(nowMs / 1000) + ttlSeconds;
    const signature = this.computeSignature(fileId, expiresAt);

    const url = new URL("/download", this.baseUrl);
    url.searchParams.set("fileId", fileId);
    url.searchParams.set("expires", String(expiresAt));
    url.searchParams.set("sig", signature);

    return { url: url.toString(), expiresAt, signature };
  }

  verify(params: {
    fileId: string;
    expires: string;
    signature: string;
    nowMs?: number;
  }): SignatureVerification {
    const expiresAt = Number(params.expires);
    if (!Number.isInteger(expiresAt)) {
      return { ok: false, reason: "Invalid expiration claim" };
    }
    if (!params.fileId || !params.signature) {
      return { ok: false, reason: "Missing signature parameters" };
    }

    const nowSeconds = Math.floor((params.nowMs ?? Date.now()) / 1000);
    if (expiresAt < nowSeconds) {
      return { ok: false, reason: "Signed link has expired" };
    }

    const expected = this.computeSignature(params.fileId, expiresAt);
    if (!hexEqual(expected, params.signature)) {
      return { ok: false, reason: "Invalid signature" };
    }

    return { ok: true, fileId: params.fileId, expiresAt };
  }

  private computeSignature(fileId: string, expiresAt: number): string {
    return createHmac("sha256", this.secret).update(`${fileId}.${expiresAt}`).digest("hex");
  }
}

function hexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length === 0 || bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
