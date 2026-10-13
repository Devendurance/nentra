import {
  buildCorrectionIdempotencyKey,
  hashRecipient,
  isValidE164,
  resolveWhatsappConfig,
  sendCorrectionTemplate,
  type WhatsappTransport,
} from "@/integrations/whatsapp";
import { appendEventTx, DemoRepository } from "@/server/db/repository";
import type { WhatsappMessage } from "@/server/db/schema";

export type WhatsappOutboundOutcome =
  | "SENT"
  | "SKIPPED_DISABLED"
  | "FAILED_INVALID_RECIPIENT"
  | "FAILED_PROVIDER"
  | "NO_PENDING_CORRECTION";

export interface WhatsappOutboundResult {
  outcome: WhatsappOutboundOutcome;
  message: WhatsappMessage;
  errorCode?: string;
  created: boolean;
}

export interface RequestCorrectionViaWhatsappInput {
  repository: DemoRepository;
  caseId: string;
  toPhoneE164: string;
  customerConsented: boolean;
  env?: NodeJS.ProcessEnv;
  transport?: WhatsappTransport;
}

function eventTitleFor(outcome: WhatsappOutboundOutcome): string {
  switch (outcome) {
    case "SENT":
      return "Customer contacted on WhatsApp";
    case "SKIPPED_DISABLED":
      return "WhatsApp unavailable, scoped form fallback";
    case "FAILED_INVALID_RECIPIENT":
      return "WhatsApp request blocked, invalid recipient";
    case "FAILED_PROVIDER":
      return "WhatsApp request failed";
    case "NO_PENDING_CORRECTION":
      return "No pending correction request";
  }
}

export async function requestCorrectionViaWhatsapp(
  input: RequestCorrectionViaWhatsappInput,
): Promise<WhatsappOutboundResult> {
  const { repository, caseId } = input;
  const pending = await repository.getCorrectionRequestForCase(caseId);
  const snapshot = await repository.getCaseSnapshot(caseId);
  if (!pending || !snapshot || snapshot.status !== "WAITING_CUSTOMER" || !snapshot.run) {
    throw new Error("The case has no pending customer correction request.");
  }

  const idempotencyKey = buildCorrectionIdempotencyKey(pending.id);
  const preexisting = await repository.getWhatsappMessageByIdempotencyKey(idempotencyKey);
  if (preexisting && (preexisting.status === "SENT" || preexisting.status === "SKIPPED")) {
    const outcome: WhatsappOutboundOutcome =
      preexisting.status === "SENT" ? "SENT" : "SKIPPED_DISABLED";
    return { outcome, message: preexisting, errorCode: preexisting.errorCode ?? undefined, created: false };
  }

  const resolved = resolveWhatsappConfig(input.env ?? process.env);
  const consentBlocked = !input.customerConsented;
  const recipientValid = isValidE164(input.toPhoneE164);

  const recordOutcomeFirst = async (
    status: "SKIPPED" | "FAILED",
    errorCode: string,
    templateName: string,
    templateLanguage: string,
  ): Promise<WhatsappOutboundResult> => {
    const { record } = await repository.insertWhatsappMessagePending({
      caseId,
      correctionRequestId: pending.id,
      idempotencyKey,
      templateName,
      templateLanguage,
      recipientHash: hashRecipient(input.toPhoneE164),
    });
    const updated = await repository.updateWhatsappMessageStatus(record.id, { status, errorCode });
    await repository.transaction(async (tx) => {
      await appendEventTx(tx, {
        caseId,
        runId: snapshot.run!.id,
        type: "TOOL_CALLED",
        actor: "liaison",
        payload: {
          title: eventTitleFor(status === "SKIPPED" ? "SKIPPED_DISABLED" : "FAILED_PROVIDER"),
          summary: `WhatsApp delivery ${status === "SKIPPED" ? "skipped" : "failed"} with code ${errorCode}. The scoped correction form remains available.`,
          station: "liaison",
          resultCode: errorCode,
        },
      });
    });
    return {
      outcome: status === "SKIPPED" ? "SKIPPED_DISABLED" : "FAILED_PROVIDER",
      message: updated,
      errorCode,
      created: true,
    };
  };

  if (!resolved.ok || consentBlocked) {
    const reason = !resolved.ok ? resolved.reason : "CUSTOMER_CONSENT_MISSING";
    return recordOutcomeFirst("SKIPPED", reason, "n/a", "n/a");
  }

  if (!recipientValid) {
    const { record } = await repository.insertWhatsappMessagePending({
      caseId,
      correctionRequestId: pending.id,
      idempotencyKey,
      templateName: resolved.config.templateName,
      templateLanguage: resolved.config.templateLanguage,
      recipientHash: hashRecipient(input.toPhoneE164),
    });
    const updated = await repository.updateWhatsappMessageStatus(record.id, {
      status: "FAILED",
      errorCode: "INVALID_RECIPIENT",
    });
    await repository.transaction(async (tx) => {
      await appendEventTx(tx, {
        caseId,
        runId: snapshot.run!.id,
        type: "TOOL_CALLED",
        actor: "liaison",
        payload: {
          title: eventTitleFor("FAILED_INVALID_RECIPIENT"),
          summary: "The customer recipient number failed validation. No message was sent. The scoped correction form remains available.",
          station: "liaison",
          resultCode: "INVALID_RECIPIENT",
        },
      });
    });
    return { outcome: "FAILED_INVALID_RECIPIENT", message: updated, errorCode: "INVALID_RECIPIENT", created: true };
  }

  const { record } = await repository.insertWhatsappMessagePending({
    caseId,
    correctionRequestId: pending.id,
    idempotencyKey,
    templateName: resolved.config.templateName,
    templateLanguage: resolved.config.templateLanguage,
    recipientHash: hashRecipient(input.toPhoneE164),
  });
  if (preexisting && preexisting.id === record.id && preexisting.status === "FAILED") {
    // A previous attempt failed; this call is an explicit retry of the same
    // idempotent correction request, so the send below reuses the same record.
  }

  const sendResult = await sendCorrectionTemplate(
    resolved.config,
    { toE164: input.toPhoneE164.trim(), orderNumber: snapshot.order.orderNumber },
    input.transport,
  );
  if (sendResult.outcome === "SENT") {
    const updated = await repository.updateWhatsappMessageStatus(record.id, {
      status: "SENT",
      providerMessageId: sendResult.providerMessageId,
    });
    await repository.transaction(async (tx) => {
      await appendEventTx(tx, {
        caseId,
        runId: snapshot.run!.id,
        type: "TOOL_CALLED",
        actor: "liaison",
        payload: {
          title: eventTitleFor("SENT"),
          summary: `A WhatsApp template message for order ${snapshot.order.orderNumber} was accepted by the provider. Awaiting the customer reply.`,
          station: "liaison",
          resultCode: "WHATSAPP_SENT",
        },
      });
    });
    return { outcome: "SENT", message: updated, created: true };
  }

  const updated = await repository.updateWhatsappMessageStatus(record.id, {
    status: "FAILED",
    errorCode: sendResult.errorCode,
  });
  await repository.transaction(async (tx) => {
    await appendEventTx(tx, {
      caseId,
      runId: snapshot.run!.id,
      type: "TOOL_CALLED",
      actor: "liaison",
      payload: {
        title: eventTitleFor("FAILED_PROVIDER"),
        summary: `WhatsApp delivery failed with code ${sendResult.errorCode}. The scoped correction form remains available.`,
        station: "liaison",
        resultCode: sendResult.errorCode,
      },
    });
  });
  return { outcome: "FAILED_PROVIDER", message: updated, errorCode: sendResult.errorCode, created: true };
}
