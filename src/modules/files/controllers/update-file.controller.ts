import type { Context } from "hono";
import type { AppEnv } from "../../../common/types/app-env.js";
import { parseJsonBody } from "../../../common/validation/parse-json-body.js";
import { toPublicFile } from "../file.mapper.js";
import { updateFileSchema } from "../file.schemas.js";
import type { UpdateFileService } from "../services/update-file.service.js";

export class UpdateFileController {
  constructor(private readonly updateFile: UpdateFileService) {}

  handle = async (c: Context<AppEnv>) => {
    const updates = await parseJsonBody(c, updateFileSchema, {
      message: "Invalid update payload",
      code: "INVALID_UPDATE",
    });
    const file = await this.updateFile.execute(c.req.param("fileId")!, c.get("userId"), updates);
    return c.json({ file: toPublicFile(file) });
  };
}
