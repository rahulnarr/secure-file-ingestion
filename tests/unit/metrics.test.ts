import { describe, expect, it } from "vitest";
import { Metrics } from "../../src/infrastructure/metrics/metrics.js";

describe("Metrics", () => {
  it("records HTTP request counts and latency, exposed in Prometheus text format", async () => {
    const metrics = new Metrics();
    metrics.recordHttpRequest("GET", "/files/:fileId", 200, 0.05);
    metrics.recordHttpRequest("GET", "/files/:fileId", 404, 0.01);

    const text = await metrics.toPrometheusText();
    expect(text).toContain('http_requests_total{method="GET",route="/files/:fileId",status_code="200"} 1');
    expect(text).toContain('http_requests_total{method="GET",route="/files/:fileId",status_code="404"} 1');
    expect(text).toContain("http_request_duration_seconds");
  });

  it("records per-layer service errors with retryability", async () => {
    const metrics = new Metrics();
    metrics.recordServiceError("domain", "FORBIDDEN", false);
    metrics.recordServiceError("database", "RETRY_EXHAUSTED", true);

    const text = await metrics.toPrometheusText();
    expect(text).toContain('service_errors_total{layer="domain",code="FORBIDDEN",retryable="false"} 1');
    expect(text).toContain('service_errors_total{layer="database",code="RETRY_EXHAUSTED",retryable="true"} 1');
  });

  it("records retry attempts and exhaustion by operation", async () => {
    const metrics = new Metrics();
    metrics.recordRetryAttempt("FileRepository.insert");
    metrics.recordRetryAttempt("FileRepository.insert");
    metrics.recordRetryExhausted("FileRepository.insert");

    const text = await metrics.toPrometheusText();
    expect(text).toContain('retry_attempts_total{operation="FileRepository.insert"} 2');
    expect(text).toContain('retry_exhausted_total{operation="FileRepository.insert"} 1');
  });

  it("exposes the registry's content type for the /metrics response header", () => {
    const metrics = new Metrics();
    expect(metrics.registry.contentType).toContain("text/plain");
  });
});
