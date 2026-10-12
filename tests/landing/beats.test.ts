import { describe, expect, it } from "vitest";

import type { CaseEvent, PublicCaseSnapshot, PublicEvidence } from "@/components/floor/types";
import { buildBeats, pickRecordedCase, pickRows, recordedFacts } from "@/components/landing/recorded/beats";

let seq = 0;
const ev = (type: CaseEvent["type"], actor: CaseEvent["actor"], title: string, extra: Partial<CaseEvent["payload"]> = {}): CaseEvent => ({
  id: `e${++seq}`,
  caseId: "c",
  runId: "r",
  seq,
  type,
  actor,
  payload: { title, summary: `${title} summary`, ...extra },
  occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
});

seq = 0;
// The shape of the recorded B1 run: five anchors in order, with noise between them.
const RUN = [
  ev("CASE_STARTED", "controller", "Recovery started", { station: "controller" }),
  ev("TASK_DELEGATED", "controller", "Order review delegated", { station: "investigator" }),
  ev("AGENT_STARTED", "controller", "controller task started"),
  ev("AGENT_COMPLETED", "controller", "controller task completed"),
  ev("PLAN_CREATED", "controller", "Recovery plan recorded"),
  ev("TASK_DELEGATED", "controller", "Task delegated", { station: "investigator" }),
  ev("AGENT_STARTED", "investigator", "investigator task started"),
  ev("AGENT_COMPLETED", "investigator", "investigator task completed", { summary: "Address incomplete: missing landmark." }),
  ev("TASK_DELEGATED", "controller", "Customer liaison assigned", { station: "liaison" }),
  ev("CUSTOMER_INPUT_REQUIRED", "liaison", "Customer detail needed", { station: "liaison" }),
  ev("CUSTOMER_INPUT_RECEIVED", "customer", "Address detail received", { station: "liaison" }),
  ev("TASK_DELEGATED", "controller", "Task delegated", { station: "fulfillment" }),
  ev("TOOL_FAILED", "controller", "Preferred route failed", { station: "fulfillment", resultCode: "PROVIDER_503" }),
  ev("AGENT_COMPLETED", "recovery", "recovery task completed"),
  ev("FALLBACK_SELECTED", "recovery", "Alternative route selected", { station: "recovery" }),
  ev("TOOL_CALLED", "recovery", "Alternative quote persisted", { station: "recovery" }),
  ev("AGENT_COMPLETED", "fulfillment", "fulfillment task completed"),
  ev("APPROVAL_REQUIRED", "controller", "Merchant approval required", { resultCode: "COST_LIMIT" }),
  ev("APPROVAL_GRANTED", "merchant", "Shipping cost approved", { station: "controller" }),
  ev("TASK_DELEGATED", "controller", "Task delegated", { station: "verifier" }),
  ev("BOOKING_CREATED", "controller", "Sandbox booking created", { station: "fulfillment" }),
  ev("VERIFICATION_PASSED", "verifier", "Booking independently verified", { resultCode: "PASS" }),
  ev("CASE_RESOLVED", "controller", "Case resolved", { resultCode: "VERIFIED_BOOKING" }),
];

describe("buildBeats", () => {
  const beats = buildBeats(RUN);

  it("splits the run at the recorded anchors and covers every event once", () => {
    expect(beats.map((b) => b.anchor?.type)).toEqual([
      "PLAN_CREATED",
      "CUSTOMER_INPUT_REQUIRED",
      "TOOL_FAILED",
      "APPROVAL_GRANTED",
      "CASE_RESOLVED",
    ]);
    expect(beats.flatMap((b) => b.events.map((e) => e.seq))).toEqual(RUN.map((e) => e.seq));
  });

  it("projects the floor at each anchor, so later outcomes never leak backwards", () => {
    expect(beats[2].view?.blocker?.payload.resultCode).toBe("PROVIDER_503");
    expect(beats[2].view?.verification).toBeNull();
    expect(beats[4].view?.verification?.type).toBe("VERIFICATION_PASSED");
    expect(beats[4].view?.outcome?.type).toBe("CASE_RESOLVED");
  });

  it("reports missing beats instead of inventing them", () => {
    const baseline = RUN.slice(0, 13); // stops at the 503, like the B0 run
    const result = buildBeats(baseline);
    expect(result[2].anchor?.type).toBe("TOOL_FAILED");
    expect(result[3]).toMatchObject({ anchor: null, events: [], rows: [], view: null });
    expect(result[4].anchor).toBeNull();
  });

  it("orders input by sequence before splitting", () => {
    const shuffled = [...RUN].reverse();
    expect(buildBeats(shuffled).map((b) => b.anchor?.seq)).toEqual(beats.map((b) => b.anchor?.seq));
  });
});

describe("pickRows", () => {
  it("keeps key events, drops quiet starts and generic delegations, and stays in sequence order", () => {
    const rows = pickRows(RUN.slice(0, 10));
    expect(rows.map((r) => r.payload.title)).toEqual([
      "Recovery started",
      "Order review delegated",
      "Recovery plan recorded",
      "investigator task completed",
      "Customer detail needed",
    ]);
    expect(rows.some((r) => r.type === "AGENT_STARTED")).toBe(false);
    expect(rows.some((r) => r.payload.title === "Task delegated")).toBe(false);
  });

  it("caps at five rows", () => {
    expect(pickRows(RUN).length).toBe(5);
  });
});

const snap = (id: string, status: PublicCaseSnapshot["status"], result: "PASS" | "FAIL" | null, updatedAt: string) =>
  ({ id, status, updatedAt, evidence: result ? { result } : null }) as unknown as PublicCaseSnapshot;

describe("pickRecordedCase", () => {
  it("chooses the newest resolved case with a passing receipt", () => {
    const cases = [
      snap("live", "TRIAGING", null, "2026-10-13T00:00:00Z"),
      snap("old", "RESOLVED", "PASS", "2026-10-01T00:00:00Z"),
      snap("new", "RESOLVED", "PASS", "2026-10-12T00:00:00Z"),
      snap("failed", "ESCALATED", "FAIL", "2026-10-14T00:00:00Z"),
    ];
    expect(pickRecordedCase(cases)?.id).toBe("new");
  });

  it("returns null when nothing is verified", () => {
    expect(pickRecordedCase([snap("live", "TRIAGING", null, "2026-10-13T00:00:00Z")])).toBeNull();
  });
});

describe("recordedFacts", () => {
  it("reads proof facts from events and the receipt only", () => {
    const receipt = { id: "x", result: "PASS", amountNgn: 7200 } as unknown as PublicEvidence;
    const facts = recordedFacts(RUN, [receipt]);
    expect(facts.delegations).toBe(5);
    expect(facts.handoffRoles).toEqual(["investigator", "liaison", "fulfillment", "verifier"]);
    expect(facts.finding?.payload.summary).toContain("missing landmark");
    expect(facts.failure?.payload.resultCode).toBe("PROVIDER_503");
    expect(facts.approvalGrant?.actor).toBe("merchant");
    expect(facts.receipt?.amountNgn).toBe(7200);
  });
});
