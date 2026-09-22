import { Hono } from "hono";
import type { AppEnv } from "../../common/types/app-env.js";
import type { ListAuditEventsController } from "./controllers/list-audit-events.controller.js";

export function createAuditRoutes(controllers: { list: ListAuditEventsController }) {
  const router = new Hono<AppEnv>();
  router.get("/:fileId/audit", controllers.list.handle);
  return router;
}
