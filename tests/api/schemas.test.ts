import { describe, expect, it } from "vitest";

import {
  approvalInputSchema,
  approvalRouteParamsSchema,
  cancelInputSchema,
  caseIdSchema,
  caseRouteParamsSchema,
  correctionInputSchema,
  cursorSchema,
  parseInput,
  resetInputSchema,
  startInputSchema,
} from "@/server/api/schemas";
import { HttpError } from "@/server/api/errors";

describe("API input schemas", () => {
  it("accepts route-safe case and approval IDs and rejects path syntax", () => {
    expect(caseIdSchema.parse("case-ng-2048")).toBe("case-ng-2048");
    expect(caseRouteParamsSchema.parse({ caseId: "case-ng-2048" })).toEqual({
      caseId: "case-ng-2048",
    });
    expect(
      approvalRouteParamsSchema.parse({
        caseId: "case-ng-2048",
        approvalId: "approval_01",
      }),
    ).toEqual({ caseId: "case-ng-2048", approvalId: "approval_01" });
    expect(caseIdSchema.safeParse("../private").success).toBe(false);
  });

  it("parses nonnegative integer event cursors and rejects ambiguous values", () => {
    expect(cursorSchema.parse("12")).toBe(12);
    expect(cursorSchema.parse(0)).toBe(0);
    expect(cursorSchema.safeParse("-1").success).toBe(false);
    expect(cursorSchema.safeParse("1.5").success).toBe(false);
    expect(cursorSchema.safeParse("").success).toBe(false);
  });

  it("accepts only the allowed customer address correction fields", () => {
    expect(correctionInputSchema.parse({ landmark: "Opposite the pharmacy" })).toEqual({
      landmark: "Opposite the pharmacy",
    });
    expect(
      correctionInputSchema.safeParse({
        landmark: "Opposite the pharmacy",
        paymentStatus: "PAID",
      }).success,
    ).toBe(false);
    expect(correctionInputSchema.safeParse({}).success).toBe(false);
    expect(correctionInputSchema.safeParse({ landmark: " " }).success).toBe(false);
  });

  it("validates approval, start, cancel, and reset request bodies strictly", () => {
    expect(approvalInputSchema.parse({ decision: "approve", expectedVersion: 2 })).toEqual({
      decision: "approve",
      expectedVersion: 2,
    });
    expect(approvalInputSchema.safeParse({ decision: "maybe" }).success).toBe(false);
    expect(startInputSchema.parse({})).toEqual({});
    expect(startInputSchema.parse({ expectedVersion: 0 })).toEqual({
      expectedVersion: 0,
    });
    expect(cancelInputSchema.parse({ reason: "Merchant requested cancellation" })).toEqual({
      reason: "Merchant requested cancellation",
    });
    expect(resetInputSchema.parse({})).toEqual({});
    expect(startInputSchema.safeParse({ debug: true }).success).toBe(false);
    expect(cancelInputSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(resetInputSchema.safeParse({ force: true }).success).toBe(false);
  });

  it("converts invalid parsed input into a typed safe HTTP error", () => {
    try {
      parseInput(correctionInputSchema, { paymentStatus: "PAID" });
      throw new Error("expected invalid input to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect(error).toMatchObject({
        status: 422,
        code: "INVALID_REQUEST",
        message: "Request validation failed.",
      });
    }
  });
});
