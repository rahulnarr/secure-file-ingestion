import { Hono } from "hono";
import { errorHandler, notFoundHandler } from "./common/errors/error-handler.js";
import { requireUser } from "./common/middleware/require-user.js";
import type { AppEnv } from "./common/types/app-env.js";
import type { Container } from "./container.js";
import { createAuditRoutes } from "./modules/audit/audit.routes.js";
import { createDownloadsRoutes } from "./modules/downloads/downloads.routes.js";
import { createFilesRoutes } from "./modules/files/files.routes.js";
import { createHealthRoutes } from "./modules/health/health.routes.js";
import { createSignedLinksRoutes } from "./modules/signed-links/signed-links.routes.js";

export function createApp(container: Container) {
  const app = new Hono<AppEnv>();

  app.use("/files", requireUser);
  app.use("/files/*", requireUser);

  app.route("/health", createHealthRoutes(container.health));
  app.route("/files", createFilesRoutes(container.files));
  app.route("/files", createSignedLinksRoutes(container.signedLinks));
  app.route("/files", createAuditRoutes(container.audit));
  app.route("/download", createDownloadsRoutes(container.downloads));

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  return app;
}
