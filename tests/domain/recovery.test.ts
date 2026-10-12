import { describe, expect, it } from "vitest";

import {
  decideRecoveryAction,
  classifyShippingFailure,
} from "@/domain/recovery/policy";

describe("shipping recovery policy", () => {
  it("classifies transient read errors separately from permanent business errors", () => {
    expect(
      classifyShippingFailure({ code: "HTTP_503", operation: "READ" }),
    ).toBe("TRANSIENT_READ");
    expect(
      classifyShippingFailure({ code: "INVALID_ADDRESS", operation: "READ" }),
    ).toBe("PERMANENT");
  });

  it("retries transient reads at most twice before fallback or escalation", () => {
    expect(
      decideRecoveryAction({
        classification: "TRANSIENT_READ",
        additionalAttemptsUsed: 0,
        eligibleFallbackAvailable: true,
      }),
    ).toEqual({ action: "RETRY", additionalAttempt: 1 });
    expect(
      decideRecoveryAction({
        classification: "TRANSIENT_READ",
        additionalAttemptsUsed: 2,
        eligibleFallbackAvailable: true,
      }),
    ).toEqual({ action: "FALLBACK" });
    expect(
      decideRecoveryAction({
        classification: "TRANSIENT_READ",
        additionalAttemptsUsed: 3,
        eligibleFallbackAvailable: false,
      }),
    ).toEqual({ action: "ESCALATE" });
  });

  it("reconciles ambiguous writes and never retries permanent or unknown errors", () => {
    expect(
      classifyShippingFailure({
        code: "TIMEOUT",
        operation: "WRITE",
        outcome: "UNKNOWN",
      }),
    ).toBe("AMBIGUOUS_WRITE");
    expect(
      decideRecoveryAction({
        classification: "AMBIGUOUS_WRITE",
        additionalAttemptsUsed: 0,
        eligibleFallbackAvailable: true,
      }),
    ).toEqual({ action: "RECONCILE" });
    expect(
      decideRecoveryAction({
        classification: "PERMANENT",
        additionalAttemptsUsed: 0,
        eligibleFallbackAvailable: true,
      }),
    ).toEqual({ action: "ESCALATE" });
  });
});
