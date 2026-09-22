import { z } from "zod";

/** maxTtlSeconds comes from AppConfig (MAX_TTL_SECONDS) — see src/config/env.ts. */
export function createSignedLinkSchema(maxTtlSeconds: number) {
  return z.object({
    ttlSeconds: z.coerce.number().int().min(1).max(maxTtlSeconds),
  });
}
