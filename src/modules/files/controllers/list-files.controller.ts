import type { Context } from "hono";
import type { AppEnv } from "../../../common/types/app-env.js";
import { toPublicFile } from "../file.mapper.js";
import type { ListFilesService } from "../services/list-files.service.js";

export class ListFilesController {
  constructor(private readonly listFiles: ListFilesService) {}

  handle = async (c: Context<AppEnv>) => {
    const files = await this.listFiles.execute(c.get("userId"));
    return c.json({ files: files.map(toPublicFile) });
  };
}
