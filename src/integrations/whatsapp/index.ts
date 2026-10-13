import { createHash } from "node:crypto";

export type WhatsappSendClassification =
  | "SENT"
  | "TRANSIENT_SEND"
  | "PERMANENT_SEND"
  | "AMBIGUOUS_SEND";

export interface WhatsappConfig {
  enabled: boolean;
  apiVersion: string;
  phoneNumberId: string;
  accessToken: string;
  templateName: string;
  templateLanguage: string;
  timeoutMs: number;
}

export interface WhatsappResolvedConfig {
  ok: true;
  config: WhatsappConfig;
}

export interface WhatsappDisabledConfig {
  ok: false;
  reason:
    | "WHATSAPP_DISABLED"
    | "WHATSAPP_PHONE_NUMBER_ID_MISSING"
    | "WHATSAPP_ACCESS_TOKEN_MISSING"
    | "WHATSAPP_TEMPLATE_MISSING";
}

const DEFAULT_API_VERSION = "v23.0";
const DEFAULT_TEMPLATE_LANGUAGE = "en";
const DEFAULT_TIMEOUT_MS = 10_000;

export function resolveWhatsappConfig(
  env: NodeJS.ProcessEnv = process.env,
): WhatsappResolvedConfig | WhatsappDisabledConfig {
  if ((env.WHATSAPP_ENABLED ?? "").trim().toLowerCase() !== "true") {
    return { ok: false, reason: "WHATSAPP_DISABLED" };
  }
  const phoneNumberId = (env.WHATSAPP_PHONE_NUMBER_ID ?? "").trim();
  if (!phoneNumberId) {
    return { ok: false, reason: "WHATSAPP_PHONE_NUMBER_ID_MISSING" };
  }
  const accessToken = (env.WHATSAPP_ACCESS_TOKEN ?? "").trim();
  if (!accessToken) {
    return { ok: false, reason: "WHATSAPP_ACCESS_TOKEN_MISSING" };
  }
  const templateName = (env.WHATSAPP_TEMPLATE_NAME ?? "").trim();
  if (!templateName) {
    return { ok: false, reason: "WHATSAPP_TEMPLATE_MISSING" };
  }
  const apiVersion = (env.WHATSAPP_API_VERSION ?? DEFAULT_API_VERSION).trim().replace(/^v/i, "v");
  const templateLanguage = (env.WHATSAPP_TEMPLATE_LANGUAGE ?? DEFAULT_TEMPLATE_LANGUAGE).trim() || DEFAULT_TEMPLATE_LANGUAGE;
  const timeoutRaw = Number.parseInt((env.WHATSAPP_TIMEOUT_MS ?? "").trim(), 10);
  const timeoutMs = Number.isSafeInteger(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_TIMEOUT_MS;
  return {
    ok: true,
    config: {
      enabled: true,
      apiVersion,
      phoneNumberId,
      accessToken,
      templateName,
      templateLanguage,
      timeoutMs,
    },
  };
}

export interface WhatsappTemplateRequest {
  toE164: string;
  orderNumber: string;
}

export interface WhatsappTransportRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  timeoutMs: number;
}

export interface WhatsappTransportResponse {
  status: number;
  bodyJson: unknown;
}

export type WhatsappTransport = (
  request: WhatsappTransportRequest,
) => Promise<WhatsappTransportResponse>;

export async function defaultWhatsappTransport(
  request: WhatsappTransportRequest,
): Promise<WhatsappTransportResponse> {
  const response = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(request.timeoutMs),
  });
  let bodyJson: unknown = null;
  try {
    bodyJson = await response.json();
  } catch {
    bodyJson = null;
  }
  return { status: response.status, bodyJson };
}

export interface WhatsappSendSuccess {
  outcome: "SENT";
  providerMessageId: string;
}

export interface WhatsappSendFailure {
  outcome: "TRANSIENT_SEND" | "PERMANENT_SEND" | "AMBIGUOUS_SEND";
  errorCode: string;
  statusCode?: number;
}

function errorCodeOf(body: unknown): string {
  if (typeof body === "object" && body !== null && "error" in body) {
    const nested = (body as { error?: unknown }).error;
    if (typeof nested === "object" && nested !== null) {
      const record = nested as Record<string, unknown>;
      const code = record.code;
      const subcode = record.error_subcode;
      if (typeof code !== "undefined") {
        return typeof subcode !== "undefined"
          ? `META_${String(code)}_${String(subcode)}`
          : `META_${String(code)}`;
      }
    }
  }
  return "META_UNKNOWN_ERROR";
}

export function buildCorrectionIdempotencyKey(correctionRequestId: string): string {
  return `whatsapp-correction:${correctionRequestId}`;
}

export function hashRecipient(toE164: string): string {
  return createHash("sha256").update(toE164.trim()).digest("hex");
}

export function isValidE164(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value.trim());
}

export async function sendCorrectionTemplate(
  config: WhatsappConfig,
  request: WhatsappTemplateRequest,
  transport: WhatsappTransport = defaultWhatsappTransport,
): Promise<WhatsappSendSuccess | WhatsappSendFailure> {
  const url = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to: request.toE164,
    type: "template",
    template: {
      name: config.templateName,
      language: { code: config.templateLanguage },
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: request.orderNumber }],
        },
      ],
    },
  };
  let response: WhatsappTransportResponse;
  try {
    response = await transport({
      url,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body,
      timeoutMs: config.timeoutMs,
    });
  } catch {
    return { outcome: "TRANSIENT_SEND", errorCode: "TRANSPORT_ERROR" };
  }
  if (response.status >= 200 && response.status < 300) {
    const messages = (response.bodyJson as { messages?: Array<{ id?: unknown }> } | null)?.messages;
    const id = Array.isArray(messages) ? messages[0]?.id : undefined;
    if (typeof id === "string" && id.length > 0) {
      return { outcome: "SENT", providerMessageId: id };
    }
    return { outcome: "AMBIGUOUS_SEND", errorCode: "SEND_RESPONSE_UNREADABLE", statusCode: response.status };
  }
  const errorCode = errorCodeOf(response.bodyJson);
  if (response.status >= 500 || response.status === 429) {
    return { outcome: "TRANSIENT_SEND", errorCode, statusCode: response.status };
  }
  return { outcome: "PERMANENT_SEND", errorCode, statusCode: response.status };
}
