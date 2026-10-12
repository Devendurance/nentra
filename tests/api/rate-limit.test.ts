import { describe, expect, it } from "vitest";

import { MutationRateLimiter } from "@/server/api/rate-limit";

describe("process-local mutation rate limiter", () => {
  it("allows a bounded number of mutations in each time window", () => {
    let now = 1_000;
    const limiter = new MutationRateLimiter({
      limit: 2,
      windowMs: 500,
      maxKeys: 5,
      now: () => now,
    });

    expect(limiter.consume("operator:reset")).toMatchObject({
      allowed: true,
      remaining: 1,
      retryAfterMs: 0,
    });
    expect(limiter.consume("operator:reset")).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(limiter.consume("operator:reset")).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterMs: 500,
    });

    now += 500;
    expect(limiter.consume("operator:reset")).toMatchObject({
      allowed: true,
      remaining: 1,
      retryAfterMs: 0,
    });
  });

  it("keeps tracked caller state within its configured bound", () => {
    const limiter = new MutationRateLimiter({
      limit: 1,
      windowMs: 1_000,
      maxKeys: 2,
      now: () => 1_000,
    });

    limiter.consume("caller-a");
    limiter.consume("caller-b");
    limiter.consume("caller-c");

    expect(limiter.trackedKeyCount).toBe(2);
  });

  it("rejects empty caller keys", () => {
    const limiter = new MutationRateLimiter({
      limit: 1,
      windowMs: 1_000,
    });

    expect(() => limiter.consume(" ")).toThrowError(TypeError);
  });
});
