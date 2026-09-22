import type { Context } from "hono";
import type { AppEnv } from "../../../common/types/app-env.js";
import { parseJsonBody } from "../../../common/validation/parse-json-body.js";
import { batchDeleteFilesSchema } from "../file.schemas.js";
import type { BatchDeleteFilesService } from "../services/batch-delete-files.service.js";

export class BatchDeleteFilesController {
  constructor(private readonly batchDelete: BatchDeleteFilesService) {}

  handle = async (c: Context<AppEnv>) => {
    const { fileIds } = await parseJsonBody(c, batchDeleteFilesSchema, {
      message: "fileIds must be a non-empty array of UUIDs",
      code: "INVALID_BATCH_DELETE",
    });
    const result = await this.batchDelete.execute(c.get("userId"), fileIds);
    return c.json(result, result.failed.length === 0 ? 200 : 207);
  };
}
