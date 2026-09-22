import type { Context } from "hono";
import type { AppEnv } from "../../../common/types/app-env.js";
import type { DeleteFileService } from "../services/delete-file.service.js";

export class DeleteFileController {
  constructor(private readonly deleteFile: DeleteFileService) {}

  handle = async (c: Context<AppEnv>) => {
    const fileId = c.req.param("fileId")!;
    await this.deleteFile.execute(fileId, c.get("userId"));
    return c.json({ deleted: true, fileId });
  };
}
