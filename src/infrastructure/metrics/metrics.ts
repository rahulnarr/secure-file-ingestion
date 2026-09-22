import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

/**
 * Central Prometheus-compatible metrics registry. Exposed at GET /metrics
 * in the standard text exposition format, so it can be scraped directly by
 * Prometheus, or by the Datadog Agent's Prometheus/OpenMetrics check —
 * moving to either later needs zero application code changes, just pointing
 * a scraper at this endpoint.
 *
 * Two kinds of signal are tracked:
 *   - HTTP-level: request volume, latency, and status code per route.
 *   - Per-layer failures: every AppError that reaches the global error
 *     handler, tagged by which layer/class it came from and whether it was
 *     retryable, plus retry attempts/exhaustion from the resilience layer.
 * Together these are exactly what an on-call engineer or an alerting rule
 * (e.g. "error rate for the database layer > 5% over 5m") needs, without
 * having to grep structured logs.
 */
export class Metrics {
  readonly registry: Registry;

  readonly httpRequestsTotal: Counter<"method" | "route" | "status_code">;
  readonly httpRequestDurationSeconds: Histogram<"method" | "route" | "status_code">;

  readonly serviceErrorsTotal: Counter<"layer" | "code" | "retryable">;

  readonly retryAttemptsTotal: Counter<"operation">;
  readonly retryExhaustedTotal: Counter<"operation">;

  constructor() {
    this.registry = new Registry();
    collectDefaultMetrics({ register: this.registry });

    this.httpRequestsTotal = new Counter({
      name: "http_requests_total",
      help: "Total HTTP requests, by method, route, and status code",
      labelNames: ["method", "route", "status_code"],
      registers: [this.registry],
    });

    this.httpRequestDurationSeconds = new Histogram({
      name: "http_request_duration_seconds",
      help: "HTTP request duration in seconds, by method, route, and status code",
      labelNames: ["method", "route", "status_code"],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.serviceErrorsTotal = new Counter({
      name: "service_errors_total",
      help: "Total errors raised, by originating layer, error code, and whether it was retryable",
      labelNames: ["layer", "code", "retryable"],
      registers: [this.registry],
    });

    this.retryAttemptsTotal = new Counter({
      name: "retry_attempts_total",
      help: "Total retry attempts against a transient failure, by operation",
      labelNames: ["operation"],
      registers: [this.registry],
    });

    this.retryExhaustedTotal = new Counter({
      name: "retry_exhausted_total",
      help: "Total times the retry budget was exhausted for an operation",
      labelNames: ["operation"],
      registers: [this.registry],
    });
  }

  recordHttpRequest(method: string, route: string, statusCode: number, durationSeconds: number): void {
    const labels = { method, route, status_code: String(statusCode) };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDurationSeconds.observe(labels, durationSeconds);
  }

  recordServiceError(layer: string, code: string, isRetryable: boolean): void {
    this.serviceErrorsTotal.inc({ layer, code, retryable: String(isRetryable) });
  }

  recordRetryAttempt(operation: string): void {
    this.retryAttemptsTotal.inc({ operation });
  }

  recordRetryExhausted(operation: string): void {
    this.retryExhaustedTotal.inc({ operation });
  }

  async toPrometheusText(): Promise<string> {
    return this.registry.metrics();
  }
}
