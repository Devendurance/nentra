import { describe, expect, it } from "vitest";

import {
  caseEventSchema,
  sanitizeCaseEvent,
} from "@/domain/events/case-event";

const event = {
  id: "evt-1",
  caseId: "case-1",
  runId: "run-1",
  seq: 1,
  type: "TOOL_FAILED",
  actor: "fulfillment",
  taskId: "task-1",
  payload: {
    title: "Quote lookup failed",
    summary: "The provider returned a temporary unavailable response.",
    station: "fulfillment",
    resultCode: "PROVIDER_503",
    evidenceRef: "attempt-1",
    nextAction: "Retry within the allowed limit.",
  },
  occurredAt: "2026-10-12T00:00:00.000Z",
};

describe("public case event contract", () => {
  it("strips fields outside the sanitized public envelope", () => {
    const parsed = caseEventSchema.parse({
      ...event,
      privatePrompt: "hidden reasoning",
      payload: {
        ...event.payload,
        customerPhone: "+2348012345678",
        providerResponseBody: { apiKey: "secret" },
      },
    });

    expect(parsed).not.toHaveProperty("privatePrompt");
    expect(parsed.payload).not.toHaveProperty("customerPhone");
    expect(parsed.payload).not.toHaveProperty("providerResponseBody");
  });

  it("rejects public text that contains direct contact details", () => {
    expect(() =>
      sanitizeCaseEvent({
        ...event,
        payload: { ...event.payload, summary: "Call +2348012345678" },
      }),
    ).toThrow(/sensitive|contact|sanit/i);
    expect(() =>
      sanitizeCaseEvent({
        ...event,
        payload: { ...event.payload, summary: "Email user@example.com" },
      }),
    ).toThrow(/sensitive|contact|sanit/i);
  });

  it("validates the documented event types, actors, sequence, and timestamp", () => {
    expect(() =>
      caseEventSchema.parse({ ...event, type: "UNKNOWN_EVENT" }),
    ).toThrow();
    expect(() => caseEventSchema.parse({ ...event, seq: 0 })).toThrow();
    expect(() =>
      caseEventSchema.parse({ ...event, occurredAt: "yesterday" }),
    ).toThrow();
  });
});
