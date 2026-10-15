import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, isNull } from "drizzle-orm";

import { telegramContacts, type TelegramContact } from "@/server/db/schema";
import type { DemoRepository } from "@/server/db/repository";
import {
  contactLookupHash,
  decryptPhone,
  encryptPhone,
} from "@/server/whatsapp/contacts";

export const TELEGRAM_CONSENT_PROVENANCE = "telegram-/start";

export function chatLookupHash(chatId: string, hmacKey: string): string {
  return contactLookupHash(chatId, hmacKey);
}

export function encryptChatId(chatId: string, encryptionKey: string): { iv: string; ciphertext: string } {
  return encryptPhone(chatId, encryptionKey);
}

export function decryptChatId(iv: string, ciphertext: string, encryptionKey: string): string {
  return decryptPhone(iv, ciphertext, encryptionKey);
}

function bindingTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface CreateBindingTokenResult {
  token: string;
  expiresAt: Date;
}

/**
 * Operator-authorized staging step. Creates (or refreshes) the order's
 * Telegram contact row with a fresh single-use binding token. Only the
 * token hash is stored; the plain token is returned once for the
 * private deep link and must never be logged or committed.
 */
export async function createBindingToken(
  repository: DemoRepository,
  input: {
    orderId: string;
    provisionedBy: string;
    ttlMs?: number;
  },
): Promise<CreateBindingTokenResult> {
  if (!input.provisionedBy.trim()) throw new Error("Binding tokens require an operator identity.");
  const token = randomBytes(32).toString("hex").slice(0, 64);
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? 48 * 3600_000));
  const now = new Date();
  const [existing] = await repository.db.select().from(telegramContacts)
    .where(eq(telegramContacts.orderId, input.orderId)).limit(1);
  const values = {
    bindingTokenHash: bindingTokenHash(token),
    bindingExpiresAt: expiresAt,
    provisionedBy: input.provisionedBy.trim(),
    updatedAt: now,
  };
  if (existing) {
    await repository.db.update(telegramContacts).set(values)
      .where(eq(telegramContacts.id, existing.id));
  } else {
    await repository.db.insert(telegramContacts).values({
      orderId: input.orderId,
      chatLookupHash: null,
      chatIv: null,
      chatCiphertext: null,
      consentStatus: "OPTED_OUT",
      consentProvenance: "telegram-binding-issued",
      ...values,
      createdAt: now,
    });
  }
  return { token, expiresAt };
}

export interface ConsumeBindingTokenResult {
  ok: boolean;
  contact: TelegramContact | null;
}

/**
 * Atomically consumes a binding token while linking the authenticated
 * Telegram chat. Exactly one caller can win; the token is single-use and
 * records explicit /start consent. Never infer consent from WhatsApp state.
 */
export async function consumeBindingToken(
  repository: DemoRepository,
  input: {
    token: string;
    chatId: string;
    hmacKey: string;
    encryptionKey: string;
  },
): Promise<ConsumeBindingTokenResult> {
  if (!input.hmacKey || !input.encryptionKey || !input.chatId) {
    return { ok: false, contact: null };
  }
  const now = new Date();
  const sealed = encryptChatId(input.chatId, input.encryptionKey);
  const [linked] = await repository.db.update(telegramContacts).set({
    chatLookupHash: chatLookupHash(input.chatId, input.hmacKey),
    chatIv: sealed.iv,
    chatCiphertext: sealed.ciphertext,
    bindingTokenHash: null,
    bindingExpiresAt: null,
    consentStatus: "OPTED_IN",
    consentProvenance: TELEGRAM_CONSENT_PROVENANCE,
    consentedAt: now,
    updatedAt: now,
  }).where(and(
    eq(telegramContacts.bindingTokenHash, bindingTokenHash(input.token)),
    gt(telegramContacts.bindingExpiresAt, now),
    isNull(telegramContacts.chatLookupHash),
  )).returning();
  return { ok: !!linked, contact: linked ?? null };
}

export async function getTelegramContactForOrder(
  repository: DemoRepository,
  orderId: string,
): Promise<TelegramContact | null> {
  const [contact] = await repository.db.select().from(telegramContacts)
    .where(eq(telegramContacts.orderId, orderId)).limit(1);
  return contact ?? null;
}

export async function findTelegramContactsByChat(
  repository: DemoRepository,
  chatId: string,
  hmacKey: string,
): Promise<TelegramContact[]> {
  if (!hmacKey || !chatId) return [];
  return repository.db.select().from(telegramContacts)
    .where(and(
      eq(telegramContacts.chatLookupHash, chatLookupHash(chatId, hmacKey)),
      eq(telegramContacts.consentStatus, "OPTED_IN"),
    ));
}
