import { describe, expect, it, vi } from "vitest";
import { computeBackoffDelay, sleep } from "../../src/infrastructure/resilience/backoff.js";

describe("computeBackoffDelay", () => {
  it("grows exponentially and stays within [0.5x, 1x] of the theoretical delay due to jitter", () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const theoretical = 100 * 2 ** (attempt - 1);
      const delay = computeBackoffDelay(attempt, 100, 10_000);
      expect(delay).toBeGreaterThanOrEqual(Math.floor(theoretical * 0.5));
      expect(delay).toBeLessThanOrEqual(theoretical);
    }
  });

  it("caps the delay at maxDelayMs regardless of attempt number", () => {
    const delay = computeBackoffDelay(10, 100, 500);
    expect(delay).toBeLessThanOrEqual(500);
  });
});

describe("sleep", () => {
  it("resolves after roughly the requested duration", async () => {
    vi.useFakeTimers();
    const promise = sleep(1000);
    let resolved = false;
    promise.then(() => (resolved = true));

    await vi.advanceTimersByTimeAsync(999);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
    vi.useRealTimers();
  });
});
