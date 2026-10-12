import { describe, expect, it } from "vitest";

import { projectFloor } from "@/components/floor/projection";
import type { CaseEvent } from "@/components/floor/types";
import { mergeEvents } from "@/components/floor/useCaseFeed";

let seq = 0;
const ev = (type: CaseEvent["type"], actor: CaseEvent["actor"], extra: Partial<CaseEvent["payload"]> = {}, taskId?: string): CaseEvent => ({
  id: `e${++seq}`,
  caseId: "c",
  runId: "r",
  seq,
  type,
  actor,
  taskId,
  payload: { title: type, summary: `${type} summary`, ...extra },
  occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
});

describe("projectFloor", () => {
  seq = 0;
  const events = [
    ev("CASE_STARTED", "controller", { station: "controller" }),
    ev("TASK_DELEGATED", "controller", { station: "fulfillment" }, "t1"),
    ev("AGENT_STARTED", "fulfillment", { station: "fulfillment" }, "t1"),
    ev("AGENT_COMPLETED", "fulfillment", { station: "fulfillment" }, "t1"),
    ev("TOOL_FAILED", "controller", { station: "fulfillment", resultCode: "PROVIDER_503" }),
    ev("FALLBACK_SELECTED", "recovery", { station: "recovery", resultCode: "FALLBACK_SELECTED" }),
    ev("APPROVAL_REQUIRED", "controller", { station: "controller", resultCode: "COST_LIMIT" }),
    ev("APPROVAL_GRANTED", "merchant", { station: "controller" }),
    ev("VERIFICATION_PASSED", "verifier", { station: "verifier", resultCode: "PASS" }),
    ev("CASE_RESOLVED", "controller", { station: "controller" }),
  ];

  it("shows nothing before the first event", () => {
    const view = projectFloor(events, 0);
    expect(view.current).toBeNull();
    expect(Object.values(view.stations).every((s) => s.status === "idle")).toBe(true);
  });

  it("projects a delegation as a handoff from the controller", () => {
    const view = projectFloor(events, 2);
    expect(view.handoff).toEqual({ from: "controller", to: "fulfillment", seq: 2 });
    expect(view.stations.fulfillment.status).toBe("assigned");
    expect(view.task).toMatchObject({ id: "t1", state: "assigned", role: "fulfillment" });
  });

  it("marks the recorded failure on its station and opens a blocker", () => {
    const view = projectFloor(events, 5);
    expect(view.stations.fulfillment).toMatchObject({ status: "failed", resultCode: "PROVIDER_503" });
    expect(view.blocker?.type).toBe("TOOL_FAILED");
    expect(view.recovery).toBeNull();
    expect(view.stations.recovery.status).toBe("idle");
  });

  it("clears a station's old result code when new work starts there", () => {
    const later = [
      ...events.slice(0, 6),
      ev("TASK_DELEGATED", "controller", { station: "fulfillment" }, "t2"),
      ev("AGENT_STARTED", "fulfillment", { station: "fulfillment" }, "t2"),
    ];
    const view = projectFloor(later, later.length);
    expect(view.stations.fulfillment).toMatchObject({ status: "working", resultCode: null });
  });

  it("only activates recovery at the fallback event and clears the failure blocker", () => {
    const view = projectFloor(events, 6);
    expect(view.recovery?.type).toBe("FALLBACK_SELECTED");
    expect(view.blocker).toBeNull();
  });

  it("records the merchant approval as a handoff from the merchant", () => {
    expect(projectFloor(events, 7).blocker?.type).toBe("APPROVAL_REQUIRED");
    const view = projectFloor(events, 8);
    expect(view.handoff).toMatchObject({ from: "merchant", to: "controller" });
    expect(view.approvalDecision?.type).toBe("APPROVAL_GRANTED");
    expect(view.blocker).toBeNull();
  });

  it("shows a verified outcome only after PASS is recorded", () => {
    expect(projectFloor(events, 8).verification).toBeNull();
    const view = projectFloor(events, 10);
    expect(view.stations.verifier.status).toBe("passed");
    expect(view.outcome?.type).toBe("CASE_RESOLVED");
  });
});

describe("mergeEvents", () => {
  seq = 0;
  const a = ev("CASE_STARTED", "controller");
  const b = ev("PLAN_CREATED", "controller");
  const c = ev("TASK_DELEGATED", "controller");

  it("appends in order and ignores duplicates", () => {
    expect(mergeEvents([a], [b, a, c, b])?.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("returns null on a sequence gap instead of inventing missing events", () => {
    expect(mergeEvents([a], [c])).toBeNull();
  });
});
