import Twilio from "twilio";

import type { WhatsappSendFailure, WhatsappSendSuccess } from "./index";

export type WhatsappProviderName = "meta" | "twilio";

export interface TwilioSendConfig {
  provider: "twilio";
  accountSid: string;
  authToken: string;
  whatsappFrom: string;
  publicBaseUrl: string;
  timeoutMs: number;
}

export interface TwilioDisabledConfig {
  ok: false;
  reason:
    | "WHATSAPP_DISABLED"
    | "TWILIO_ACCOUNT_SID_MISSING"
    | "TWILIO_AUTH_TOKEN_MISSING"
    | "TWILIO_WHATSAPP_FROM_MISSING";
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function resolveWhatsappProvider(env: NodeJS.ProcessEnv = process.env): WhatsappProviderName {
  return (env.WHATSAPP_PROVIDER ?? "").trim().toLowerCase() === "twilio" ? "twilio" : "meta";
}

function normalizeWhatsappAddress(value: string): string | null {
  const trimmed = value.trim();
  const digits = trimmed.replace(/^whatsapp:/i, "");
  if (!/^\+[1-9]\d{7,14}$/.test(digits)) return null;
  return `whatsapp:${digits}`;
}

export function resolveTwilioConfig(
  env: NodeJS.ProcessEnv = process.env,
): { ok: true; config: TwilioSendConfig } | TwilioDisabledConfig {
  if ((env.WHATSAPP_ENABLED ?? "").trim().toLowerCase() !== "true") {
    return { ok: false, reason: "WHATSAPP_DISABLED" };
  }
  const accountSid = (env.TWILIO_ACCOUNT_SID ?? "").trim();
  if (!accountSid) {
    return { ok: false, reason: "TWILIO_ACCOUNT_SID_MISSING" };
  }
  const authToken = (env.TWILIO_AUTH_TOKEN ?? "").trim();
  if (!authToken) {
    return { ok: false, reason: "TWILIO_AUTH_TOKEN_MISSING" };
  }
  const whatsappFrom = normalizeWhatsappAddress(env.TWILIO_WHATSAPP_FROM ?? "");
  if (!whatsappFrom) {
    return { ok: false, reason: "TWILIO_WHATSAPP_FROM_MISSING" };
  }
  const publicBaseUrl = (env.TWILIO_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const timeoutRaw = Number.parseInt((env.WHATSAPP_TIMEOUT_MS ?? "").trim(), 10);
  const timeoutMs = Number.isSafeInteger(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_TIMEOUT_MS;
  return {
    ok: true,
    config: {
      provider: "twilio",
      accountSid,
      authToken,
      whatsappFrom,
      publicBaseUrl,
      timeoutMs,
    },
  };
}

export function twilioWebhookUrl(config: Pick<TwilioSendConfig, "publicBaseUrl">, path: string): string | null {
  if (!config.publicBaseUrl) return null;
  try {
    const url = new URL(path, `${config.publicBaseUrl}/`);
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function verifyTwilioSignature(
  authToken: string,
  signature: string | null,
  url: string | null,
  params: Record<string, string>,
): boolean {
  if (!authToken || !signature || !url) return false;
  try {
    return Twilio.validateRequest(authToken, signature, url, params);
  } catch {
    return false;
  }
}

export interface TwilioCorrectionRequest {
  toE164: string;
  orderNumber: string;
}

export function buildTwilioCorrectionBody(request: TwilioCorrectionRequest): string {
  return (
    `Nentra: order ${request.orderNumber} needs a delivery landmark. ` +
    `Reply LANDMARK: followed by your landmark.`
  );
}

export type TwilioMessageSender = (input: {
  from: string;
  to: string;
  body: string;
}) => Promise<{ sid: string }>;

export function createTwilioMessageSender(config: TwilioSendConfig): TwilioMessageSender {
  const client = Twilio(config.accountSid, config.authToken, { timeout: config.timeoutMs });
  return async (input) => {
    const message = await client.messages.create({
      from: input.from,
      to: input.to,
      body: input.body,
    });
    if (!message.sid) throw new Error("Twilio accepted the message without an SID.");
    return { sid: message.sid };
  };
}

function twilioErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "number" || typeof code === "string") {
      return `TWILIO_${String(code)}`;
    }
  }
  return "TWILIO_UNKNOWN_ERROR";
}

function twilioStatusCode(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

export async function sendTwilioCorrectionMessage(
  config: TwilioSendConfig,
  request: TwilioCorrectionRequest,
  sender: TwilioMessageSender = createTwilioMessageSender(config),
): Promise<WhatsappSendSuccess | WhatsappSendFailure> {
  const to = normalizeWhatsappAddress(request.toE164);
  if (!to) {
    return { outcome: "PERMANENT_SEND", errorCode: "INVALID_RECIPIENT" };
  }
  try {
    const { sid } = await sender({
      from: config.whatsappFrom,
      to,
      body: buildTwilioCorrectionBody(request),
    });
    if (!sid) {
      return { outcome: "AMBIGUOUS_SEND", errorCode: "SEND_RESPONSE_UNREADABLE" };
    }
    return { outcome: "SENT", providerMessageId: sid };
  } catch (error) {
    const errorCode = twilioErrorCode(error);
    const statusCode = twilioStatusCode(error);
    if (statusCode === undefined) {
      return { outcome: "UNKNOWN_SEND", errorCode: "TRANSPORT_ERROR" };
    }
    if (statusCode >= 500 || statusCode === 429) {
      return { outcome: "TRANSIENT_SEND", errorCode, statusCode };
    }
    return { outcome: "PERMANENT_SEND", errorCode, statusCode };
  }
}

export type TwilioMessageStatus =
  | "queued"
  | "accepted"
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "undelivered";

export function mapTwilioStatus(
  status: string,
): "SENT" | "DELIVERED" | "READ" | "FAILED" | null {
  switch (status.trim().toLowerCase()) {
    case "queued":
    case "accepted":
    case "sending":
    case "sent":
      return "SENT";
    case "delivered":
      return "DELIVERED";
    case "read":
      return "READ";
    case "failed":
    case "undelivered":
      return "FAILED";
    default:
      return null;
  }
}
