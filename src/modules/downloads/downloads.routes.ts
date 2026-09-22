import { Hono } from "hono";
import type { DownloadFileController } from "./controllers/download-file.controller.js";

export function createDownloadsRoutes(controllers: { download: DownloadFileController }) {
  const router = new Hono();
  router.get("/", controllers.download.handle);
  return router;
}
