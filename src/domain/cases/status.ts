import { z } from "zod";

export const caseStatusSchema = z.enum([
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

export type CaseStatus = z.infer<typeof caseStatusSchema>;

export const legalCaseStatusTransitions = {
  NEW: ["TRIAGING", "CANCELLED"],
  TRIAGING: ["WAITING_CUSTOMER", "QUOTING", "ESCALATED", "CANCELLED"],
  WAITING_CUSTOMER: ["TRIAGING", "ESCALATED", "CANCELLED"],
  QUOTING: [
    "RECOVERING",
    "WAITING_APPROVAL",
    "BOOKING",
    "ESCALATED",
    "CANCELLED",
  ],
  RECOVERING: ["QUOTING", "ESCALATED", "CANCELLED"],
  WAITING_APPROVAL: ["BOOKING", "ESCALATED", "CANCELLED"],
  BOOKING: ["VERIFYING", "ESCALATED"],
  VERIFYING: ["RESOLVED", "ESCALATED"],
  RESOLVED: [],
  ESCALATED: [],
  CANCELLED: [],
} as const satisfies Record<CaseStatus, readonly CaseStatus[]>;

export function canTransitionCaseStatus(
  from: CaseStatus,
  to: CaseStatus,
): boolean {
  return (legalCaseStatusTransitions[from] as readonly CaseStatus[]).includes(to);
}

export type CaseStatusTransitionContext = {
  verificationResult?: "PASS" | "FAIL" | "PENDING";
};

export function transitionCaseStatus(
  from: CaseStatus,
  to: CaseStatus,
  context: CaseStatusTransitionContext = {},
): CaseStatus {
  if (!canTransitionCaseStatus(from, to)) {
    throw new Error(`Illegal case status transition: ${from} -> ${to}`);
  }

  if (to === "RESOLVED" && context.verificationResult !== "PASS") {
    throw new Error("Case resolution requires verification to pass");
  }

  return to;
}
