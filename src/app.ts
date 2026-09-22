import { Hono } from "hono";
import type { AppConfig } from "./config.js";
import type { FileService } from "./services/files.js";
import { HttpError } from "./services/files.js";
import { createFilesRouter } from "./routes/files.js";
import { createDownloadRouter } from "./routes/download.js";

export function createApp(files: FileService, config: AppConfig) {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      service: "signed-file-api",
      maxUploadBytes: config.MAX_UPLOAD_BYTES,
    }),
  );

  app.route("/files", createFilesRouter(files));
  app.route("/download", createDownloadRouter(files, config));

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: err.message, code: err.code }, err.status as 400);
    }

    console.error("Unhandled error", err);
    return c.json({ error: "Internal server error", code: "INTERNAL" }, 500);
  });

  app.notFound((c) => c.json({ error: "Not found", code: "NOT_FOUND" }, 404));

  return app;
}
