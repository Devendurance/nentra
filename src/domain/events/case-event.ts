import { z } from "zod";

const eventTypes = [
  "CASE_STARTED",
  "PLAN_CREATED",
  "TASK_DELEGATED",
  "AGENT_STARTED",
  "AGENT_COMPLETED",
  "TOOL_CALLED",
  "TOOL_FAILED",
  "RETRY_SCHEDULED",
  "FALLBACK_SELECTED",
  "CUSTOMER_INPUT_REQUIRED",
  "CUSTOMER_INPUT_RECEIVED",
  "APPROVAL_REQUIRED",
  "APPROVAL_GRANTED",
  "BOOKING_CREATED",
  "VERIFICATION_STARTED",
  "VERIFICATION_PASSED",
  "VERIFICATION_FAILED",
  "CASE_ESCALATED",
  "CASE_RESOLVED",
] as const;

const eventActors = [
  "controller",
  "investigator",
  "liaison",
  "fulfillment",
  "recovery",
  "verifier",
  "system",
  "customer",
  "merchant",
] as const;

const containsDirectContactDetails = (value: string): boolean =>
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value) ||
  /\+?\d[\d\s().-]{7,}\d/.test(value);

const containsCredentialMaterial = (value: string): boolean =>
  /(?:api[_ -]?key|authorization|bearer\s+\S+|password)\s*[:=]/i.test(value);

const safePublicText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        !containsDirectContactDetails(value) &&
        !containsCredentialMaterial(value),
      "Public event text contains sensitive contact or credential data",
    );

const eventPayloadSchema = z
  .object({
    title: safePublicText(120),
    summary: safePublicText(400),
    station: safePublicText(80).optional(),
    resultCode: safePublicText(80).optional(),
    evidenceRef: safePublicText(160).optional(),
    nextAction: safePublicText(200).optional(),
  })
  .strip();

export const caseEventSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    caseId: z.string().trim().min(1).max(128),
    runId: z.string().trim().min(1).max(128),
    seq: z.number().int().positive(),
    type: z.enum(eventTypes),
    actor: z.enum(eventActors),
    taskId: z.string().trim().min(1).max(128).optional(),
    payload: eventPayloadSchema,
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strip();

export type CaseEvent = z.infer<typeof caseEventSchema>;
export type CaseEventType = (typeof eventTypes)[number];
export type CaseEventActor = (typeof eventActors)[number];

export function sanitizeCaseEvent(input: unknown): CaseEvent {
  return caseEventSchema.parse(input);
}
