import { describe, expect, it } from "vitest";

import { holdFor, projectFloor, projectMessaging } from "@/components/floor/projection";
import type { CaseEvent } from "@/components/floor/types";

let seq = 0;
const ev = (
  type: CaseEvent["type"],
  actor: CaseEvent["actor"],
  extra: Partial<CaseEvent["payload"]> = {},
): CaseEvent => ({
  id: `m${++seq}`,
  caseId: "c",
  runId: "r",
  seq,
  type,
  actor,
  payload: { title: type, summary: `${type} summary`, ...extra },
  occurredAt: new Date(Date.UTC(2026, 0, 2, 0, 0, seq)).toISOString(),
});

const tool = (resultCode: string, title = "Tool result") =>
  ev("TOOL_CALLED", "liaison", { station: "liaison", resultCode, title });

const requestNeeded = () => ev("CUSTOMER_INPUT_REQUIRED", "liaison", { station: "liaison" });
const customerReplied = () => ev("CUSTOMER_INPUT_RECEIVED", "customer", { station: "liaison" });

describe("projectMessaging", () => {
  it("stays inactive before a correction is requested", () => {
    seq = 0;
    const events = [ev("CASE_STARTED", "controller", { station: "controller" })];
    const view = projectMessaging(events, 1);
    expect(view).toMatchObject({ active: false, phase: "idle", attention: null, milestones: [] });
  });

  it("waits without messaging and resumes through the correction form alone", () => {
    seq = 0;
    const events = [requestNeeded(), customerReplied()];
    expect(projectMessaging(events, 1)).toMatchObject({
      active: true,
      phase: "waiting",
      attention: null,
      milestones: [{ key: "requested", seq: 1 }],
    });
    const resumed = projectMessaging(events, 2);
    expect(resumed.phase).toBe("resumed");
    expect(resumed.milestones.map((m) => m.key)).toEqual(["requested", "resumed"]);
  });

  it("walks the full lifecycle without inventing unseen stages", () => {
    seq = 0;
    const events = [
      requestNeeded(),
      tool("WHATSAPP_SEND_CLAIMED", "WhatsApp send claimed"),
      tool("WHATSAPP_SENT", "Customer contacted on WhatsApp"),
      tool("WHATSAPP_DELIVERED", "WhatsApp message delivered"),
      tool("WHATSAPP_READ", "WhatsApp message read"),
      tool("WHATSAPP_VALIDATED", "WhatsApp reply validated"),
      customerReplied(),
    ];
    const phases = ["waiting", "sending", "accepted", "delivered", "read", "validated", "resumed"];
    phases.forEach((phase, i) => {
      expect(projectMessaging(events, i + 1).phase).toBe(phase);
    });
    const full = projectMessaging(events, events.length);
    expect(full.milestones).toEqual([
      { key: "requested", seq: 1 },
      { key: "claimed", seq: 2 },
      { key: "accepted", seq: 3 },
      { key: "delivered", seq: 4 },
      { key: "read", seq: 5 },
      { key: "validated", seq: 6 },
      { key: "resumed", seq: 7 },
    ]);
  });

  it("holds at acceptance, delivery, or read when nothing further is recorded", () => {
    seq = 0;
    const accepted = [requestNeeded(), tool("WHATSAPP_SEND_CLAIMED", "c"), tool("WHATSAPP_SENT", "s")];
    expect(projectMessaging(accepted, 3).phase).toBe("accepted");
    seq = 0;
    const delivered = [requestNeeded(), tool("WHATSAPP_SENT", "s"), tool("WHATSAPP_DELIVERED", "d")];
    const view = projectMessaging(delivered, 3);
    expect(view.phase).toBe("delivered");
    expect(view.milestones.map((m) => m.key)).toEqual(["requested", "accepted", "delivered"]);
  });

  it("separates retryable, failed, and uncertain sends", () => {
    seq = 0;
    const retryable = [
      requestNeeded(),
      tool("WHATSAPP_SEND_CLAIMED", "WhatsApp send claimed"),
      tool("META_131000", "WhatsApp send failed before delivery"),
    ];
    const retryView = projectMessaging(retryable, 3);
    expect(retryView.phase).toBe("needs-review");
    expect(retryView.attention).toMatchObject({ kind: "retryable", seq: 3, code: "META_131000" });

    seq = 0;
    const failed = [
      requestNeeded(),
      tool("WHATSAPP_SEND_CLAIMED", "WhatsApp send claimed"),
      tool("META_132000", "WhatsApp request failed"),
    ];
    const failedView = projectMessaging(failed, 3);
    expect(failedView.phase).toBe("failed");
    expect(failedView.attention).toMatchObject({ kind: "failed", code: "META_132000" });

    seq = 0;
    const uncertain = [
      requestNeeded(),
      tool("WHATSAPP_SEND_CLAIMED", "WhatsApp send claimed"),
      tool("TRANSPORT_ERROR", "WhatsApp send outcome uncertain"),
    ];
    const uncertainView = projectMessaging(uncertain, 3);
    expect(uncertainView.phase).toBe("needs-review");
    expect(uncertainView.attention).toMatchObject({ kind: "needs-review", code: "TRANSPORT_ERROR" });

    seq = 0;
    const unknownMeta = [requestNeeded(), tool("META_999999", "Something unexpected")];
    expect(projectMessaging(unknownMeta, 2).attention).toMatchObject({ kind: "needs-review" });
  });

  it("records fallback, invalid, exhausted, ambiguous, and incomplete states", () => {
    const cases: [string, string, string][] = [
      ["WHATSAPP_DISABLED", "WhatsApp unavailable, scoped form fallback", "fallback"],
      ["CONTACT_UNAVAILABLE", "No authorized customer contact", "uncontactable"],
      ["CUSTOMER_CONSENT_MISSING", "Customer consent withdrawn", "no-consent"],
      ["INVALID_RECIPIENT", "WhatsApp request blocked, invalid recipient", "invalid"],
      ["MAX_ATTEMPTS_EXHAUSTED", "WhatsApp send attempts exhausted", "exhausted"],
    ];
    for (const [code, title, kind] of cases) {
      seq = 0;
      const view = projectMessaging([requestNeeded(), tool(code, title)], 2);
      expect(view.attention).toMatchObject({ kind, seq: 2, code });
    }
    seq = 0;
    const ambiguous = [
      requestNeeded(),
      tool("WHATSAPP_SENT", "Customer contacted on WhatsApp"),
      tool("AMBIGUOUS_CORRELATION", "Ambiguous WhatsApp reply held"),
    ];
    const ambiguousView = projectMessaging(ambiguous, 3);
    expect(ambiguousView.phase).toBe("accepted");
    expect(ambiguousView.attention).toMatchObject({ kind: "ambiguous", seq: 3 });

    seq = 0;
    const resolved = [
      requestNeeded(),
      tool("WHATSAPP_SEND_CLAIMED", "WhatsApp send claimed"),
      tool("TRANSPORT_ERROR", "WhatsApp send outcome uncertain"),
      tool("WHATSAPP_CONFIRMED_UNSENT", "Uncertain send resolved"),
      tool("WHATSAPP_RETRY_CLAIMED", "WhatsApp retry claimed"),
    ];
    const resolvedView = projectMessaging(resolved, 5);
    expect(resolvedView.phase).toBe("sending");
    expect(resolvedView.attention).toBeNull();
    expect(projectMessaging(resolved, 4).phase).toBe("waiting");
  });

  it("ignores out-of-order regressions, duplicates, and unknown codes", () => {
    seq = 0;
    const events = [
      requestNeeded(),
      tool("WHATSAPP_SENT", "s"),
      tool("WHATSAPP_DELIVERED", "d"),
      tool("WHATSAPP_READ", "r"),
      tool("WHATSAPP_DELIVERED", "d"),
      tool("WHATSAPP_READ", "r"),
      tool("SOME_FUTURE_CODE", "Something new"),
    ];
    const view = projectMessaging(events, events.length);
    expect(view.phase).toBe("read");
    expect(view.milestones).toEqual([
      { key: "requested", seq: 1 },
      { key: "accepted", seq: 2 },
      { key: "delivered", seq: 3 },
      { key: "read", seq: 4 },
    ]);
    expect(view.attention).toBeNull();
  });

  it("exposes only sequence references, labels, and provider codes", () => {
    seq = 0;
    const events = [
      requestNeeded(),
      tool("WHATSAPP_SEND_CLAIMED", "WhatsApp send claimed"),
      tool("WHATSAPP_SENT", "Customer contacted on WhatsApp"),
    ];
    const view = projectMessaging(events, 3);
    const dump = JSON.stringify(view);
    expect(dump).not.toMatch(/\+?\d[\d\s().-]{7,}\d/);
    expect(dump).not.toContain("token");
    expect(dump).not.toContain("secret");
  });

  it("matches the projection embedded in projectFloor at every replay prefix", () => {
    seq = 0;
    const events = [
      requestNeeded(),
      tool("WHATSAPP_SEND_CLAIMED", "WhatsApp send claimed"),
      tool("WHATSAPP_SENT", "Customer contacted on WhatsApp"),
      tool("WHATSAPP_DELIVERED", "WhatsApp message delivered"),
      tool("WHATSAPP_VALIDATED", "WhatsApp reply validated"),
      customerReplied(),
    ];
    for (let n = 0; n <= events.length; n++) {
      expect(projectFloor(events, n).messaging).toEqual(projectMessaging(events, n));
    }
  });

  it("holds messaging beats longer during replay", () => {
    seq = 0;
    const validated = tool("WHATSAPP_VALIDATED", "WhatsApp reply validated");
    const sent = tool("WHATSAPP_SENT", "Customer contacted on WhatsApp");
    const plain = tool("QUOTE_RECEIVED", "Preferred quote received");
    expect(holdFor(validated, undefined)).toBe(1800);
    expect(holdFor(sent, undefined)).toBe(1400);
    expect(holdFor(plain, undefined)).toBe(1000);
  });
});
