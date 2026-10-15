import "dotenv/config";

import { closeDb, getDb } from "@/server/db/client";
import { DemoRepository } from "@/server/db/repository";
import { customerContacts, whatsappInboundEvents, whatsappMessages } from "@/server/db/schema";
import { normalizePhoneE164, provisionCustomerContact } from "@/server/whatsapp/contacts";

const STAGING_HOST_MARKER = "ep-floral-sunset-b4qbqg0r";
const PRODUCTION_HOST_MARKER = "ep-wispy-meadow";
const PROVENANCE = "p6.5d-staging-owner-consent";
const PROVISIONED_BY = "staging-operator";

function requiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required in the environment.`);
  return value;
}

function stagingDatabaseUrl(): string {
  const url = (process.env.STAGING_DATABASE_URL ?? process.env.DATABASE_URL ?? "").trim();
  if (!url) throw new Error("STAGING_DATABASE_URL (or DATABASE_URL pointing at staging) is required.");
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("The staging database URL is not a valid URL.");
  }
  if (host.includes(PRODUCTION_HOST_MARKER)) {
    throw new Error(`Refusing: URL points at the production host (${PRODUCTION_HOST_MARKER}*).`);
  }
  if (!host.includes(STAGING_HOST_MARKER)) {
    throw new Error(`Refusing: URL host does not match the staging marker (${STAGING_HOST_MARKER}).`);
  }
  process.env.DATABASE_URL = url;
  return host;
}

async function verify(repository: DemoRepository): Promise<void> {
  const cases = await repository.listCases();
  const messageRows = await repository.db.select({ id: whatsappMessages.id }).from(whatsappMessages);
  const inboundRows = await repository.db.select({ id: whatsappInboundEvents.id }).from(whatsappInboundEvents);
  const contacts = await repository.db.select({
    consentStatus: customerContacts.consentStatus,
    consentProvenance: customerContacts.consentProvenance,
    provisionedBy: customerContacts.provisionedBy,
  }).from(customerContacts);
  const summary = {
    caseCount: cases.length,
    cases: cases.map((c) => ({ orderNumber: c.order.orderNumber, status: c.status })),
    whatsappMessageCount: messageRows.length,
    whatsappInboundEventCount: inboundRows.length,
    contactCount: contacts.length,
    contacts: contacts.map((c) => ({
      consentStatus: c.consentStatus,
      consentProvenance: c.consentProvenance,
      provisionedBy: c.provisionedBy,
    })),
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

async function provision(repository: DemoRepository): Promise<void> {
  const phone = requiredEnv("WHATSAPP_TEST_NUMBER");
  const hmacKey = requiredEnv("WHATSAPP_CONTACT_HMAC_KEY");
  const encryptionKey = requiredEnv("WHATSAPP_CONTACT_ENCRYPTION_KEY");
  const normalized = normalizePhoneE164(phone);
  if (!normalized) throw new Error("WHATSAPP_TEST_NUMBER is not valid E.164.");
  const cases = await repository.listCases();
  const target = cases.find((c) => c.order.orderNumber === "NG-2048");
  if (!target) throw new Error("Staging order NG-2048 was not found.");
  const contact = await provisionCustomerContact(repository, {
    orderId: target.order.id,
    phoneE164: normalized,
    consented: true,
    provenance: PROVENANCE,
    provisionedBy: PROVISIONED_BY,
    hmacKey,
    encryptionKey,
  });
  process.stdout.write(`${JSON.stringify({
    provisioned: true,
    orderNumber: target.order.orderNumber,
    caseStatus: target.status,
    consentStatus: contact.consentStatus,
    consentProvenance: contact.consentProvenance,
    provisionedBy: contact.provisionedBy,
  })}\n`);
}

async function main(): Promise<void> {
  const mode = (process.argv[2] ?? "").trim();
  if (mode !== "provision" && mode !== "verify") {
    throw new Error('Usage: staging-contact.ts <provision|verify>');
  }
  const host = stagingDatabaseUrl();
  if ((process.env.WHATSAPP_ENABLED ?? "").trim().toLowerCase() === "true") {
    throw new Error("Refusing: WHATSAPP_ENABLED must stay false during preparation.");
  }
  const repository = new DemoRepository(getDb());
  try {
    if (mode === "provision") await provision(repository);
    else await verify(repository);
    process.stdout.write(`stagingHostMarker:${STAGING_HOST_MARKER} matchedHost:${host.split(".")[0]}\n`);
  } finally {
    await closeDb();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/staging-contact.ts")) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Staging contact step failed"}\n`);
    process.exitCode = 1;
  });
}
