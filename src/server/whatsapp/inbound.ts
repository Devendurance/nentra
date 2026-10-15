import { HttpError } from "@/server/api/errors";
import { appendEventTx, DemoRepository } from "@/server/db/repository";
import { applyLandmarkText } from "@/server/messaging/landmark-correction";
import {
  contactLookupHash,
  findContactsBySender,
  normalizePhoneE164,
} from "@/server/whatsapp/contacts";
import {
  normalizeSenderE164,
  parseWebhookEnvelope,
  verifyWebhookSignature,
} from "@/integrations/whatsapp/webhook";

const MAX_REPLY_CHARS = 2_000;

export interface ProcessWebhookInput {
  repository: DemoRepository;
  rawBody: Buffer;
  signature: string | null;
  env?: NodeJS.ProcessEnv;
}

export interface WebhookItemResult {
  providerMessageId: string;
  result: string;
}

async function appendLiaisonEvent(
  repository: DemoRepository,
  caseId: string,
  runId: string,
  title: string,
  summary: string,
  resultCode: string,
): Promise<void> {
  await repository.transaction(async (tx) => {
    await appendEventTx(tx, {
      caseId,
      runId,
      type: "TOOL_CALLED",
      actor: "liaison",
      payload: { title, summary, station: "liaison", resultCode },
    });
  });
}

export async function processWhatsappWebhook(
  input: ProcessWebhookInput,
): Promise<{ acknowledged: true; processed: WebhookItemResult[] }> {
  const env = input.env ?? process.env;
  const appSecret = (env.WHATSAPP_APP_SECRET ?? "").trim();
  if (!appSecret) {
    throw new HttpError(500, "WHATSAPP_NOT_CONFIGURED", "WhatsApp verification is not configured.");
  }
  if (!verifyWebhookSignature(input.rawBody, input.signature, appSecret)) {
    throw new HttpError(401, "INVALID_SIGNATURE", "The webhook signature is invalid.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody.toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_PAYLOAD", "The webhook payload is not valid JSON.");
  }

  const { repository } = input;
  const businessPhoneNumberId = (env.WHATSAPP_PHONE_NUMBER_ID ?? "").trim();
  const hmacKey = env.WHATSAPP_CONTACT_HMAC_KEY ?? "";
  const envelope = parseWebhookEnvelope(payload);
  const processed: WebhookItemResult[] = [];

  for (const status of envelope.statuses) {
    if (!businessPhoneNumberId || status.businessPhoneNumberId !== businessPhoneNumberId) {
      const { record } = await repository.recordInboundEvent({
        providerMessageId: `status:${status.providerMessageId}:mismatch`,
        kind: "STATUS",
        statusValue: status.statusValue,
        resultCode: "BUSINESS_ID_MISMATCH",
      });
      processed.push({ providerMessageId: record.providerMessageId, result: "BUSINESS_ID_MISMATCH" });
      continue;
    }
    const mapped =
      status.statusValue === "delivered" ? "DELIVERED"
      : status.statusValue === "read" ? "READ"
      : status.statusValue === "failed" ? "FAILED"
      : null;
    const notificationKey = `status:${status.providerMessageId}:${status.statusValue}:${status.statusTimestamp ?? "no-ts"}`;
    const { record, created } = await repository.recordInboundEvent({
      providerMessageId: notificationKey,
      kind: "STATUS",
      statusValue: status.statusValue,
      resultCode: mapped ? "STATUS_RECORDED" : "STATUS_IGNORED",
    });
    if (!created) {
      processed.push({ providerMessageId: record.providerMessageId, result: "DUPLICATE_ACK" });
      continue;
    }
    if (mapped) {
      const transition = await repository.updateWhatsappMessageFromStatus(status.providerMessageId, mapped);
      if (transition.applied && transition.message) {
        const snapshot = await repository.getCaseSnapshot(transition.message.caseId);
        if (snapshot?.run) {
          await repository.transaction(async (tx) => {
            await appendEventTx(tx, {
              caseId: transition.message!.caseId,
              runId: snapshot.run!.id,
              type: "TOOL_CALLED",
              actor: "liaison",
              payload: {
                title: `WhatsApp message ${mapped.toLowerCase()}`,
                summary: mapped === "FAILED"
                  ? "The provider reported that the WhatsApp message failed. The scoped correction form remains available."
                  : `The provider reported the WhatsApp message as ${mapped.toLowerCase()}. This is provider telemetry, not proof the customer replied.`,
                station: "liaison",
                resultCode: `WHATSAPP_${mapped}`,
              },
            });
          });
        }
      }
    }
    processed.push({ providerMessageId: record.providerMessageId, result: record.resultCode });
  }

  for (const message of envelope.messages) {
    if (!businessPhoneNumberId || message.businessPhoneNumberId !== businessPhoneNumberId) {
      const { record } = await repository.recordInboundEvent({
        providerMessageId: message.providerMessageId,
        kind: "MESSAGE",
        resultCode: "BUSINESS_ID_MISMATCH",
      });
      processed.push({ providerMessageId: record.providerMessageId, result: "BUSINESS_ID_MISMATCH" });
      continue;
    }
    const senderE164 = normalizeSenderE164(message.senderRaw);
    const { record, created } = await repository.recordInboundEvent({
      providerMessageId: message.providerMessageId,
      kind: "MESSAGE",
      senderLookupHash: senderE164 && hmacKey ? contactLookupHash(senderE164, hmacKey) : null,
    });
    if (!created && record.resultCode !== "RECEIVED") {
      processed.push({ providerMessageId: record.providerMessageId, result: "DUPLICATE_ACK" });
      continue;
    }
    const result = await handleInboundMessage(repository, {
      inboundId: record.id,
      providerMessageId: message.providerMessageId,
      senderE164,
      messageType: message.messageType,
      textBody: message.textBody,
      replyToProviderMessageId: message.replyToProviderMessageId,
      hmacKey,
    });
    processed.push({ providerMessageId: message.providerMessageId, result });
  }

  return { acknowledged: true, processed };
}

export interface NormalizedInboundMessageInput {
  inboundId: string;
  providerMessageId: string;
  senderE164: string | null;
  messageType: string;
  textBody: string | null;
  replyToProviderMessageId: string | null;
  hmacKey: string;
}

export async function handleInboundMessage(
  repository: DemoRepository,
  message: NormalizedInboundMessageInput,
): Promise<string> {
  const finish = async (
    result: string,
    caseId?: string | null,
    correctionRequestId?: string | null,
  ): Promise<string> => {
    await repository.updateInboundEventResult(message.inboundId, {
      resultCode: result,
      caseId: caseId ?? null,
      correctionRequestId: correctionRequestId ?? null,
    });
    return result;
  };

  if (!message.senderE164 || !message.hmacKey) {
    return finish(!message.senderE164 ? "UNKNOWN_SENDER" : "CONTACT_LOOKUP_UNAVAILABLE");
  }
  if (message.messageType !== "text" || message.textBody === null) {
    return finish("UNSUPPORTED_MESSAGE_TYPE");
  }
  if (message.textBody.length > MAX_REPLY_CHARS) {
    return finish("OVERSIZED_MESSAGE");
  }

  const contacts = await findContactsBySender(repository, message.senderE164, message.hmacKey);
  if (contacts.length === 0) {
    return finish("NO_MATCHING_CONTACT");
  }

  const candidates: Array<{ requestId: string; caseId: string; runId: string | null }> = [];
  for (const contact of contacts) {
    const pending = await repository.getPendingCorrectionsForOrder(contact.orderId);
    for (const row of pending) {
      if (row.caseStatus !== "WAITING_CUSTOMER") continue;
      candidates.push({ requestId: row.requestId, caseId: row.caseId, runId: row.activeRunId });
    }
  }

  if (message.replyToProviderMessageId) {
    const outbound = await repository.getWhatsappMessageByProviderId(message.replyToProviderMessageId);
    const match = outbound
      ? candidates.find((candidate) => candidate.requestId === outbound.correctionRequestId)
      : undefined;
    if (!match) {
      return finish("REPLY_CONTEXT_UNMATCHED");
    }
    return applyReply(repository, message, match);
  }

  if (candidates.length === 0) {
    return finish("NO_PENDING_CORRECTION");
  }
  if (candidates.length > 1) {
    for (const candidate of candidates) {
      if (candidate.runId) {
        await appendLiaisonEvent(
          repository,
          candidate.caseId,
          candidate.runId,
          "Ambiguous WhatsApp reply held",
          "A customer reply could not be matched to a single pending request, so the order keeps waiting.",
          "AMBIGUOUS_CORRELATION",
        );
      }
    }
    return finish("AMBIGUOUS_CORRELATION");
  }
  return applyReply(repository, message, candidates[0]);
}

async function applyReply(
  repository: DemoRepository,
  message: {
    inboundId: string;
    providerMessageId: string;
    textBody: string | null;
  },
  candidate: { requestId: string; caseId: string },
): Promise<string> {
  const finish = async (
    result: string,
    correctionRequestId?: string | null,
  ): Promise<string> => {
    await repository.updateInboundEventResult(message.inboundId, {
      resultCode: result,
      caseId: candidate.caseId,
      correctionRequestId: correctionRequestId ?? candidate.requestId,
    });
    return result;
  };

  const result = await applyLandmarkText(repository, candidate, message.textBody, {
    label: "WhatsApp",
    validatedCode: "WHATSAPP_VALIDATED",
  });
  return finish(result);
}

export { normalizePhoneE164 };
