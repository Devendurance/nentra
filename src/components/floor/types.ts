// Type-only imports keep the browser bundle free of server code while staying in sync
// with the sanitized public API contract.
import type { CaseEvent, CaseEventActor, CaseEventType } from "@/domain/events/case-event";
import type { PublicCaseSnapshot, PublicEvidence } from "@/server/db/repository";

export type { CaseEvent, CaseEventActor, CaseEventType, PublicCaseSnapshot, PublicEvidence };

export const STATIONS = ["controller", "investigator", "liaison", "fulfillment", "recovery", "verifier"] as const;
export type StationId = (typeof STATIONS)[number];

export const TERMINAL_STATUSES = new Set(["RESOLVED", "ESCALATED", "CANCELLED"]);

export const STATION_NAMES: Record<StationId, string> = {
  controller: "Controller",
  investigator: "Investigator",
  liaison: "Customer Liaison",
  fulfillment: "Fulfillment",
  recovery: "Recovery",
  verifier: "Verifier",
};

export const ACTOR_NAMES: Record<CaseEventActor, string> = {
  ...STATION_NAMES,
  system: "System",
  customer: "Customer",
  merchant: "Merchant",
};

export const EVENT_LABELS: Record<CaseEventType, string> = {
  CASE_STARTED: "Case started",
  PLAN_CREATED: "Plan recorded",
  TASK_DELEGATED: "Task delegated",
  AGENT_STARTED: "Agent started",
  AGENT_COMPLETED: "Agent completed",
  TOOL_CALLED: "Tool result",
  TOOL_FAILED: "Tool failed",
  RETRY_SCHEDULED: "Retry scheduled",
  FALLBACK_SELECTED: "Fallback selected",
  CUSTOMER_INPUT_REQUIRED: "Customer input needed",
  CUSTOMER_INPUT_RECEIVED: "Customer input received",
  APPROVAL_REQUIRED: "Approval required",
  APPROVAL_GRANTED: "Approval granted",
  BOOKING_CREATED: "Booking created",
  VERIFICATION_STARTED: "Verification started",
  VERIFICATION_PASSED: "Verification passed",
  VERIFICATION_FAILED: "Verification failed",
  CASE_ESCALATED: "Case escalated",
  CASE_RESOLVED: "Case resolved",
};

export type Tone = "neutral" | "active" | "waiting" | "failed" | "verified";

export function eventTone(type: CaseEventType): Tone {
  switch (type) {
    case "TOOL_FAILED":
    case "VERIFICATION_FAILED":
    case "CASE_ESCALATED":
      return "failed";
    case "CUSTOMER_INPUT_REQUIRED":
    case "APPROVAL_REQUIRED":
    case "RETRY_SCHEDULED":
      return "waiting";
    case "VERIFICATION_PASSED":
    case "CASE_RESOLVED":
      return "verified";
    case "FALLBACK_SELECTED":
    case "APPROVAL_GRANTED":
    case "CUSTOMER_INPUT_RECEIVED":
    case "BOOKING_CREATED":
      return "active";
    default:
      return "neutral";
  }
}

export function isStation(value: string | undefined | null): value is StationId {
  return !!value && (STATIONS as readonly string[]).includes(value);
}

const ngn = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
export const formatNgn = (amount: number) => ngn.format(amount);

export function formatClock(iso: string) {
  const d = new Date(iso);
  return d.toISOString().slice(11, 19) + " UTC";
}

export function formatOffset(fromIso: string, toIso: string) {
  const ms = Math.max(0, new Date(toIso).getTime() - new Date(fromIso).getTime());
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(1).padStart(4, "0");
  return `+${String(m).padStart(2, "0")}:${s}`;
}
