import type { SignedLinkRecord } from "./signed-link.types.js";

export function toPublicSignedLink(link: SignedLinkRecord) {
  return {
    id: link.id,
    fileId: link.file_id,
    ttlSeconds: link.ttl_seconds,
    expiresAt: link.expires_at,
    createdAt: link.created_at,
    revokedAt: link.revoked_at,
    status: link.revoked_at ? ("revoked" as const) : ("active" as const),
  };
}
