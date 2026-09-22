import { Hono } from "hono";
import { swaggerUI } from "@hono/swagger-ui";
import { createErrorHandler, createNotFoundHandler } from "./common/errors/error-handler.js";
import { createMetricsMiddleware } from "./common/middleware/metrics-middleware.js";
import { requireUser } from "./common/middleware/require-user.js";
import type { AppEnv } from "./common/types/app-env.js";
import type { Container } from "./container.js";
import { openApiDocument } from "./docs/openapi.js";
import { createAuditRoutes } from "./modules/audit/audit.routes.js";
import { createDownloadsRoutes } from "./modules/downloads/downloads.routes.js";
import { createFilesRoutes } from "./modules/files/files.routes.js";
import { createHealthRoutes } from "./modules/health/health.routes.js";
import { createMetricsRoutes } from "./modules/metrics/metrics.routes.js";
import { createSignedLinksRoutes } from "./modules/signed-links/signed-links.routes.js";

export function createApp(container: Container) {
  const app = new Hono<AppEnv>();

  // Every request, success or failure, is measured — this must wrap
  // everything else so it also captures 401/404/500 responses.
  app.use("*", createMetricsMiddleware(container.metrics));

  app.use("/files", requireUser);
  app.use("/files/*", requireUser);

  app.route("/health", createHealthRoutes(container.health));
  app.route("/files", createFilesRoutes(container.files));
  app.route("/files", createSignedLinksRoutes(container.signedLinks));
  app.route("/files", createAuditRoutes(container.audit));
  app.route("/download", createDownloadsRoutes(container.downloads));
  app.route("/metrics", createMetricsRoutes(container.metricsModule));

  // Interactive, always-current API documentation for every endpoint above.
  app.get("/openapi.json", (c) => c.json(openApiDocument));
  app.get("/docs", swaggerUI({ url: "/openapi.json" }));

  app.onError(createErrorHandler(container.logger, container.metrics));
  app.notFound(createNotFoundHandler(container.logger));

  return app;
}
