import type { Context } from "hono";
import type { Metrics } from "../../../infrastructure/metrics/metrics.js";

/** GET /metrics — Prometheus text exposition format. Scrape this directly,
 * or point the Datadog Agent's OpenMetrics/Prometheus check at it. */
export class GetMetricsController {
  constructor(private readonly metrics: Metrics) {}

  handle = async (c: Context) => {
    c.header("Content-Type", this.metrics.registry.contentType);
    return c.body(await this.metrics.toPrometheusText());
  };
}
