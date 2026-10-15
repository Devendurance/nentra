import { eq } from "drizzle-orm";

import {
  resolveTelegramConfig,
  sendTelegramCorrectionMessage,
  type TelegramMessageSender,
} from "@/integrations/telegram/client";
import { appendEventTx, DemoRepository } from "@/server/db/repository";
import { telegramOutboundMessages, type TelegramOutboundMessage } from "@/server/db/schema";
import {
  chatLookupHash,
  decryptChatId,
  getTelegramContactForOrder,
} from "@/server/telegram/contacts";

export type TelegramOutboundOutcome =
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

export interface TelegramOutboundResult {
  outcome: TelegramOutboundOutcome;
  message: TelegramOutboundMessage;
  errorCode?: string;
  created: boolean;
}

export interface RequestCorrectionViaTelegramInput {
  repository: DemoRepository;
  caseId: string;
  env?: NodeJS.ProcessEnv;
  sender?: TelegramMessageSender;
}

const DEFAULT_MAX_SEND_ATTEMPTS = 3;

export function maxTelegramSendAttempts(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number.parseInt((env.TELEGRAM_MAX_SEND_ATTEMPTS ?? "").trim(), 10);
  if (Number.isSafeInteger(raw) && raw >= 1 && raw <= 10) return raw;
  return DEFAULT_MAX_SEND_ATTEMPTS;
}

function buildTelegramIdempotencyKey(pendingId: string): string {
  return `telegram-correction:${pendingId}`;
}

function eventTitleFor(outcome: TelegramOutboundOutcome): string {
  switch (outcome) {
    case "SENT":
      return "Customer contacted on Telegram";
    case "IN_PROGRESS":
      return "Telegram send already in progress";
    case "RETRYABLE":
      return "Telegram send failed before delivery";
    case "NEEDS_REVIEW":
      return "Telegram send outcome uncertain";
    case "SKIPPED_DISABLED":
      return "Telegram unavailable, scoped form fallback";
    case "CONTACT_UNAVAILABLE":
      return "No authorized customer contact";
    case "CONSENT_WITHDRAWN":
      return "Customer consent withdrawn";
    case "INVALID_RECIPIENT":
      return "Telegram request blocked, invalid recipient";
    case "FAILED_PROVIDER":
      return "Telegram request failed";
    case "MAX_ATTEMPTS_EXHAUSTED":
      return "Telegram send attempts exhausted";
    case "ALREADY_RESOLVED":
      return "Correction already resolved";
  }
}

async function appendOutboundEvent(
  repository: DemoRepository,
  caseId: string,
  runId: string,
  outcome: TelegramOutboundOutcome,
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

interface ResolvedTelegramSendContext {
  pendingId: string;
  runId: string;
  orderNumber: string;
  idempotencyKey: string;
  chatId: string;
  recipientHash: string;
}

async function resolveSendContext(
  repository: DemoRepository,
  caseId: string,
  env: NodeJS.ProcessEnv,
): Promise<
  | { ok: true; context: ResolvedTelegramSendContext }
  | { ok: false; outcome: TelegramOutboundOutcome; errorCode: string }
> {
  const telegram = resolveTelegramConfig(env);
  if (!telegram.ok) {
    return { ok: false, outcome: "SKIPPED_DISABLED", errorCode: telegram.reason };
  }
  const pending = await repository.getCorrectionRequestForCase(caseId);
  const snapshot = await repository.getCaseSnapshot(caseId);
  if (!pending || !snapshot || snapshot.status !== "WAITING_CUSTOMER" || !snapshot.run) {
    throw new Error("The case has no pending customer correction request.");
  }
  const hmacKey = env.TELEGRAM_CONTACT_HMAC_KEY ?? env.WHATSAPP_CONTACT_HMAC_KEY ?? "";
  const encryptionKey = env.TELEGRAM_CONTACT_ENCRYPTION_KEY ?? env.WHATSAPP_CONTACT_ENCRYPTION_KEY ?? "";
  if (!hmacKey || !encryptionKey) {
    return { ok: false, outcome: "SKIPPED_DISABLED", errorCode: "TELEGRAM_KEYS_MISSING" };
  }
  const contact = await getTelegramContactForOrder(repository, snapshot.order.id);
  if (!contact || !contact.chatLookupHash || !contact.chatIv || !contact.chatCiphertext) {
    return { ok: false, outcome: "CONTACT_UNAVAILABLE", errorCode: "TELEGRAM_NOT_LINKED" };
  }
  if (contact.consentStatus !== "OPTED_IN") {
    return { ok: false, outcome: "CONSENT_WITHDRAWN", errorCode: "CUSTOMER_CONSENT_MISSING" };
  }
  let chatId: string;
  try {
    chatId = decryptChatId(contact.chatIv, contact.chatCiphertext, encryptionKey);
    if (!/^-?\d{1,20}$/.test(chatId)) {
      return { ok: false, outcome: "INVALID_RECIPIENT", errorCode: "INVALID_RECIPIENT" };
    }
  } catch {
    return { ok: false, outcome: "INVALID_RECIPIENT", errorCode: "RECIPIENT_UNREADABLE" };
  }
  return {
    ok: true,
    context: {
      pendingId: pending.id,
      runId: snapshot.run.id,
      orderNumber: snapshot.order.orderNumber,
      idempotencyKey: buildTelegramIdempotencyKey(pending.id),
      chatId,
      recipientHash: chatLookupHash(chatId, hmacKey),
    },
  };
}

function mapExistingTelegramOutcome(record: TelegramOutboundMessage): TelegramOutboundResult | null {
  switch (record.status) {
    case "SENT":
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

export async function requestCorrectionViaTelegram(
  input: RequestCorrectionViaTelegramInput,
): Promise<TelegramOutboundResult> {
  const { repository, caseId } = input;
  const env = input.env ?? process.env;
  const resolved = await resolveSendContext(repository, caseId, env);
  if (!resolved.ok) {
    const pending = await repository.getCorrectionRequestForCase(caseId);
    const snapshot = await repository.getCaseSnapshot(caseId);
    if (!pending || !snapshot?.run) {
      throw new Error("The case has no pending customer correction request.");
    }
    const { record } = await repository.insertTelegramMessagePending({
      caseId,
      correctionRequestId: pending.id,
      idempotencyKey: buildTelegramIdempotencyKey(pending.id),
      recipientHash: "unavailable",
    });
    if (record.status !== "SKIPPED") {
      await repository.db.update(telegramOutboundMessages).set({
        status: "SKIPPED",
        errorCode: resolved.errorCode,
        updatedAt: new Date(),
      }).where(eq(telegramOutboundMessages.id, record.id));
    }
    const latest = await repository.getTelegramMessageByIdempotencyKey(buildTelegramIdempotencyKey(pending.id));
    await appendOutboundEvent(
      repository,
      caseId,
      snapshot.run.id,
      resolved.outcome,
      `Telegram delivery skipped with code ${resolved.errorCode}. The scoped correction form remains available.`,
      resolved.errorCode,
    );
    return { outcome: resolved.outcome, message: latest!, errorCode: resolved.errorCode, created: true };
  }
  const context = resolved.context;

  const preexisting = await repository.getTelegramMessageByIdempotencyKey(context.idempotencyKey);
  if (preexisting) {
    if (preexisting.status === "SKIPPED") {
      const reset = await repository.resetSkippedTelegramMessage(context.idempotencyKey);
      if (!reset) {
        const latest = await repository.getTelegramMessageByIdempotencyKey(context.idempotencyKey);
        if (!latest) throw new Error("The Telegram message disappeared during claiming.");
        const mapped = mapExistingTelegramOutcome(latest);
        if (mapped) return mapped;
      }
    } else {
      const mapped = mapExistingTelegramOutcome(preexisting);
      if (mapped) return mapped;
    }
  }

  const { record } = await repository.insertTelegramMessagePending({
    caseId,
    correctionRequestId: context.pendingId,
    idempotencyKey: context.idempotencyKey,
    recipientHash: context.recipientHash,
  });
  if (record.attemptCount >= maxTelegramSendAttempts(env)) {
    await appendOutboundEvent(
      repository,
      caseId,
      context.runId,
      "MAX_ATTEMPTS_EXHAUSTED",
      "Telegram send attempts are exhausted. The scoped correction form remains available.",
      "MAX_ATTEMPTS_EXHAUSTED",
    );
    return { outcome: "MAX_ATTEMPTS_EXHAUSTED", message: record, errorCode: "MAX_ATTEMPTS_EXHAUSTED", created: false };
  }
  const claimed = await repository.claimTelegramSend(record.id);
  if (!claimed) {
    const latest = await repository.getTelegramMessageByIdempotencyKey(context.idempotencyKey);
    if (!latest) throw new Error("The Telegram message disappeared during claiming.");
    return { outcome: "IN_PROGRESS", message: latest, created: false };
  }
  await appendOutboundEvent(
    repository,
    caseId,
    context.runId,
    "SENT",
    "A Telegram send attempt was claimed. The scoped correction form remains available meanwhile.",
    "TELEGRAM_SEND_CLAIMED",
    "Telegram send claimed",
  );
  return executeClaimedSend(repository, caseId, context, claimed.id, input.sender, env);
}

async function executeClaimedSend(
  repository: DemoRepository,
  caseId: string,
  context: ResolvedTelegramSendContext,
  messageId: string,
  sender: TelegramMessageSender | undefined,
  env: NodeJS.ProcessEnv,
): Promise<TelegramOutboundResult> {
  const telegram = resolveTelegramConfig(env);
  if (!telegram.ok) {
    throw new Error("Telegram configuration disappeared during the send.");
  }
  const sendResult = await sendTelegramCorrectionMessage(
    telegram.config,
    { chatId: context.chatId, orderNumber: context.orderNumber },
    sender,
  );
  if (sendResult.outcome === "SENT") {
    const updated = await repository.finalizeTelegramSend(messageId, {
      status: "SENT",
      providerMessageId: String(sendResult.messageId),
    });
    await appendOutboundEvent(
      repository,
      caseId,
      context.runId,
      "SENT",
      "Telegram accepted the correction request. The scoped correction form remains available meanwhile.",
      "TELEGRAM_SENT",
    );
    return { outcome: "SENT", message: updated, created: true };
  }
  if (sendResult.outcome === "PERMANENT_SEND") {
    const updated = await repository.finalizeTelegramSend(messageId, {
      status: "FAILED",
      errorCode: sendResult.errorCode,
    });
    await appendOutboundEvent(
      repository,
      caseId,
      context.runId,
      "FAILED_PROVIDER",
      `Telegram delivery was definitively rejected with code ${sendResult.errorCode}. The scoped correction form remains available.`,
      sendResult.errorCode,
    );
    return { outcome: "FAILED_PROVIDER", message: updated, errorCode: sendResult.errorCode, created: true };
  }
  if (sendResult.outcome === "TRANSIENT_SEND") {
    const updated = await repository.finalizeTelegramSend(messageId, {
      status: "RETRYABLE",
      errorCode: sendResult.errorCode,
    });
    await appendOutboundEvent(
      repository,
      caseId,
      context.runId,
      "RETRYABLE",
      `Telegram delivery failed before sending with code ${sendResult.errorCode}. The scoped correction form remains available.`,
      sendResult.errorCode,
    );
    return { outcome: "RETRYABLE", message: updated, errorCode: sendResult.errorCode, created: true };
  }
  const updated = await repository.finalizeTelegramSend(messageId, {
    status: "NEEDS_REVIEW",
    errorCode: sendResult.errorCode,
  });
  await appendOutboundEvent(
    repository,
    caseId,
    context.runId,
    "NEEDS_REVIEW",
    `The Telegram send outcome is uncertain with code ${sendResult.errorCode}. No automatic retry will occur. The scoped correction form remains available.`,
    sendResult.errorCode,
  );
  return { outcome: "NEEDS_REVIEW", message: updated, errorCode: sendResult.errorCode, created: true };
}
