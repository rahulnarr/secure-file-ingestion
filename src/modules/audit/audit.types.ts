export type AuditEventType =
  | "signed_link_generated"
  | "signed_link_revoked"
  | "signed_link_downloaded"
  | "signed_link_download_rejected"
  | "file_renamed"
  | "file_deleted";

export type AuditEvent = {
  id: string;
  file_id: string;
  user_id: string;
  event_type: AuditEventType;
  ttl_seconds: number | null;
  expires_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type NewAuditEvent = {
  fileId: string;
  userId: string;
  eventType: AuditEventType;
  ttlSeconds?: number | null;
  expiresAt?: string | null;
  metadata?: Record<string, unknown> | null;
};
