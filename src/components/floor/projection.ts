import { type CaseEvent, type StationId, STATIONS, isStation } from "./types";

export type StationStatus = "idle" | "assigned" | "working" | "done" | "waiting" | "failed" | "passed" | "escalated";

export type StationState = {
  status: StationStatus;
  /** Seq of the event that last changed this station. */
  seq: number | null;
  resultCode: string | null;
};

export type Party = StationId | "customer" | "merchant";

export type Handoff = { from: Party; to: StationId; seq: number };

export type TaskView = {
  id: string;
  role: StationId | null;
  state: "assigned" | "working" | "completed";
};

export type FloorProjection = {
  applied: number;
  current: CaseEvent | null;
  focus: StationId | null;
  stations: Record<StationId, StationState>;
  handoff: Handoff | null;
  blocker: CaseEvent | null;
  recovery: CaseEvent | null;
  approvalRequest: CaseEvent | null;
  approvalDecision: CaseEvent | null;
  booking: CaseEvent | null;
  verification: CaseEvent | null;
  outcome: CaseEvent | null;
  task: TaskView | null;
};

/** The station where an event's work happens: its recorded station, else its actor. */
export function stationOf(event: CaseEvent): StationId | null {
  if (isStation(event.payload.station)) return event.payload.station;
  return isStation(event.actor) ? event.actor : null;
}

/**
 * Projects the first `count` recorded events into floor presentation state.
 * Every visual state is derived from a persisted event, nothing is scheduled or inferred
 * beyond the event's own type, actor, station and result code.
 */
export function projectFloor(events: readonly CaseEvent[], count: number): FloorProjection {
  const applied = Math.max(0, Math.min(count, events.length));
  const stations = Object.fromEntries(
    STATIONS.map((id) => [id, { status: "idle", seq: null, resultCode: null } satisfies StationState]),
  ) as Record<StationId, StationState>;
  const view: FloorProjection = {
    applied,
    current: null,
    focus: null,
    stations,
    handoff: null,
    blocker: null,
    recovery: null,
    approvalRequest: null,
    approvalDecision: null,
    booking: null,
    verification: null,
    outcome: null,
    task: null,
  };

  // New work on a station clears the previous task's result code, so an old failure never lingers.
  const set = (id: StationId | null, status: StationStatus, event: CaseEvent, fresh = false) => {
    if (!id) return;
    const kept = fresh ? null : stations[id].resultCode;
    stations[id] = { status, seq: event.seq, resultCode: event.payload.resultCode ?? kept };
  };

  for (let i = 0; i < applied; i++) {
    const e = events[i];
    const at = stationOf(e);
    const actor = isStation(e.actor) ? e.actor : null;
    view.handoff = null;
    switch (e.type) {
      case "CASE_STARTED":
        set("controller", "working", e);
        break;
      case "PLAN_CREATED":
        set("controller", "done", e);
        break;
      case "TASK_DELEGATED":
        if (at && stations[at].status !== "working") set(at, "assigned", e, true);
        if (at && actor && actor !== at) view.handoff = { from: actor, to: at, seq: e.seq };
        break;
      case "AGENT_STARTED":
        set(actor ?? at, "working", e, true);
        break;
      case "AGENT_COMPLETED":
        set(actor ?? at, "done", e);
        break;
      case "TOOL_CALLED":
        if (at) stations[at] = { ...stations[at], seq: e.seq, resultCode: e.payload.resultCode ?? stations[at].resultCode };
        break;
      case "TOOL_FAILED":
        set(at, "failed", e);
        view.blocker = e;
        break;
      case "RETRY_SCHEDULED":
        set(at, "assigned", e);
        break;
      case "FALLBACK_SELECTED":
        set(at ?? "recovery", "done", e);
        view.recovery = e;
        if (view.blocker?.type === "TOOL_FAILED") view.blocker = null;
        break;
      case "CUSTOMER_INPUT_REQUIRED":
        set(at ?? "liaison", "waiting", e);
        view.blocker = e;
        break;
      case "CUSTOMER_INPUT_RECEIVED":
        set(at ?? "liaison", "done", e);
        view.handoff = { from: "customer", to: at ?? "liaison", seq: e.seq };
        if (view.blocker?.type === "CUSTOMER_INPUT_REQUIRED") view.blocker = null;
        break;
      case "APPROVAL_REQUIRED":
        set(at ?? "controller", "waiting", e);
        view.blocker = e;
        view.approvalRequest = e;
        break;
      case "APPROVAL_GRANTED":
        set(at ?? "controller", "done", e);
        view.handoff = { from: "merchant", to: at ?? "controller", seq: e.seq };
        view.approvalDecision = e;
        if (view.blocker?.type === "APPROVAL_REQUIRED") view.blocker = null;
        break;
      case "BOOKING_CREATED":
        set(at ?? "fulfillment", "done", e);
        view.booking = e;
        break;
      case "VERIFICATION_STARTED":
        set("verifier", "working", e);
        break;
      case "VERIFICATION_PASSED":
        set("verifier", "passed", e);
        view.verification = e;
        break;
      case "VERIFICATION_FAILED":
        set("verifier", "failed", e);
        view.verification = e;
        view.blocker = e;
        break;
      case "CASE_ESCALATED":
        set("controller", "escalated", e);
        view.outcome = e;
        view.blocker = e;
        break;
      case "CASE_RESOLVED":
        set("controller", "done", e);
        view.outcome = e;
        break;
    }
  }

  const current = applied > 0 ? events[applied - 1] : null;
  view.current = current;
  view.focus = current ? stationOf(current) : null;

  if (current?.taskId) {
    let state: TaskView["state"] = "assigned";
    let role: StationId | null = null;
    for (let i = 0; i < applied; i++) {
      const e = events[i];
      if (e.taskId !== current.taskId) continue;
      if (e.type === "AGENT_STARTED") {
        state = "working";
        role = isStation(e.actor) ? e.actor : role;
      } else if (e.type === "AGENT_COMPLETED") {
        state = "completed";
        role = isStation(e.actor) ? e.actor : role;
      } else if (e.type === "TASK_DELEGATED" && state !== "working" && state !== "completed") {
        role = stationOf(e) ?? role;
      }
    }
    view.task = { id: current.taskId, role, state };
  }
  return view;
}

/** Replay hold per event, in ms at 1x. Longer holds on the beats that matter. */
export function holdFor(event: CaseEvent, next: CaseEvent | undefined): number {
  const sameInstant = next && next.occurredAt === event.occurredAt;
  switch (event.type) {
    case "TOOL_FAILED":
    case "CASE_RESOLVED":
      return 2600;
    case "APPROVAL_REQUIRED":
    case "VERIFICATION_PASSED":
    case "CUSTOMER_INPUT_REQUIRED":
      return 2200;
    case "FALLBACK_SELECTED":
    case "APPROVAL_GRANTED":
    case "CUSTOMER_INPUT_RECEIVED":
    case "BOOKING_CREATED":
      return 1800;
    case "TASK_DELEGATED":
      return 1200;
    default:
      return sameInstant ? 700 : 1000;
  }
}
