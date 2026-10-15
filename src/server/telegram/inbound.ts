import { HttpError } from "@/server/api/errors";
import { appendEventTx, DemoRepository } from "@/server/db/repository";
import { applyLandmarkText } from "@/server/messaging/landmark-correction";
import {
  isStartCommand,
  parseTelegramUpdate,
  startCommandToken,
  verifyTelegramSecret,
} from "@/integrations/telegram/webhook";
import {
  chatLookupHash,
  consumeBindingToken,
  findTelegramContactsByChat,
} from "@/server/telegram/contacts";

const MAX_REPLY_CHARS = 2_000;

export interface ProcessTelegramUpdateInput {
  repository: DemoRepository;
  rawBody: Buffer;
  secret: string | null;
  env?: NodeJS.ProcessEnv;
}

export interface TelegramUpdateResult {
  updateId: string;
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

export async function processTelegramUpdate(
  input: ProcessTelegramUpdateInput,
): Promise<{ acknowledged: true; processed: TelegramUpdateResult[] }> {
  const env = input.env ?? process.env;
  const expectedSecret = (env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  if (!expectedSecret) {
    throw new HttpError(500, "TELEGRAM_NOT_CONFIGURED", "Telegram webhook verification is not configured.");
  }
  if (!verifyTelegramSecret(input.secret, expectedSecret)) {
    throw new HttpError(401, "INVALID_SIGNATURE", "The Telegram webhook secret is invalid.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody.toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_PAYLOAD", "The Telegram update is not valid JSON.");
  }

  const { repository } = input;
  const update = parseTelegramUpdate(payload);
  if (!update) {
    return { acknowledged: true, processed: [] };
  }
  const hmacKey = env.TELEGRAM_CONTACT_HMAC_KEY ?? env.WHATSAPP_CONTACT_HMAC_KEY ?? "";
  const encryptionKey = env.TELEGRAM_CONTACT_ENCRYPTION_KEY ?? env.WHATSAPP_CONTACT_ENCRYPTION_KEY ?? "";
  const senderHash = update.chatId && hmacKey ? chatLookupHash(update.chatId, hmacKey) : null;
  const { record, created } = await repository.recordTelegramUpdate({
    updateId: update.updateId,
    chatLookupHash: senderHash,
  });
  if (!created && record.resultCode !== "RECEIVED") {
    return { acknowledged: true, processed: [{ updateId: update.updateId, result: "DUPLICATE_ACK" }] };
  }
  const finish = async (
    result: string,
    caseId?: string | null,
    correctionRequestId?: string | null,
  ): Promise<{ acknowledged: true; processed: TelegramUpdateResult[] }> => {
    await repository.updateTelegramUpdateResult(record.id, {
      resultCode: result,
      caseId: caseId ?? null,
      correctionRequestId: correctionRequestId ?? null,
    });
    return { acknowledged: true, processed: [{ updateId: update.updateId, result }] };
  };

  if (update.chatType !== "private") {
    return finish("NON_PRIVATE_CHAT");
  }
  if (isStartCommand(update.text)) {
    const token = startCommandToken(update.text ?? "");
    if (!token) {
      return finish("START_WITHOUT_TOKEN");
    }
    const linked = await consumeBindingToken(repository, {
      token,
      chatId: update.chatId,
      hmacKey,
      encryptionKey,
    });
    if (!linked.ok || !linked.contact) {
      return finish("EXPIRED_OR_INVALID_TOKEN");
    }
    return finish("LINKED", null, null);
  }
  if (update.text === null) {
    return finish("UNSUPPORTED_MESSAGE_TYPE");
  }
  if (update.text.length > MAX_REPLY_CHARS) {
    return finish("OVERSIZED_MESSAGE");
  }
  if (!hmacKey) {
    return finish("CONTACT_LOOKUP_UNAVAILABLE");
  }

  const contacts = await findTelegramContactsByChat(repository, update.chatId, hmacKey);
  if (contacts.length === 0) {
    return finish("NO_LINKED_CONTACT");
  }
  const candidates: Array<{ requestId: string; caseId: string; runId: string | null }> = [];
  for (const contact of contacts) {
    const pending = await repository.getPendingCorrectionsForOrder(contact.orderId);
    for (const row of pending) {
      if (row.caseStatus !== "WAITING_CUSTOMER") continue;
      candidates.push({ requestId: row.requestId, caseId: row.caseId, runId: row.activeRunId });
    }
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
          "Ambiguous Telegram reply held",
          "A customer reply could not be matched to a single pending request, so the order keeps waiting.",
          "AMBIGUOUS_CORRELATION",
        );
      }
    }
    return finish("AMBIGUOUS_CORRELATION");
  }
  const candidate = candidates[0]!;
  const result = await applyLandmarkText(repository, candidate, update.text, {
    label: "Telegram",
    validatedCode: "TELEGRAM_VALIDATED",
  });
  return finish(result, candidate.caseId, candidate.requestId);
}
