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
  messaging: MessagingState;
};

/** The station where an event's work happens: its recorded station, else its actor. */
export function stationOf(event: CaseEvent): StationId | null {
  if (isStation(event.payload.station)) return event.payload.station;
  return isStation(event.actor) ? event.actor : null;
}

/**
 * Customer liaison messaging state, derived only from persisted events.
 * Lifecycle stages advance on send-state events; failures, retries and fallbacks
 * are recorded as attention without inventing delivery or validation.
 */
export type MessagingPhase =
  | "idle"
  | "waiting"
  | "sending"
  | "accepted"
  | "delivered"
  | "read"
  | "validated"
  | "resumed"
  | "failed"
  | "needs-review";

export type MessagingAttentionKind =
  | "failed"
  | "retryable"
  | "needs-review"
  | "fallback"
  | "uncontactable"
  | "no-consent"
  | "invalid"
  | "exhausted"
  | "ambiguous"
  | "incomplete";

export type MessagingAttention = {
  kind: MessagingAttentionKind;
  seq: number;
  code: string;
};

export type MessagingMilestoneKey =
  | "requested"
  | "claimed"
  | "accepted"
  | "delivered"
  | "read"
  | "validated"
  | "resumed";

export type MessagingMilestone = { key: MessagingMilestoneKey; seq: number };

export type MessagingState = {
  /** True once a customer correction has been requested; the panel stays hidden before that. */
  active: boolean;
  phase: MessagingPhase;
  attention: MessagingAttention | null;
  milestones: MessagingMilestone[];
};

export function emptyMessaging(): MessagingState {
  return { active: false, phase: "idle", attention: null, milestones: [] };
}

type RankedStage = Exclude<MessagingMilestoneKey, "requested">;

const LIFECYCLE_RANK: Record<RankedStage, number> = {
  claimed: 1,
  accepted: 2,
  delivered: 3,
  read: 4,
  validated: 5,
  resumed: 6,
};

type SendSignal =
  | { kind: "lifecycle"; stage: Exclude<RankedStage, "resumed"> }
  | { kind: "failed"; attention: MessagingAttentionKind }
  | { kind: "review"; attention: MessagingAttentionKind }
  | { kind: "resolved" }
  | { kind: "fallback"; attention: MessagingAttentionKind }
  | { kind: "note"; attention: MessagingAttentionKind };

function classifyLiaisonTool(event: CaseEvent): SendSignal | null {
  const code = event.payload.resultCode ?? "";
  switch (code) {
    case "WHATSAPP_SEND_CLAIMED":
    case "WHATSAPP_RETRY_CLAIMED":
    case "TELEGRAM_SEND_CLAIMED":
      return { kind: "lifecycle", stage: "claimed" };
    case "WHATSAPP_SENT":
    case "WHATSAPP_MANUALLY_CONFIRMED":
    case "TELEGRAM_SENT":
      return { kind: "lifecycle", stage: "accepted" };
    case "WHATSAPP_DELIVERED":
      return { kind: "lifecycle", stage: "delivered" };
    case "WHATSAPP_READ":
      return { kind: "lifecycle", stage: "read" };
    case "WHATSAPP_FAILED":
    case "TELEGRAM_FAILED":
      return { kind: "failed", attention: "failed" };
    case "WHATSAPP_VALIDATED":
    case "TELEGRAM_VALIDATED":
      return { kind: "lifecycle", stage: "validated" };
    case "WHATSAPP_CONFIRMED_UNSENT":
      return { kind: "resolved" };
    case "TRANSPORT_ERROR":
    case "SEND_RESPONSE_UNREADABLE":
      return { kind: "review", attention: "needs-review" };
    case "INVALID_RECIPIENT":
    case "RECIPIENT_UNREADABLE":
      return { kind: "failed", attention: "invalid" };
    case "MAX_ATTEMPTS_EXHAUSTED":
      return { kind: "failed", attention: "exhausted" };
    case "AMBIGUOUS_CORRELATION":
      return { kind: "note", attention: "ambiguous" };
    case "INCOMPLETE_CORRECTION":
      return { kind: "note", attention: "incomplete" };
    case "WHATSAPP_DISABLED":
    case "TELEGRAM_DISABLED":
    case "TELEGRAM_BOT_TOKEN_MISSING":
    case "TELEGRAM_BOT_USERNAME_MISSING":
    case "TELEGRAM_KEYS_MISSING":
    case "TELEGRAM_NOT_LINKED":
    case "WHATSAPP_PHONE_NUMBER_ID_MISSING":
    case "WHATSAPP_ACCESS_TOKEN_MISSING":
    case "WHATSAPP_TEMPLATE_MISSING":
    case "WHATSAPP_KEYS_MISSING":
      return { kind: "fallback", attention: "fallback" };
    case "WHATSAPP_WINDOW_CLOSED":
    case "WHATSAPP_SANDBOX_UNVERIFIED":
      return { kind: "fallback", attention: "fallback" };
    case "CONTACT_UNAVAILABLE":
      return { kind: "fallback", attention: "uncontactable" };
    case "CUSTOMER_CONSENT_MISSING":
      return { kind: "fallback", attention: "no-consent" };
    default:
      break;
  }
  if (code.startsWith("META_") || code.startsWith("TWILIO_")) {
    if (event.payload.title === "WhatsApp send failed before delivery") {
      return { kind: "review", attention: "retryable" };
    }
    if (event.payload.title === "WhatsApp request failed") {
      return { kind: "failed", attention: "failed" };
    }
    return { kind: "review", attention: "needs-review" };
  }
  if (code.startsWith("TELEGRAM_")) {
    if (event.payload.title === "Telegram send failed before delivery") {
      return { kind: "review", attention: "retryable" };
    }
    if (event.payload.title === "Telegram request failed") {
      return { kind: "failed", attention: "failed" };
    }
    return { kind: "review", attention: "needs-review" };
  }
  return null;
}

/**
 * Projects the first `count` recorded events into customer-contact state.
 * Out-of-order or duplicate observations are safe: lifecycle stages only move
 * forward by rank, and unrecognized codes never change the picture.
 */
export function projectMessaging(events: readonly CaseEvent[], count: number): MessagingState {
  const applied = Math.max(0, Math.min(count, events.length));
  const firstSeq: Partial<Record<MessagingMilestoneKey, number>> = {};
  let lifecycleMax = 0;
  const state: MessagingState = emptyMessaging();
  const milestone = (key: MessagingMilestoneKey, rank: number, seq: number, phase: MessagingPhase) => {
    if (rank < lifecycleMax) return;
    lifecycleMax = rank;
    if (firstSeq[key] === undefined) firstSeq[key] = seq;
    state.phase = phase;
  };
  for (let i = 0; i < applied; i++) {
    const e = events[i];
    if (e.type === "CUSTOMER_INPUT_REQUIRED") {
      if (firstSeq.requested === undefined) firstSeq.requested = e.seq;
      if (state.phase === "idle") state.phase = "waiting";
      continue;
    }
    if (e.type === "CUSTOMER_INPUT_RECEIVED") {
      milestone("resumed", LIFECYCLE_RANK.resumed, e.seq, "resumed");
      continue;
    }
    if (e.type !== "TOOL_CALLED" || stationOf(e) !== "liaison") continue;
    const signal = classifyLiaisonTool(e);
    if (!signal) continue;
    const code = e.payload.resultCode ?? "";
    switch (signal.kind) {
      case "lifecycle":
        milestone(signal.stage, LIFECYCLE_RANK[signal.stage], e.seq, signal.stage === "claimed" ? "sending" : signal.stage);
        break;
      case "failed":
        state.phase = "failed";
        state.attention = { kind: signal.attention, seq: e.seq, code };
        break;
      case "review":
        state.phase = "needs-review";
        state.attention = { kind: signal.attention, seq: e.seq, code };
        break;
      case "resolved":
        state.phase = "waiting";
        state.attention = null;
        break;
      case "fallback":
        if (state.phase === "idle" || state.phase === "waiting") {
          state.attention = { kind: signal.attention, seq: e.seq, code };
        }
        break;
      case "note":
        state.attention = { kind: signal.attention, seq: e.seq, code };
        break;
    }
  }
  state.active = firstSeq.requested !== undefined;
  const order: MessagingMilestoneKey[] = ["requested", "claimed", "accepted", "delivered", "read", "validated", "resumed"];
  state.milestones = order.flatMap((key) => (firstSeq[key] === undefined ? [] : [{ key, seq: firstSeq[key] as number }]));
  return state;
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
    messaging: emptyMessaging(),
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
  view.messaging = projectMessaging(events, applied);

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
  if (event.payload.resultCode === "WHATSAPP_VALIDATED") return 1800;
  if (
    event.payload.resultCode === "WHATSAPP_SENT" ||
    event.payload.resultCode === "WHATSAPP_DELIVERED" ||
    event.payload.resultCode === "WHATSAPP_READ"
  ) {
    return 1400;
  }
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
