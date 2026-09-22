export type SignedLinkRecord = {
  id: string;
  file_id: string;
  user_id: string;
  signature: string;
  ttl_seconds: number;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
};

export type NewSignedLink = {
  id: string;
  fileId: string;
  userId: string;
  signature: string;
  ttlSeconds: number;
  expiresAt: string;
};
