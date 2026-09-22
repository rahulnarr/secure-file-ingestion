import type { AuditEvent } from "./audit.types.js";

export function toPublicAuditEvent(event: AuditEvent) {
  return {
    id: event.id,
    fileId: event.file_id,
    userId: event.user_id,
    eventType: event.event_type,
    ttlSeconds: event.ttl_seconds,
    expiresAt: event.expires_at,
    metadata: event.metadata,
    createdAt: event.created_at,
  };
}
