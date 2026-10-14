import { HttpError } from "@/server/api/errors";
import { appendEventTx, DemoRepository } from "@/server/db/repository";
import {
  contactLookupHash,
  normalizePhoneE164,
} from "@/server/whatsapp/contacts";
import { handleInboundMessage } from "@/server/whatsapp/inbound";
import {
  mapTwilioStatus,
  twilioWebhookUrl,
  verifyTwilioSignature,
  type TwilioSendConfig,
} from "@/integrations/whatsapp/twilio";

export interface ProcessTwilioWebhookInput {
  repository: DemoRepository;
  rawFormBody: string;
  signature: string | null;
  env?: NodeJS.ProcessEnv;
}

export interface TwilioItemResult {
  providerMessageId: string;
  result: string;
}

function parseFormBody(raw: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(raw)) {
    if (!(key in params)) params[key] = value;
  }
  return params;
}

function stripWhatsappPrefix(value: string): string {
  return value.trim().replace(/^whatsapp:/i, "");
}

async function requireTwilioConfig(env: NodeJS.ProcessEnv): Promise<TwilioSendConfig> {
  const accountSid = (env.TWILIO_ACCOUNT_SID ?? "").trim();
  const authToken = (env.TWILIO_AUTH_TOKEN ?? "").trim();
  const whatsappFrom = (env.TWILIO_WHATSAPP_FROM ?? "").trim();
  const publicBaseUrl = (env.TWILIO_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!accountSid || !authToken || !whatsappFrom || !publicBaseUrl) {
    throw new HttpError(500, "WHATSAPP_NOT_CONFIGURED", "Twilio messaging is not configured.");
  }
  const timeoutRaw = Number.parseInt((env.WHATSAPP_TIMEOUT_MS ?? "").trim(), 10);
  return {
    provider: "twilio",
    accountSid,
    authToken,
    whatsappFrom,
    publicBaseUrl,
    timeoutMs: Number.isSafeInteger(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 10_000,
  };
}

export async function processTwilioIncoming(
  input: ProcessTwilioWebhookInput,
): Promise<{ acknowledged: true; processed: TwilioItemResult[] }> {
  const env = input.env ?? process.env;
  const config = await requireTwilioConfig(env);
  const hmacKey = env.WHATSAPP_CONTACT_HMAC_KEY ?? "";
  const params = parseFormBody(input.rawFormBody);
  const url = twilioWebhookUrl(config, "/api/whatsapp/twilio/incoming");
  if (!verifyTwilioSignature(config.authToken, input.signature, url, params)) {
    throw new HttpError(401, "INVALID_SIGNATURE", "The Twilio signature is invalid.");
  }
  if ((params.AccountSid ?? "").trim() !== config.accountSid) {
    throw new HttpError(403, "WRONG_ACCOUNT", "The webhook account does not match.");
  }
  const destination = normalizePhoneE164(stripWhatsappPrefix(params.To ?? ""));
  const expectedDestination = normalizePhoneE164(stripWhatsappPrefix(config.whatsappFrom));
  if (!destination || destination !== expectedDestination) {
    throw new HttpError(403, "WRONG_DESTINATION", "The webhook destination does not match.");
  }
  const messageSid = (params.MessageSid ?? "").trim();
  if (!messageSid) {
    throw new HttpError(400, "INVALID_PAYLOAD", "The Twilio message has no SID.");
  }
  const senderE164 = normalizePhoneE164(stripWhatsappPrefix(params.From ?? ""));
  const { repository } = input;
  const { record, created } = await repository.recordInboundEvent({
    providerMessageId: messageSid,
    provider: "twilio",
    kind: "MESSAGE",
    senderLookupHash: senderE164 && hmacKey ? contactLookupHash(senderE164, hmacKey) : null,
  });
  if (!created && record.resultCode !== "RECEIVED") {
    return { acknowledged: true, processed: [{ providerMessageId: messageSid, result: "DUPLICATE_ACK" }] };
  }
  const mediaCount = Number.parseInt((params.NumMedia ?? "0").trim(), 10);
  const result = await handleInboundMessage(repository, {
    inboundId: record.id,
    providerMessageId: messageSid,
    senderE164,
    messageType: Number.isSafeInteger(mediaCount) && mediaCount > 0 ? "media" : "text",
    textBody: params.Body ?? null,
    replyToProviderMessageId: null,
    hmacKey,
  });
  return { acknowledged: true, processed: [{ providerMessageId: messageSid, result }] };
}

export async function processTwilioStatus(
  input: ProcessTwilioWebhookInput,
): Promise<{ acknowledged: true; processed: TwilioItemResult[] }> {
  const env = input.env ?? process.env;
  const config = await requireTwilioConfig(env);
  const params = parseFormBody(input.rawFormBody);
  const url = twilioWebhookUrl(config, "/api/whatsapp/twilio/status");
  if (!verifyTwilioSignature(config.authToken, input.signature, url, params)) {
    throw new HttpError(401, "INVALID_SIGNATURE", "The Twilio signature is invalid.");
  }
  if ((params.AccountSid ?? "").trim() !== config.accountSid) {
    throw new HttpError(403, "WRONG_ACCOUNT", "The webhook account does not match.");
  }
  const messageSid = (params.MessageSid ?? "").trim();
  const statusValue = (params.MessageStatus ?? "").trim();
  if (!messageSid || !statusValue) {
    throw new HttpError(400, "INVALID_PAYLOAD", "The Twilio status callback is incomplete.");
  }
  const mapped = mapTwilioStatus(statusValue);
  const notificationKey = `twilio-status:${messageSid}:${statusValue.toLowerCase()}`;
  const { repository } = input;
  const { record, created } = await repository.recordInboundEvent({
    providerMessageId: notificationKey,
    provider: "twilio",
    kind: "STATUS",
    statusValue: statusValue.toLowerCase(),
    resultCode: mapped ? "STATUS_RECORDED" : "STATUS_IGNORED",
  });
  if (!created) {
    return { acknowledged: true, processed: [{ providerMessageId: record.providerMessageId, result: "DUPLICATE_ACK" }] };
  }
  if (mapped && mapped !== "SENT") {
    const transition = await repository.updateWhatsappMessageFromStatus(messageSid, mapped, "twilio");
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
  } else if (mapped === "SENT") {
    await repository.updateWhatsappMessageFromStatus(messageSid, "SENT", "twilio");
  }
  return { acknowledged: true, processed: [{ providerMessageId: record.providerMessageId, result: record.resultCode }] };
}
