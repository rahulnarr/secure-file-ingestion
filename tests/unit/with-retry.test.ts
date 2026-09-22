import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import {
  isRetryableDatabaseError,
  isRetryableStorageError,
} from "../../src/infrastructure/resilience/error-classifiers.js";
import { withRetry } from "../../src/infrastructure/resilience/with-retry.js";

const silentLogger = pino({ level: "silent" });
const fastPolicy = { maxAttempts: 4, baseDelayMs: 1, maxDelayMs: 5, maxElapsedMs: 1000 };

function pgError(code: string) {
  const error = new Error("connection failure");
  (error as Error & { code: string }).code = code;
  return error;
}

describe("error classifiers", () => {
  it("flags known-transient Postgres and network codes as retryable", () => {
    expect(isRetryableDatabaseError(pgError("40001"))).toBe(true); // serialization_failure
    expect(isRetryableDatabaseError(pgError("57P03"))).toBe(true); // cannot_connect_now
    expect(isRetryableDatabaseError(pgError("ECONNRESET"))).toBe(true);
  });

  it("does not flag permanent Postgres failures as retryable", () => {
    expect(isRetryableDatabaseError(pgError("23505"))).toBe(false); // unique_violation
    expect(isRetryableDatabaseError(new Error("boom"))).toBe(false);
  });

  it("flags known-transient filesystem codes as retryable, but not permanent ones", () => {
    expect(isRetryableStorageError(pgError("EBUSY"))).toBe(true);
    expect(isRetryableStorageError(pgError("EAGAIN"))).toBe(true);
    expect(isRetryableStorageError(pgError("ENOENT"))).toBe(false);
    expect(isRetryableStorageError(pgError("ENOSPC"))).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns the result on the first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, fastPolicy, () => true, silentLogger, {
      operation: "test.op",
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable failure with exponential backoff and eventually succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(pgError("ECONNRESET"))
      .mockRejectedValueOnce(pgError("ECONNRESET"))
      .mockResolvedValueOnce("recovered");

    const result = await withRetry(fn, fastPolicy, isRetryableDatabaseError, silentLogger, {
      operation: "test.retryable",
    });

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("stops immediately on a non-retryable error without exhausting attempts", async () => {
    const fn = vi.fn().mockRejectedValue(pgError("23505"));

    await expect(
      withRetry(fn, fastPolicy, isRetryableDatabaseError, silentLogger, { operation: "test.op" }),
    ).rejects.toMatchObject({ code: "23505" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxAttempts even if every failure is retryable", async () => {
    const fn = vi.fn().mockRejectedValue(pgError("ECONNRESET"));

    await expect(
      withRetry(fn, fastPolicy, isRetryableDatabaseError, silentLogger, { operation: "test.op" }),
    ).rejects.toMatchObject({ code: "ECONNRESET" });
    expect(fn).toHaveBeenCalledTimes(fastPolicy.maxAttempts);
  });

  it("gives up early once the elapsed-time budget is exhausted", async () => {
    const tightPolicy = { maxAttempts: 10, baseDelayMs: 50, maxDelayMs: 50, maxElapsedMs: 40 };
    const fn = vi.fn().mockRejectedValue(pgError("ECONNRESET"));

    await expect(
      withRetry(fn, tightPolicy, isRetryableDatabaseError, silentLogger, { operation: "test.op" }),
    ).rejects.toMatchObject({ code: "ECONNRESET" });
    // At 50ms/attempt against a 40ms budget, it should give up well before 10 attempts.
    expect(fn.mock.calls.length).toBeLessThan(10);
  });
});
