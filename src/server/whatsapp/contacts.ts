import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { customerContacts, type CustomerContact } from "@/server/db/schema";
import type { DemoRepository } from "@/server/db/repository";

export function normalizePhoneE164(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  const candidate = `+${digits}`;
  if (!/^\+[1-9]\d{7,14}$/.test(candidate)) return null;
  return candidate;
}

export function contactLookupHash(phoneE164: string, hmacKey: string): string {
  return createHmac("sha256", hmacKey).update(phoneE164).digest("hex");
}

function encryptionKeyBytes(rawKey: string): Buffer {
  const trimmed = rawKey.trim();
  for (const encoding of ["hex", "base64"] as const) {
    try {
      const bytes = Buffer.from(trimmed, encoding);
      if (bytes.length === 32 && Buffer.from(bytes.toString(encoding), encoding).equals(bytes)) {
        return bytes;
      }
    } catch {
      continue;
    }
  }
  throw new Error("The contact encryption key must be 32 random bytes encoded as hex or base64.");
}

export function encryptPhone(phoneE164: string, rawKey: string): { iv: string; ciphertext: string } {
  const key = encryptionKeyBytes(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(phoneE164, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("hex"),
    ciphertext: Buffer.concat([tag, ciphertext]).toString("base64"),
  };
}

export function decryptPhone(ivHex: string, ciphertextB64: string, rawKey: string): string {
  const key = encryptionKeyBytes(rawKey);
  const combined = Buffer.from(ciphertextB64, "base64");
  const tag = combined.subarray(0, 16);
  const ciphertext = combined.subarray(16);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export interface ProvisionContactInput {
  orderId: string;
  phoneE164: string;
  consented: boolean;
  provenance: string;
  provisionedBy: string;
  hmacKey: string;
  encryptionKey: string;
}

export async function provisionCustomerContact(
  repository: DemoRepository,
  input: ProvisionContactInput,
): Promise<CustomerContact> {
  const normalized = normalizePhoneE164(input.phoneE164);
  if (!normalized) throw new Error("The customer phone number is not valid E.164.");
  if (!input.provisionedBy.trim() || !input.provenance.trim()) {
    throw new Error("Contact provisioning requires an operator identity and provenance.");
  }
  if (!input.hmacKey || !input.encryptionKey) {
    throw new Error("Contact crypto keys are required for provisioning.");
  }
  const now = new Date();
  const sealed = encryptPhone(normalized, input.encryptionKey);
  const values = {
    orderId: input.orderId,
    lookupHash: contactLookupHash(normalized, input.hmacKey),
    phoneIv: sealed.iv,
    phoneCiphertext: sealed.ciphertext,
    consentStatus: (input.consented ? "OPTED_IN" : "OPTED_OUT") as "OPTED_IN" | "OPTED_OUT",
    consentProvenance: input.provenance.trim(),
    provisionedBy: input.provisionedBy.trim(),
    consentedAt: input.consented ? now : null,
    updatedAt: now,
  };
  const [existing] = await repository.db.select().from(customerContacts)
    .where(eq(customerContacts.orderId, input.orderId)).limit(1);
  if (existing) {
    const [updated] = await repository.db.update(customerContacts).set(values)
      .where(eq(customerContacts.id, existing.id)).returning();
    if (!updated) throw new Error("Could not update the customer contact.");
    return updated;
  }
  const [created] = await repository.db.insert(customerContacts).values({
    ...values,
    createdAt: now,
  }).returning();
  if (!created) throw new Error("Could not provision the customer contact.");
  return created;
}

export async function getContactForOrder(
  repository: DemoRepository,
  orderId: string,
): Promise<CustomerContact | null> {
  const [contact] = await repository.db.select().from(customerContacts)
    .where(eq(customerContacts.orderId, orderId)).limit(1);
  return contact ?? null;
}

export async function findContactsBySender(
  repository: DemoRepository,
  senderE164: string,
  hmacKey: string,
): Promise<CustomerContact[]> {
  if (!hmacKey) return [];
  return repository.db.select().from(customerContacts)
    .where(and(
      eq(customerContacts.lookupHash, contactLookupHash(senderE164, hmacKey)),
      eq(customerContacts.consentStatus, "OPTED_IN"),
    ));
}
