import type { Context } from "hono";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { createErrorHandler, createNotFoundHandler } from "../../src/common/errors/error-handler.js";
import {
  ForbiddenError,
  GoneError,
  NotFoundError,
  PayloadTooLargeError,
  UnauthorizedError,
  ValidationError,
} from "../../src/common/errors/domain-errors.js";
import { HttpError } from "../../src/common/errors/http-error.js";
import { DatabaseError, RetryExhaustedError, StorageError } from "../../src/common/errors/infrastructure-errors.js";
import { Metrics } from "../../src/infrastructure/metrics/metrics.js";

const silentLogger = pino({ level: "silent" });

function fakeContext(): Context {
  return {
    req: { method: "GET", path: "/files/abc" },
    json: vi.fn((body: unknown, status: number) => ({ body, status })),
  } as unknown as Context;
}

describe("createErrorHandler", () => {
  it("responds with the error's status/code/message and logs+counts it as 'domain'", async () => {
    const metrics = new Metrics();
    const handler = createErrorHandler(silentLogger, metrics);
    const c = fakeContext();

    const response = await handler(new ForbiddenError("nope", "FORBIDDEN"), c);

    expect(response).toEqual({ body: { error: "nope", code: "FORBIDDEN" }, status: 403 });
    const text = await metrics.toPrometheusText();
    expect(text).toContain('service_errors_total{layer="domain",code="FORBIDDEN",retryable="false"} 1');
  });

  it.each([
    [new ValidationError("bad", "BAD"), 400],
    [new NotFoundError("nope", "NF"), 404],
    [new UnauthorizedError("no", "NO"), 401],
    [new GoneError("gone", "GONE"), 410],
    [new PayloadTooLargeError("big", "BIG"), 413],
    [new HttpError(418, "teapot", "TEAPOT"), 418],
  ])("maps %o to status %i and layer 'domain'", async (error, status) => {
    const metrics = new Metrics();
    const handler = createErrorHandler(silentLogger, metrics);
    const response = (await handler(error, fakeContext())) as { status: number };
    expect(response.status).toBe(status);
    const text = await metrics.toPrometheusText();
    expect(text).toContain('layer="domain"');
  });

  it("tags DatabaseError as layer 'database'", async () => {
    const metrics = new Metrics();
    const handler = createErrorHandler(silentLogger, metrics);
    await handler(new DatabaseError("boom", { isRetryable: false }), fakeContext());
    const text = await metrics.toPrometheusText();
    expect(text).toContain('layer="database"');
  });

  it("tags StorageError as layer 'storage'", async () => {
    const metrics = new Metrics();
    const handler = createErrorHandler(silentLogger, metrics);
    await handler(new StorageError("boom", { isRetryable: false }), fakeContext());
    const text = await metrics.toPrometheusText();
    expect(text).toContain('layer="storage"');
  });

  it("infers layer for RetryExhaustedError from the operation name in context", async () => {
    const metrics = new Metrics();
    const handler = createErrorHandler(silentLogger, metrics);

    await handler(
      new RetryExhaustedError("boom", { context: { operation: "BlobStorage.save" } }),
      fakeContext(),
    );
    await handler(
      new RetryExhaustedError("boom", { context: { operation: "FileRepository.insert" } }),
      fakeContext(),
    );
    await handler(new RetryExhaustedError("boom", {}), fakeContext());

    const text = await metrics.toPrometheusText();
    expect(text).toMatch(/retry_exhausted.*|layer="storage"/s);
    expect(text).toContain('layer="storage"');
    expect(text).toContain('layer="database"');
    expect(text).toContain('layer="unknown"');
  });

  it("logs and counts unrecognized errors as layer 'unknown' with a generic response", async () => {
    const metrics = new Metrics();
    const handler = createErrorHandler(silentLogger, metrics);
    const response = (await handler(new Error("boom"), fakeContext())) as { body: unknown; status: number };

    expect(response).toEqual({ body: { error: "Internal server error", code: "INTERNAL" }, status: 500 });
    const text = await metrics.toPrometheusText();
    expect(text).toContain('service_errors_total{layer="unknown",code="INTERNAL",retryable="false"} 1');
  });
});

describe("createNotFoundHandler", () => {
  it("returns a generic 404 body", () => {
    const handler = createNotFoundHandler(silentLogger);
    const response = handler(fakeContext()) as unknown as { body: unknown; status: number };
    expect(response).toEqual({ body: { error: "Not found", code: "NOT_FOUND" }, status: 404 });
  });
});
