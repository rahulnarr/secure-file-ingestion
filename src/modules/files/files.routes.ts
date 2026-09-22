import { Hono } from "hono";
import type { AppEnv } from "../../common/types/app-env.js";
import type { BatchDeleteFilesController } from "./controllers/batch-delete-files.controller.js";
import type { BatchUploadFilesController } from "./controllers/batch-upload-files.controller.js";
import type { DeleteFileController } from "./controllers/delete-file.controller.js";
import type { GetFileController } from "./controllers/get-file.controller.js";
import type { ListFilesController } from "./controllers/list-files.controller.js";
import type { UpdateFileController } from "./controllers/update-file.controller.js";
import type { UploadFileController } from "./controllers/upload-file.controller.js";

export type FilesControllers = {
  upload: UploadFileController;
  batchUpload: BatchUploadFilesController;
  list: ListFilesController;
  get: GetFileController;
  update: UpdateFileController;
  delete: DeleteFileController;
  batchDelete: BatchDeleteFilesController;
};

export function createFilesRoutes(controllers: FilesControllers) {
  const router = new Hono<AppEnv>();

  router.post("/", controllers.upload.handle);
  router.post("/batch", controllers.batchUpload.handle);
  router.post("/batch-delete", controllers.batchDelete.handle);
  router.get("/", controllers.list.handle);
  router.get("/:fileId", controllers.get.handle);
  router.patch("/:fileId", controllers.update.handle);
  router.delete("/:fileId", controllers.delete.handle);

  return router;
}
