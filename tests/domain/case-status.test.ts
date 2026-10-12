import { describe, expect, it } from "vitest";

import {
  canTransitionCaseStatus,
  caseStatusSchema,
  transitionCaseStatus,
} from "@/domain/cases/status";

describe("case status transitions", () => {
  it("allows the documented happy-path transition from new to triaging", () => {
    expect(canTransitionCaseStatus("NEW", "TRIAGING")).toBe(true);
  });

  it.each([
    ["TRIAGING", "WAITING_CUSTOMER"],
    ["WAITING_CUSTOMER", "TRIAGING"],
    ["TRIAGING", "QUOTING"],
    ["QUOTING", "RECOVERING"],
    ["RECOVERING", "QUOTING"],
    ["QUOTING", "WAITING_APPROVAL"],
    ["QUOTING", "BOOKING"],
    ["WAITING_APPROVAL", "BOOKING"],
    ["BOOKING", "VERIFYING"],
    ["VERIFYING", "RESOLVED"],
  ] as const)("allows %s to transition to %s", (from, to) => {
    expect(canTransitionCaseStatus(from, to)).toBe(true);
  });

  it.each([
    ["TRIAGING", "ESCALATED"],
    ["WAITING_CUSTOMER", "ESCALATED"],
    ["QUOTING", "ESCALATED"],
    ["RECOVERING", "ESCALATED"],
    ["WAITING_APPROVAL", "ESCALATED"],
    ["BOOKING", "ESCALATED"],
    ["VERIFYING", "ESCALATED"],
    ["NEW", "CANCELLED"],
    ["TRIAGING", "CANCELLED"],
    ["WAITING_CUSTOMER", "CANCELLED"],
    ["QUOTING", "CANCELLED"],
    ["RECOVERING", "CANCELLED"],
    ["WAITING_APPROVAL", "CANCELLED"],
  ] as const)("allows the safe exit from %s to %s", (from, to) => {
    expect(canTransitionCaseStatus(from, to)).toBe(true);
  });

  it("lists terminal states and forbids self transitions", () => {
    expect(caseStatusSchema.options).toEqual([
      "NEW",
      "TRIAGING",
      "WAITING_CUSTOMER",
      "QUOTING",
      "RECOVERING",
      "WAITING_APPROVAL",
      "BOOKING",
      "VERIFYING",
      "RESOLVED",
      "ESCALATED",
      "CANCELLED",
    ]);
    for (const status of ["RESOLVED", "ESCALATED", "CANCELLED"] as const) {
      expect(canTransitionCaseStatus(status, status)).toBe(false);
    }
    expect(canTransitionCaseStatus("BOOKING", "CANCELLED")).toBe(false);
    expect(canTransitionCaseStatus("VERIFYING", "CANCELLED")).toBe(false);
  });

  it("requires a passing independent verification before resolving", () => {
    expect(() => transitionCaseStatus("VERIFYING", "RESOLVED")).toThrow(
      /verification.*pass/i,
    );
    expect(
      transitionCaseStatus("VERIFYING", "RESOLVED", {
        verificationResult: "PASS",
      }),
    ).toBe("RESOLVED");
  });

  it("throws when a requested transition is outside the legal graph", () => {
    expect(() => transitionCaseStatus("NEW", "BOOKING")).toThrow(
      /illegal.*transition/i,
    );
  });
});
