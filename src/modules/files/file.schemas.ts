import { z } from "zod";
import { UUID_RE } from "../../common/validation/uuid.js";

export const updateFileSchema = z.object({
  filename: z.string().min(1).max(255).optional(),
});

export const batchDeleteFilesSchema = z.object({
  fileIds: z.array(z.string().regex(UUID_RE)).min(1),
});
