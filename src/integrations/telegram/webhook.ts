import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

export function verifyTelegramSecret(
  headerValue: string | null,
  expectedSecret: string,
): boolean {
  if (!headerValue || !expectedSecret) return false;
  const actual = Buffer.from(headerValue, "utf8");
  const expected = Buffer.from(expectedSecret, "utf8");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

const telegramUserSchema = z.object({ id: z.number().int() }).strip();

const telegramChatSchema = z.object({ id: z.number().int(), type: z.string() }).strip();

const telegramMessageSchema = z.object({
  message_id: z.number().int(),
  from: telegramUserSchema.optional(),
  chat: telegramChatSchema,
  text: z.string().optional(),
}).strip();

const telegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: telegramMessageSchema.optional(),
}).strip();

export interface ParsedTelegramUpdate {
  updateId: string;
  chatId: string;
  chatType: string;
  userId: string | null;
  text: string | null;
}

export function parseTelegramUpdate(payload: unknown): ParsedTelegramUpdate | null {
  const parsed = telegramUpdateSchema.safeParse(payload);
  if (!parsed.success || !parsed.data.message) return null;
  const message = parsed.data.message;
  return {
    updateId: String(parsed.data.update_id),
    chatId: String(message.chat.id),
    chatType: message.chat.type,
    userId: message.from ? String(message.from.id) : null,
    text: message.text ?? null,
  };
}

export function isStartCommand(text: string | null): boolean {
  if (!text) return false;
  return text === "/start" || text.startsWith("/start ");
}

export function startCommandToken(text: string): string | null {
  const token = text.replace(/^\/start(@\S+)?\s*/, "").trim();
  if (!token || !/^[A-Za-z0-9_-]{1,64}$/.test(token)) return null;
  return token;
}
