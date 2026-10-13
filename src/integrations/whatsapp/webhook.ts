import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;
  const match = /^sha256=([0-9a-fA-F]{64})$/.exec(signatureHeader.trim());
  if (!match) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(match[1], "hex");
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function verifyWebhookChallenge(
  url: URL,
  verifyToken: string,
): { ok: true; challenge: string } | { ok: false } {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (!verifyToken || mode !== "subscribe" || token !== verifyToken || !challenge) {
    return { ok: false };
  }
  return { ok: true, challenge };
}

const webhookTextMessageSchema = z
  .object({
    from: z.string(),
    id: z.string(),
    timestamp: z.string().optional(),
    type: z.string(),
    text: z.object({ body: z.string() }).strip().optional(),
    context: z.object({ id: z.string() }).strip().optional(),
  })
  .strip();

const webhookStatusSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    recipient_id: z.string().optional(),
    timestamp: z.string().optional(),
  })
  .strip();

const webhookValueSchema = z
  .object({
    messaging_product: z.string().optional(),
    metadata: z
      .object({
        phone_number_id: z.string(),
      })
      .strip()
      .optional(),
    messages: z.array(webhookTextMessageSchema).optional(),
    statuses: z.array(webhookStatusSchema).optional(),
  })
  .strip();

const webhookEnvelopeSchema = z
  .object({
    object: z.string().optional(),
    entry: z
      .array(
        z
          .object({
            changes: z
              .array(
                z
                  .object({
                    field: z.string(),
                    value: webhookValueSchema,
                  })
                  .strip(),
              )
              .optional(),
          })
          .strip(),
      )
      .optional(),
  })
  .strip();

export interface NormalizedInboundMessage {
  providerMessageId: string;
  senderRaw: string;
  messageType: string;
  textBody: string | null;
  replyToProviderMessageId: string | null;
  businessPhoneNumberId: string;
}

export interface NormalizedInboundStatus {
  providerMessageId: string;
  statusValue: string;
  businessPhoneNumberId: string;
}

export interface NormalizedWebhook {
  messages: NormalizedInboundMessage[];
  statuses: NormalizedInboundStatus[];
}

export function parseWebhookEnvelope(payload: unknown): NormalizedWebhook {
  const parsed = webhookEnvelopeSchema.safeParse(payload);
  const result: NormalizedWebhook = { messages: [], statuses: [] };
  if (!parsed.success) return result;
  for (const entry of parsed.data.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const businessPhoneNumberId = change.value.metadata?.phone_number_id;
      if (!businessPhoneNumberId) continue;
      for (const message of change.value.messages ?? []) {
        result.messages.push({
          providerMessageId: message.id,
          senderRaw: message.from,
          messageType: message.type,
          textBody: message.type === "text" ? (message.text?.body ?? null) : null,
          replyToProviderMessageId: message.context?.id ?? null,
          businessPhoneNumberId,
        });
      }
      for (const status of change.value.statuses ?? []) {
        result.statuses.push({
          providerMessageId: status.id,
          statusValue: status.status,
          businessPhoneNumberId,
        });
      }
    }
  }
  return result;
}

export function normalizeSenderE164(senderRaw: string): string | null {
  const digits = senderRaw.replace(/\D/g, "");
  const candidate = `+${digits}`;
  if (!/^\+[1-9]\d{7,14}$/.test(candidate)) return null;
  return candidate;
}
