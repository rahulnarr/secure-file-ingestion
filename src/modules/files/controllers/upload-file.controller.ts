import type { Context } from "hono";
import { ValidationError } from "../../../common/errors/domain-errors.js";
import type { AppEnv } from "../../../common/types/app-env.js";
import { toFileUpload, toPublicFile } from "../file.mapper.js";
import type { UploadFileService } from "../services/upload-file.service.js";

export class UploadFileController {
  constructor(private readonly uploadFile: UploadFileService) {}

  handle = async (c: Context<AppEnv>) => {
    const body = await c.req.parseBody();
    const field = body.file;

    if (!(field instanceof File)) {
      throw new ValidationError("multipart field 'file' is required", "MISSING_FILE");
    }

    const record = await this.uploadFile.execute(c.get("userId"), await toFileUpload(field));
    return c.json({ file: toPublicFile(record) }, 201);
  };
}
