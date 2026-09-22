import { createHmac, timingSafeEqual } from "node:crypto";

export type SignedDownloadClaims = {
  fileId: string;
  expiresAt: number;
};

/**
 * Build a restart-safe signed download URL using HMAC-SHA256.
 * Validity depends only on the shared secret and claim payload — not in-memory state.
 */
export function createSignedDownloadUrl(options: {
  baseUrl: string;
  secret: string;
  fileId: string;
  ttlSeconds: number;
  nowMs?: number;
}): { url: string; expiresAt: number; signature: string } {
  const nowMs = options.nowMs ?? Date.now();
  const expiresAt = Math.floor(nowMs / 1000) + options.ttlSeconds;
  const signature = signClaims(options.secret, {
    fileId: options.fileId,
    expiresAt,
  });

  const url = new URL("/download", options.baseUrl);
  url.searchParams.set("fileId", options.fileId);
  url.searchParams.set("expires", String(expiresAt));
  url.searchParams.set("sig", signature);

  return { url: url.toString(), expiresAt, signature };
}

export function verifySignedDownload(options: {
  secret: string;
  fileId: string;
  expires: string;
  signature: string;
  nowMs?: number;
}): { ok: true; claims: SignedDownloadClaims } | { ok: false; reason: string } {
  const expiresAt = Number(options.expires);
  if (!Number.isFinite(expiresAt) || !Number.isInteger(expiresAt)) {
    return { ok: false, reason: "Invalid expiration claim" };
  }

  if (!options.fileId || !options.signature) {
    return { ok: false, reason: "Missing signature parameters" };
  }

  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (expiresAt < nowSeconds) {
    return { ok: false, reason: "Signed link has expired" };
  }

  const expected = signClaims(options.secret, {
    fileId: options.fileId,
    expiresAt,
  });

  if (!hexSignaturesEqual(expected, options.signature)) {
    return { ok: false, reason: "Invalid signature" };
  }

  return {
    ok: true,
    claims: { fileId: options.fileId, expiresAt },
  };
}

function signClaims(secret: string, claims: SignedDownloadClaims): string {
  const payload = `${claims.fileId}.${claims.expiresAt}`;
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function hexSignaturesEqual(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    if (bufA.length === 0 || bufA.length !== bufB.length) {
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}
