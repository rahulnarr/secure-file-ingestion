import type { Context } from "hono";
import { ValidationError } from "../../../common/errors/domain-errors.js";
import type { AppEnv } from "../../../common/types/app-env.js";
import { toFileUpload, toPublicFile } from "../file.mapper.js";
import type { BatchUploadFilesService } from "../services/batch-upload-files.service.js";

/** Expects multipart field `files` repeated once per file. */
export class BatchUploadFilesController {
  constructor(private readonly batchUpload: BatchUploadFilesService) {}

  handle = async (c: Context<AppEnv>) => {
    const body = await c.req.parseBody({ all: true });
    const raw = body.files;
    const fields = (Array.isArray(raw) ? raw : [raw]).filter(
      (item): item is File => item instanceof File,
    );

    if (fields.length === 0) {
      throw new ValidationError("multipart field 'files' is required", "MISSING_FILES");
    }

    const uploads = await Promise.all(fields.map(toFileUpload));
    const result = await this.batchUpload.execute(c.get("userId"), uploads);

    return c.json(
      { uploaded: result.uploaded.map(toPublicFile), failed: result.failed },
      result.failed.length === 0 ? 201 : 207,
    );
  };
}
