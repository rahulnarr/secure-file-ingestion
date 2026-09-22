import { z } from "zod";

export const MAX_TTL_SECONDS = 86_400;

export const createSignedLinkSchema = z.object({
  ttlSeconds: z.coerce.number().int().min(1).max(MAX_TTL_SECONDS),
});
