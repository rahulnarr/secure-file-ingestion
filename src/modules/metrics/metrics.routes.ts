import { Hono } from "hono";
import type { GetMetricsController } from "./controllers/get-metrics.controller.js";

export function createMetricsRoutes(controllers: { get: GetMetricsController }) {
  const router = new Hono();
  router.get("/", controllers.get.handle);
  return router;
}
