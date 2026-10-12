import { type FloorProjection, projectFloor } from "@/components/floor/projection";
import type { CaseEvent, CaseEventType, PublicCaseSnapshot, PublicEvidence } from "@/components/floor/types";

/**
 * The five narrative beats of a recorded recovery. Each beat ends at an anchor event type and
 * covers every persisted event after the previous anchor. Nothing here is scheduled or invented:
 * a beat whose anchor was never recorded is reported as missing.
 */
export const BEAT_ANCHORS: readonly (readonly CaseEventType[])[] = [
  ["PLAN_CREATED", "CASE_STARTED"],
  ["CUSTOMER_INPUT_REQUIRED"],
  ["TOOL_FAILED"],
  ["APPROVAL_GRANTED", "APPROVAL_REQUIRED"],
  ["CASE_RESOLVED", "CASE_ESCALATED"],
];

export type Beat = {
  index: number;
  /** Persisted events in this beat, in sequence order. Empty when the anchor was not recorded. */
  events: CaseEvent[];
  /** The notable events shown on the phone, at most five. */
  rows: CaseEvent[];
  anchor: CaseEvent | null;
  /** Floor projection after the beat's anchor event. */
  view: FloorProjection | null;
};

const QUIET: ReadonlySet<CaseEventType> = new Set(["AGENT_STARTED"]);
const KEY: ReadonlySet<CaseEventType> = new Set([
  "CASE_STARTED",
  "TOOL_FAILED",
  "FALLBACK_SELECTED",
  "CUSTOMER_INPUT_REQUIRED",
  "CUSTOMER_INPUT_RECEIVED",
  "APPROVAL_REQUIRED",
  "APPROVAL_GRANTED",
  "BOOKING_CREATED",
  "VERIFICATION_PASSED",
  "VERIFICATION_FAILED",
  "CASE_ESCALATED",
  "CASE_RESOLVED",
]);

/** Lower rank is more important. Null means the event is never shown as a row. */
function rank(event: CaseEvent): number | null {
  if (QUIET.has(event.type)) return null;
  if (KEY.has(event.type)) return 0;
  if (event.type === "AGENT_COMPLETED") return event.actor === "controller" ? null : 1;
  if (event.type === "PLAN_CREATED" || event.type === "TOOL_CALLED") return 2;
  // Generic delegations are noise. Named ones ("Customer liaison assigned") carry the story.
  if (event.type === "TASK_DELEGATED") return event.payload.title === "Task delegated" ? null : 3;
  return 3;
}

export function pickRows(events: readonly CaseEvent[], max = 5): CaseEvent[] {
  const ranked = events
    .map((event) => ({ event, r: rank(event) }))
    .filter((item): item is { event: CaseEvent; r: number } => item.r !== null)
    // Within a rank, later events are the more complete statement of the work.
    .sort((a, b) => a.r - b.r || (a.r === 1 ? b.event.seq - a.event.seq : a.event.seq - b.event.seq));
  return ranked
    .slice(0, max)
    .map((item) => item.event)
    .sort((a, b) => a.seq - b.seq);
}

export function buildBeats(events: readonly CaseEvent[]): Beat[] {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  let cursor = 0;
  return BEAT_ANCHORS.map((types, index) => {
    let at = -1;
    for (const type of types) {
      at = sorted.findIndex((event, i) => i >= cursor && event.type === type);
      if (at >= 0) break;
    }
    if (at < 0) return { index, events: [], rows: [], anchor: null, view: null };
    const slice = sorted.slice(cursor, at + 1);
    cursor = at + 1;
    return { index, events: slice, rows: pickRows(slice), anchor: sorted[at], view: projectFloor(sorted, at + 1) };
  });
}

/** The newest resolved case with a passing receipt, which is what the landing presents. */
export function pickRecordedCase(cases: readonly PublicCaseSnapshot[]): PublicCaseSnapshot | null {
  return (
    [...cases]
      .filter((c) => c.status === "RESOLVED" && c.evidence?.result === "PASS")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  );
}

export type RecordedFacts = {
  delegations: number;
  handoffRoles: string[];
  finding: CaseEvent | null;
  failure: CaseEvent | null;
  fallback: CaseEvent | null;
  approvalRequest: CaseEvent | null;
  approvalGrant: CaseEvent | null;
  booking: CaseEvent | null;
  verification: CaseEvent | null;
  receipt: PublicEvidence | null;
};

/** Facts for the proof panels, read only from persisted events and the receipt. */
export function recordedFacts(events: readonly CaseEvent[], evidence: readonly PublicEvidence[]): RecordedFacts {
  const first = (type: CaseEventType, actor?: string) => events.find((e) => e.type === type && (!actor || e.actor === actor)) ?? null;
  const delegated = events.filter((e) => e.type === "TASK_DELEGATED");
  const roles = [...new Set(delegated.map((e) => e.payload.station).filter((s): s is string => typeof s === "string"))];
  return {
    delegations: delegated.length,
    handoffRoles: roles,
    finding: first("AGENT_COMPLETED", "investigator"),
    failure: first("TOOL_FAILED"),
    fallback: first("FALLBACK_SELECTED"),
    approvalRequest: first("APPROVAL_REQUIRED"),
    approvalGrant: first("APPROVAL_GRANTED"),
    booking: first("BOOKING_CREATED"),
    verification: first("VERIFICATION_PASSED") ?? first("VERIFICATION_FAILED"),
    receipt: evidence.find((e) => e.result === "PASS") ?? evidence[0] ?? null,
  };
}

/** "REDSTAR_EXPRESS" to "Redstar express". Display only. */
export function humanize(code: string) {
  const text = code.toLowerCase().replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
