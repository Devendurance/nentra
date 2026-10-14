import { eq } from "drizzle-orm";

import {
  buildCorrectionIdempotencyKey,
  isValidE164,
  resolveWhatsappConfig,
  sendCorrectionTemplate,
  type WhatsappConfig,
  type WhatsappTransport,
} from "@/integrations/whatsapp";
import {
  resolveTwilioConfig,
  resolveWhatsappProvider,
  sendTwilioCorrectionMessage,
  type TwilioMessageSender,
  type TwilioSendConfig,
  type WhatsappProviderName,
} from "@/integrations/whatsapp/twilio";
import { appendEventTx, DemoRepository } from "@/server/db/repository";
import { whatsappMessages, type WhatsappMessage } from "@/server/db/schema";
import {
  contactLookupHash,
  decryptPhone,
  getContactForOrder,
  normalizePhoneE164,
} from "@/server/whatsapp/contacts";

export type WhatsappOutboundOutcome =
  | "SENT"
  | "IN_PROGRESS"
  | "RETRYABLE"
  | "NEEDS_REVIEW"
  | "SKIPPED_DISABLED"
  | "CONTACT_UNAVAILABLE"
  | "CONSENT_WITHDRAWN"
  | "INVALID_RECIPIENT"
  | "FAILED_PROVIDER"
  | "MAX_ATTEMPTS_EXHAUSTED"
  | "ALREADY_RESOLVED";

export interface WhatsappOutboundResult {
  outcome: WhatsappOutboundOutcome;
  message: WhatsappMessage;
  errorCode?: string;
  created: boolean;
}

export interface RequestCorrectionViaWhatsappInput {
  repository: DemoRepository;
  caseId: string;
  env?: NodeJS.ProcessEnv;
  transport?: WhatsappTransport;
  twilioSender?: TwilioMessageSender;
}

export interface RetryWhatsappSendInput {
  repository: DemoRepository;
  messageId: string;
  env?: NodeJS.ProcessEnv;
  transport?: WhatsappTransport;
  twilioSender?: TwilioMessageSender;
}

export interface ResolveUncertainSendInput {
  repository: DemoRepository;
  messageId: string;
  resolution: "CONFIRMED_SENT" | "CONFIRMED_UNSENT";
  providerMessageId?: string;
  resolvedBy: string;
}

const DEFAULT_MAX_SEND_ATTEMPTS = 3;

export function maxSendAttempts(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number.parseInt((env.WHATSAPP_MAX_SEND_ATTEMPTS ?? "").trim(), 10);
  if (Number.isSafeInteger(raw) && raw >= 1 && raw <= 10) return raw;
  return DEFAULT_MAX_SEND_ATTEMPTS;
}

function eventTitleFor(outcome: WhatsappOutboundOutcome): string {
  switch (outcome) {
    case "SENT":
      return "Customer contacted on WhatsApp";
    case "IN_PROGRESS":
      return "WhatsApp send already in progress";
    case "RETRYABLE":
      return "WhatsApp send failed before delivery";
    case "NEEDS_REVIEW":
      return "WhatsApp send outcome uncertain";
    case "SKIPPED_DISABLED":
      return "WhatsApp unavailable, scoped form fallback";
    case "CONTACT_UNAVAILABLE":
      return "No authorized customer contact";
    case "CONSENT_WITHDRAWN":
      return "Customer consent withdrawn";
    case "INVALID_RECIPIENT":
      return "WhatsApp request blocked, invalid recipient";
    case "FAILED_PROVIDER":
      return "WhatsApp request failed";
    case "MAX_ATTEMPTS_EXHAUSTED":
      return "WhatsApp send attempts exhausted";
    case "ALREADY_RESOLVED":
      return "Correction already resolved";
  }
}

async function appendOutboundEvent(
  repository: DemoRepository,
  caseId: string,
  runId: string,
  outcome: WhatsappOutboundOutcome,
  summary: string,
  resultCode: string,
  titleOverride?: string,
): Promise<void> {
  await repository.transaction(async (tx) => {
    await appendEventTx(tx, {
      caseId,
      runId,
      type: "TOOL_CALLED",
      actor: "liaison",
      payload: {
        title: titleOverride ?? eventTitleFor(outcome),
        summary,
        station: "liaison",
        resultCode,
      },
    });
  });
}

interface ResolvedSendContext {
  pendingId: string;
  runId: string;
  orderNumber: string;
  idempotencyKey: string;
  templateName: string;
  templateLanguage: string;
  toE164: string;
  provider: WhatsappConfig;
  providerName: WhatsappProviderName;
  twilio?: TwilioSendConfig;
  senderLookupHash: string;
}

export const TWILIO_CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000;

async function resolveSendContext(
  repository: DemoRepository,
  caseId: string,
  env: NodeJS.ProcessEnv,
): Promise<
  | { ok: true; context: ResolvedSendContext }
  | { ok: false; outcome: WhatsappOutboundOutcome; errorCode: string }
> {
  const pending = await repository.getCorrectionRequestForCase(caseId);
  const snapshot = await repository.getCaseSnapshot(caseId);
  if (!pending || !snapshot || snapshot.status !== "WAITING_CUSTOMER" || !snapshot.run) {
    throw new Error("The case has no pending customer correction request.");
  }
  const providerName = resolveWhatsappProvider(env);
  if (providerName === "twilio") {
    return resolveTwilioSendContext(repository, pending.id, snapshot, env);
  }
  const resolved = resolveWhatsappConfig(env);
  if (!resolved.ok) {
    return { ok: false, outcome: "SKIPPED_DISABLED", errorCode: resolved.reason };
  }
  const hmacKey = env.WHATSAPP_CONTACT_HMAC_KEY ?? "";
  const encryptionKey = env.WHATSAPP_CONTACT_ENCRYPTION_KEY ?? "";
  if (!hmacKey || !encryptionKey) {
    return { ok: false, outcome: "SKIPPED_DISABLED", errorCode: "WHATSAPP_KEYS_MISSING" };
  }
  const contact = await getContactForOrder(repository, snapshot.order.id);
  if (!contact) {
    return { ok: false, outcome: "CONTACT_UNAVAILABLE", errorCode: "CONTACT_UNAVAILABLE" };
  }
  if (contact.consentStatus !== "OPTED_IN") {
    return { ok: false, outcome: "CONSENT_WITHDRAWN", errorCode: "CUSTOMER_CONSENT_MISSING" };
  }
  let toE164: string;
  try {
    const decrypted = decryptPhone(contact.phoneIv, contact.phoneCiphertext, encryptionKey);
    const normalized = normalizePhoneE164(decrypted);
    if (!normalized || !isValidE164(normalized)) {
      return { ok: false, outcome: "INVALID_RECIPIENT", errorCode: "INVALID_RECIPIENT" };
    }
    toE164 = normalized;
  } catch {
    return { ok: false, outcome: "INVALID_RECIPIENT", errorCode: "RECIPIENT_UNREADABLE" };
  }
  return {
    ok: true,
    context: {
      pendingId: pending.id,
      runId: snapshot.run.id,
      orderNumber: snapshot.order.orderNumber,
      idempotencyKey: buildCorrectionIdempotencyKey(pending.id),
      templateName: resolved.config.templateName,
      templateLanguage: resolved.config.templateLanguage,
      toE164,
      provider: resolved.config,
      providerName: "meta",
      senderLookupHash: contactLookupHash(toE164, hmacKey),
    },
  };
}

async function resolveTwilioSendContext(
  repository: DemoRepository,
  pendingId: string,
  snapshot: { run: { id: string } | null; order: { id: string; orderNumber: string } },
  env: NodeJS.ProcessEnv,
): Promise<
  | { ok: true; context: ResolvedSendContext }
  | { ok: false; outcome: WhatsappOutboundOutcome; errorCode: string }
> {
  const twilio = resolveTwilioConfig(env);
  if (!twilio.ok) {
    return { ok: false, outcome: "SKIPPED_DISABLED", errorCode: twilio.reason };
  }
  const hmacKey = env.WHATSAPP_CONTACT_HMAC_KEY ?? "";
  const encryptionKey = env.WHATSAPP_CONTACT_ENCRYPTION_KEY ?? "";
  if (!hmacKey || !encryptionKey) {
    return { ok: false, outcome: "SKIPPED_DISABLED", errorCode: "WHATSAPP_KEYS_MISSING" };
  }
  const contact = await getContactForOrder(repository, snapshot.order.id);
  if (!contact) {
    return { ok: false, outcome: "CONTACT_UNAVAILABLE", errorCode: "CONTACT_UNAVAILABLE" };
  }
  if (contact.consentStatus !== "OPTED_IN") {
    return { ok: false, outcome: "CONSENT_WITHDRAWN", errorCode: "CUSTOMER_CONSENT_MISSING" };
  }
  let toE164: string;
  try {
    const decrypted = decryptPhone(contact.phoneIv, contact.phoneCiphertext, encryptionKey);
    const normalized = normalizePhoneE164(decrypted);
    if (!normalized || !isValidE164(normalized)) {
      return { ok: false, outcome: "INVALID_RECIPIENT", errorCode: "INVALID_RECIPIENT" };
    }
    toE164 = normalized;
  } catch {
    return { ok: false, outcome: "INVALID_RECIPIENT", errorCode: "RECIPIENT_UNREADABLE" };
  }
  const senderLookupHash = contactLookupHash(toE164, hmacKey);
  if (!(await repository.hasInboundFromSenderHash(senderLookupHash))) {
    return { ok: false, outcome: "SKIPPED_DISABLED", errorCode: "WHATSAPP_SANDBOX_UNVERIFIED" };
  }
  const windowStart = new Date(Date.now() - TWILIO_CUSTOMER_WINDOW_MS);
  if (!(await repository.hasRecentInboundFromSenderHash(senderLookupHash, windowStart))) {
    return { ok: false, outcome: "SKIPPED_DISABLED", errorCode: "WHATSAPP_WINDOW_CLOSED" };
  }
  if (!snapshot.run) {
    throw new Error("The case has no pending customer correction request.");
  }
  return {
    ok: true,
    context: {
      pendingId,
      runId: snapshot.run.id,
      orderNumber: snapshot.order.orderNumber,
      idempotencyKey: buildCorrectionIdempotencyKey(pendingId),
      templateName: "twilio-sandbox",
      templateLanguage: "n/a",
      toE164,
      provider: {
        enabled: true,
        apiVersion: "n/a",
        phoneNumberId: twilio.config.whatsappFrom,
        accessToken: "",
        templateName: "twilio-sandbox",
        templateLanguage: "n/a",
        timeoutMs: twilio.config.timeoutMs,
      },
      providerName: "twilio",
      twilio: twilio.config,
      senderLookupHash,
    },
  };
}

function mapExistingWhatsappOutcome(record: WhatsappMessage): WhatsappOutboundResult | null {
  switch (record.status) {
    case "SENT":
    case "DELIVERED":
    case "READ":
      return { outcome: "SENT", message: record, errorCode: record.errorCode ?? undefined, created: false };
    case "SENDING":
      return { outcome: "IN_PROGRESS", message: record, created: false };
    case "NEEDS_REVIEW":
      return { outcome: "NEEDS_REVIEW", message: record, errorCode: record.errorCode ?? undefined, created: false };
    case "SKIPPED":
      return { outcome: "SKIPPED_DISABLED", message: record, errorCode: record.errorCode ?? undefined, created: false };
    case "FAILED":
      return { outcome: "FAILED_PROVIDER", message: record, errorCode: record.errorCode ?? undefined, created: false };
    default:
      return null;
  }
}

async function recordTerminalSkip(
  repository: DemoRepository,
  caseId: string,
  context: { pendingId: string; runId: string; idempotencyKey: string },
  outcome: WhatsappOutboundOutcome,
  errorCode: string,
): Promise<WhatsappOutboundResult> {
  const { record, created: inserted } = await repository.insertWhatsappMessagePending({
    caseId,
    correctionRequestId: context.pendingId,
    idempotencyKey: context.idempotencyKey,
    templateName: "n/a",
    templateLanguage: "n/a",
    recipientHash: "unavailable",
  });
  if (!inserted && record.status === "SKIPPED") {
    return { outcome, message: record, errorCode: record.errorCode ?? errorCode, created: false };
  }
  const updated = await repository.updateWhatsappMessageStatus(record.id, {
    status: "SKIPPED",
    errorCode,
  });
  await appendOutboundEvent(
    repository,
    caseId,
    context.runId,
    outcome,
    `WhatsApp delivery skipped with code ${errorCode}. The scoped correction form remains available.`,
    errorCode,
  );
  return { outcome, message: updated, errorCode, created: true };
}

export async function requestCorrectionViaWhatsapp(
  input: RequestCorrectionViaWhatsappInput,
): Promise<WhatsappOutboundResult> {
  const { repository, caseId } = input;
  const env = input.env ?? process.env;
  const resolved = await resolveSendContext(repository, caseId, env);
  if (!resolved.ok) {
    const pending = await repository.getCorrectionRequestForCase(caseId);
    const snapshot = await repository.getCaseSnapshot(caseId);
    if (!pending || !snapshot?.run) {
      throw new Error("The case has no pending customer correction request.");
    }
    return recordTerminalSkip(
      repository,
      caseId,
      { pendingId: pending.id, runId: snapshot.run.id, idempotencyKey: buildCorrectionIdempotencyKey(pending.id) },
      resolved.outcome,
      resolved.errorCode,
    );
  }
  const context = resolved.context;

  const preexisting = await repository.getWhatsappMessageByIdempotencyKey(context.idempotencyKey);
  if (preexisting) {
    if (preexisting.status === "SKIPPED") {
      // A skipped row never sent anything. When the current evaluation fully
      // passes, the stale skip is superseded so a healed state (open window,
      // provisioned contact, granted consent, fixed config) can still send.
      // The original skip event stays in the journal; a new claim follows it.
      const reset = await repository.resetSkippedWhatsappMessage(context.idempotencyKey);
      if (reset) {
        // Fall through to a fresh send below.
      } else {
        const latest = await repository.getWhatsappMessageByIdempotencyKey(context.idempotencyKey);
        if (!latest) throw new Error("The WhatsApp message disappeared during claiming.");
        const mapped = mapExistingWhatsappOutcome(latest);
        if (mapped) return mapped;
      }
    } else {
      const mapped = mapExistingWhatsappOutcome(preexisting);
      if (mapped) return mapped;
    }
  }

  const { record } = await repository.insertWhatsappMessagePending({
    caseId,
    correctionRequestId: context.pendingId,
    idempotencyKey: context.idempotencyKey,
    provider: context.providerName,
    templateName: context.templateName,
    templateLanguage: context.templateLanguage,
    recipientHash: contactLookupHash(context.toE164, env.WHATSAPP_CONTACT_HMAC_KEY ?? ""),
  });
  if (record.attemptCount >= maxSendAttempts(env)) {
    await appendOutboundEvent(
      repository,
      caseId,
      context.runId,
      "MAX_ATTEMPTS_EXHAUSTED",
      "WhatsApp send attempts are exhausted. The scoped correction form remains available.",
      "MAX_ATTEMPTS_EXHAUSTED",
    );
    return { outcome: "MAX_ATTEMPTS_EXHAUSTED", message: record, errorCode: "MAX_ATTEMPTS_EXHAUSTED", created: false };
  }
  const claimed = await repository.claimWhatsappSend(record.id);
  if (!claimed) {
    const latest = await repository.getWhatsappMessageByIdempotencyKey(context.idempotencyKey);
    if (!latest) throw new Error("The WhatsApp message disappeared during claiming.");
    return { outcome: "IN_PROGRESS", message: latest, created: false };
  }
  await appendOutboundEvent(
    repository,
    caseId,
    context.runId,
    "SENT",
    "A WhatsApp send attempt was claimed. The scoped correction form remains available meanwhile.",
    "WHATSAPP_SEND_CLAIMED",
    "WhatsApp send claimed",
  );
  return executeClaimedSend(repository, caseId, context, claimed.id, input.transport, input.twilioSender);
}

export async function retryWhatsappSend(
  input: RetryWhatsappSendInput,
): Promise<WhatsappOutboundResult> {
  const { repository } = input;
  const env = input.env ?? process.env;
  const [current] = await repository.db.select().from(whatsappMessages)
    .where(eq(whatsappMessages.id, input.messageId)).limit(1);
  if (!current) throw new Error("The WhatsApp message was not found.");
  if (current.status !== "RETRYABLE") {
    return { outcome: current.status === "SENT" ? "SENT" : "ALREADY_RESOLVED", message: current, created: false };
  }
  if (current.attemptCount >= maxSendAttempts(env)) {
    return { outcome: "MAX_ATTEMPTS_EXHAUSTED", message: current, errorCode: "MAX_ATTEMPTS_EXHAUSTED", created: false };
  }
  const resolved = await resolveSendContext(repository, current.caseId, env);
  if (!resolved.ok) {
    throw new Error(`The retry context is unavailable: ${resolved.errorCode}.`);
  }
  const claimed = await repository.claimWhatsappSend(current.id);
  if (!claimed) {
    const latest = await repository.getWhatsappMessageByIdempotencyKey(resolved.context.idempotencyKey);
    if (!latest) throw new Error("The WhatsApp message disappeared during claiming.");
    return { outcome: "IN_PROGRESS", message: latest, created: false };
  }
  await appendOutboundEvent(
    repository,
    current.caseId,
    resolved.context.runId,
    "RETRYABLE",
    "A bounded WhatsApp retry was claimed. The scoped correction form remains available meanwhile.",
    "WHATSAPP_RETRY_CLAIMED",
    "WhatsApp retry claimed",
  );
  return executeClaimedSend(repository, current.caseId, resolved.context, claimed.id, input.transport, input.twilioSender);
}

async function executeClaimedSend(
  repository: DemoRepository,
  caseId: string,
  context: ResolvedSendContext,
  messageId: string,
  transport?: WhatsappTransport,
  twilioSender?: TwilioMessageSender,
): Promise<WhatsappOutboundResult> {
  const sendResult = context.providerName === "twilio" && context.twilio
    ? await sendTwilioCorrectionMessage(
      context.twilio,
      { toE164: context.toE164, orderNumber: context.orderNumber },
      twilioSender,
    )
    : await sendCorrectionTemplate(
      context.provider,
      { toE164: context.toE164, orderNumber: context.orderNumber },
      transport,
    );
  if (sendResult.outcome === "SENT") {
    const updated = await repository.finalizeWhatsappSend(messageId, {
      status: "SENT",
      providerMessageId: sendResult.providerMessageId,
    });
    await appendOutboundEvent(
      repository,
      caseId,
      context.runId,
      "SENT",
      `A WhatsApp message for order ${context.orderNumber} was accepted by the provider. Acceptance is not delivery. Awaiting the customer reply.`,
      "WHATSAPP_SENT",
    );
    return { outcome: "SENT", message: updated, created: true };
  }
  if (sendResult.outcome === "PERMANENT_SEND") {
    const updated = await repository.finalizeWhatsappSend(messageId, {
      status: "FAILED",
      errorCode: sendResult.errorCode,
    });
    await appendOutboundEvent(
      repository,
      caseId,
      context.runId,
      "FAILED_PROVIDER",
      `WhatsApp delivery was definitively rejected with code ${sendResult.errorCode}. The scoped correction form remains available.`,
      sendResult.errorCode,
    );
    return { outcome: "FAILED_PROVIDER", message: updated, errorCode: sendResult.errorCode, created: true };
  }
  if (sendResult.outcome === "TRANSIENT_SEND") {
    const updated = await repository.finalizeWhatsappSend(messageId, {
      status: "RETRYABLE",
      errorCode: sendResult.errorCode,
    });
    await appendOutboundEvent(
      repository,
      caseId,
      context.runId,
      "RETRYABLE",
      `WhatsApp delivery failed before sending with code ${sendResult.errorCode}. A bounded retry may be attempted.`,
      sendResult.errorCode,
    );
    return { outcome: "RETRYABLE", message: updated, errorCode: sendResult.errorCode, created: true };
  }
  const updated = await repository.finalizeWhatsappSend(messageId, {
    status: "NEEDS_REVIEW",
    errorCode: sendResult.errorCode,
  });
  await appendOutboundEvent(
    repository,
    caseId,
    context.runId,
    "NEEDS_REVIEW",
    `The WhatsApp send outcome is uncertain with code ${sendResult.errorCode}. No automatic retry will occur. The scoped correction form remains available.`,
    sendResult.errorCode,
  );
  return { outcome: "NEEDS_REVIEW", message: updated, errorCode: sendResult.errorCode, created: true };
}

export async function resolveUncertainSend(
  input: ResolveUncertainSendInput,
): Promise<WhatsappOutboundResult> {
  const { repository } = input;
  if (!input.resolvedBy.trim()) {
    throw new Error("Uncertain send resolution requires an authorized operator identity.");
  }
  const [current] = await repository.db.select().from(whatsappMessages)
    .where(eq(whatsappMessages.id, input.messageId)).limit(1);
  if (!current) throw new Error("The WhatsApp message was not found.");
  if (current.status !== "NEEDS_REVIEW") {
    return { outcome: "ALREADY_RESOLVED", message: current, created: false };
  }
  const updated = await repository.resolveWhatsappNeedsReview(current.id, input.resolution === "CONFIRMED_SENT"
    ? { to: "SENT", providerMessageId: input.providerMessageId, errorCode: "MANUALLY_CONFIRMED_SENT" }
    : { to: "PENDING", errorCode: "MANUALLY_CONFIRMED_UNSENT" });
  const snapshot = await repository.getCaseSnapshot(current.caseId);
  if (snapshot?.run) {
    await appendOutboundEvent(
      repository,
      current.caseId,
      snapshot.run.id,
      "SENT",
      input.resolution === "CONFIRMED_SENT"
        ? `An uncertain WhatsApp send was manually confirmed as accepted by ${input.resolvedBy}.`
        : `An uncertain WhatsApp send was confirmed unsent by ${input.resolvedBy} and may be attempted again.`,
      input.resolution === "CONFIRMED_SENT" ? "WHATSAPP_MANUALLY_CONFIRMED" : "WHATSAPP_CONFIRMED_UNSENT",
    );
  }
  return {
    outcome: input.resolution === "CONFIRMED_SENT" ? "SENT" : "RETRYABLE",
    message: updated,
    created: false,
  };
}
