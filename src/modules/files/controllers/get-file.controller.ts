import type { Context } from "hono";
import type { AppEnv } from "../../../common/types/app-env.js";
import { toPublicFile } from "../file.mapper.js";
import type { GetFileService } from "../services/get-file.service.js";

export class GetFileController {
  constructor(private readonly getFile: GetFileService) {}

  handle = async (c: Context<AppEnv>) => {
    const file = await this.getFile.execute(c.req.param("fileId")!, c.get("userId"));
    return c.json({ file: toPublicFile(file) });
  };
}
