import { Hono } from "hono";
import type { HealthController } from "./controllers/health.controller.js";

export function createHealthRoutes(controllers: { health: HealthController }) {
  const router = new Hono();
  router.get("/", controllers.health.handle);
  return router;
}
