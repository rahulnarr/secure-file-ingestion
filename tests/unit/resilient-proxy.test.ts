import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { DatabaseError, RetryExhaustedError } from "../../src/common/errors/infrastructure-errors.js";
import { isRetryableDatabaseError } from "../../src/infrastructure/resilience/error-classifiers.js";
import { wrapDatabaseError } from "../../src/infrastructure/resilience/error-wrappers.js";
import { makeResilient } from "../../src/infrastructure/resilience/resilient-proxy.js";

const silentLogger = pino({ level: "silent" });
const fastPolicy = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, maxElapsedMs: 1000 };

function pgError(code: string) {
  const error = new Error("db blip");
  (error as Error & { code: string }).code = code;
  return error;
}

class FakeRepository {
  findByIdImpl = vi.fn();
  async findById(id: string) {
    return this.findByIdImpl(id);
  }
}

describe("makeResilient", () => {
  it("retries a transient failure transparently and returns the eventual result", async () => {
    const repo = new FakeRepository();
    repo.findByIdImpl
      .mockRejectedValueOnce(pgError("ECONNRESET"))
      .mockResolvedValueOnce({ id: "abc" });

    const resilient = makeResilient(
      repo,
      fastPolicy,
      isRetryableDatabaseError,
      wrapDatabaseError,
      silentLogger,
      "FakeRepository",
    );

    await expect(resilient.findById("abc")).resolves.toEqual({ id: "abc" });
    expect(repo.findByIdImpl).toHaveBeenCalledTimes(2);
  });

  it("wraps a permanent failure as a typed DatabaseError with observability metadata", async () => {
    const repo = new FakeRepository();
    repo.findByIdImpl.mockRejectedValue(pgError("23505"));

    const resilient = makeResilient(
      repo,
      fastPolicy,
      isRetryableDatabaseError,
      wrapDatabaseError,
      silentLogger,
      "FakeRepository",
    );

    const error = await resilient.findById("abc").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).isRetryable).toBe(false);
    expect((error as DatabaseError).context).toMatchObject({ operation: "FakeRepository.findById" });
    expect((error as DatabaseError).cause).toBeInstanceOf(Error);
  });

  it("wraps an exhausted-but-transient failure as RetryExhaustedError", async () => {
    const repo = new FakeRepository();
    repo.findByIdImpl.mockRejectedValue(pgError("ECONNRESET"));

    const resilient = makeResilient(
      repo,
      fastPolicy,
      isRetryableDatabaseError,
      wrapDatabaseError,
      silentLogger,
      "FakeRepository",
    );

    const error = await resilient.findById("abc").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RetryExhaustedError);
    expect(repo.findByIdImpl).toHaveBeenCalledTimes(fastPolicy.maxAttempts);
  });
});
