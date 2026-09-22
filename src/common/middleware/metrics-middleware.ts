import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import type { Metrics } from "../../infrastructure/metrics/metrics.js";

/**
 * Records request volume and latency for every request, tagged by the
 * matched route *pattern* (e.g. "/files/:fileId", not the literal path with
 * a UUID in it) so metric cardinality stays bounded regardless of traffic.
 */
export function createMetricsMiddleware(metrics: Metrics): MiddlewareHandler {
  return async (c, next) => {
    const start = process.hrtime.bigint();
    await next();
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    const route = routePath(c) || c.req.path;
    metrics.recordHttpRequest(c.req.method, route, c.res.status, durationSeconds);
  };
}
