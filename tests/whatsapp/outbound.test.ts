import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import type { WhatsappTransport } from "@/integrations/whatsapp";
import { caseEvents, whatsappMessages } from "@/server/db/schema";
import { createTestDb } from "@/server/db/test-client";
import { DemoRepository } from "@/server/db/repository";
import { provisionCustomerContact } from "@/server/whatsapp/contacts";
import { requestCorrectionViaWhatsapp, retryWhatsappSend } from "@/server/whatsapp/outbound";
import { runWorkerOnce } from "@/worker/main";
import { seedDemoScenario } from "../../scripts/seed-demo";

const HMAC_KEY = "test-outbound-hmac-key";
const ENC_KEY = randomBytes(32).toString("hex");
const CUSTOMER_PHONE = "+2348012345678";

function baseEnv(): NodeJS.ProcessEnv {
  return {
    WHATSAPP_ENABLED: "true",
    WHATSAPP_PHONE_NUMBER_ID: "test-phone-number-id",
    WHATSAPP_ACCESS_TOKEN: "test-access-token",
    WHATSAPP_TEMPLATE_NAME: "nentra_correction_request",
    WHATSAPP_TEMPLATE_LANGUAGE: "en",
    WHATSAPP_CONTACT_HMAC_KEY: HMAC_KEY,
    WHATSAPP_CONTACT_ENCRYPTION_KEY: ENC_KEY,
  } as unknown as NodeJS.ProcessEnv;
}

describe("WhatsApp outbound correction request", () => {
  let database: Awaited<ReturnType<typeof createTestDb>> | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  async function seedWaitingCase() {
    database = await createTestDb();
    const repository = new DemoRepository(database.db);
    const fixture = await seedDemoScenario(repository, {
      correctionToken: "test-outbound-token-which-is-long-and-url-safe-2001",
    });
    await repository.startCase(fixture.caseId);
    for (let i = 0; i < 20; i += 1) {
      const snapshot = await repository.getCaseSnapshot(fixture.caseId);
      if (snapshot?.status === "WAITING_CUSTOMER") break;
      await runWorkerOnce(repository, { workerId: "test-outbound-worker" });
    }
    const waiting = await repository.getCaseSnapshot(fixture.caseId);
    expect(waiting?.status).toBe("WAITING_CUSTOMER");
    return { repository, caseId: fixture.caseId, orderId: waiting!.order.id };
  }

  async function provision(repository: DemoRepository, orderId: string, consented = true) {
    return provisionCustomerContact(repository, {
      orderId,
      phoneE164: CUSTOMER_PHONE,
      consented,
      provenance: "test-operator-console",
      provisionedBy: "test-operator",
      hmacKey: HMAC_KEY,
      encryptionKey: ENC_KEY,
    });
  }

  it("skips sending when disabled and stays idempotent without provider calls", async () => {
    const { repository, caseId } = await seedWaitingCase();
    let transportCalls = 0;
    const transport: WhatsappTransport = async () => {
      transportCalls += 1;
      return { status: 200, bodyJson: { messages: [{ id: "wamid.test" }] } };
    };
    const first = await requestCorrectionViaWhatsapp({
      repository,
      caseId,
      env: {} as unknown as NodeJS.ProcessEnv,
      transport,
    });
    expect(first.outcome).toBe("SKIPPED_DISABLED");
    expect(first.message.status).toBe("SKIPPED");
    expect(transportCalls).toBe(0);

    const second = await requestCorrectionViaWhatsapp({
      repository,
      caseId,
      env: {} as unknown as NodeJS.ProcessEnv,
      transport,
    });
    expect(second.outcome).toBe("SKIPPED_DISABLED");
    expect(second.created).toBe(false);
    expect(second.message.id).toBe(first.message.id);

    const rows = await database!.db.select().from(whatsappMessages);
    expect(rows).toHaveLength(1);
    expect((await repository.getCaseSnapshot(caseId))?.status).toBe("WAITING_CUSTOMER");
  });

  it("sends once from the authorized contact and never resends for the same correction", async () => {
    const { repository, caseId, orderId } = await seedWaitingCase();
    await provision(repository, orderId);
    let transportCalls = 0;
    const transport: WhatsappTransport = async (request) => {
      transportCalls += 1;
      expect(request.headers.Authorization).toBe("Bearer test-access-token");
      expect(request.body).toMatchObject({
        messaging_product: "whatsapp",
        to: CUSTOMER_PHONE,
        type: "template",
      });
      return { status: 200, bodyJson: { messages: [{ id: "wamid.sent123" }] } };
    };
    const first = await requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), transport });
    expect(first.outcome).toBe("SENT");
    expect(first.message.status).toBe("SENT");
    expect(first.message.providerMessageId).toBe("wamid.sent123");
    expect(first.message.attemptCount).toBe(1);
    expect(transportCalls).toBe(1);

    const second = await requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), transport });
    expect(second.outcome).toBe("SENT");
    expect(second.created).toBe(false);
    expect(transportCalls).toBe(1);

    const events = await database!.db.select().from(caseEvents).where(eq(caseEvents.caseId, caseId));
    const sentEvents = events.filter((event) => (event.publicPayload as { resultCode?: string }).resultCode === "WHATSAPP_SENT");
    expect(sentEvents).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("2348012345678");
    expect(JSON.stringify(events)).not.toContain("test-access-token");
  });

  it("marks definitive provider rejections without retry and retries only unsent attempts", async () => {
    const { repository, caseId, orderId } = await seedWaitingCase();
    await provision(repository, orderId);
    const failing: WhatsappTransport = async () => ({
      status: 500,
      bodyJson: { error: { code: 131000, message: "Something went wrong" } },
    });
    const failed = await requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), transport: failing });
    expect(failed.outcome).toBe("RETRYABLE");
    expect(failed.errorCode).toBe("META_131000");

    const succeeding: WhatsappTransport = async () => ({
      status: 200,
      bodyJson: { messages: [{ id: "wamid.retry-ok" }] },
    });
    const retried = await retryWhatsappSend({ repository, messageId: failed.message.id, env: baseEnv(), transport: succeeding });
    expect(retried.outcome).toBe("SENT");
    expect(retried.message.providerMessageId).toBe("wamid.retry-ok");
    expect(retried.message.attemptCount).toBe(2);

    const waiting = await repository.getCaseSnapshot(caseId);
    expect(waiting?.status).toBe("WAITING_CUSTOMER");
    expect(waiting?.correctionRequest?.status).toBe("PENDING");
  });

  it("refuses without an authorized contact", async () => {
    const { repository, caseId } = await seedWaitingCase();
    let transportCalls = 0;
    const transport: WhatsappTransport = async () => {
      transportCalls += 1;
      return { status: 200, bodyJson: { messages: [{ id: "wamid.never" }] } };
    };
    const missing = await requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), transport });
    expect(missing.outcome).toBe("CONTACT_UNAVAILABLE");
    expect(transportCalls).toBe(0);
    expect((await repository.getCaseSnapshot(caseId))?.status).toBe("WAITING_CUSTOMER");
  });

  it("refuses when contact keys are missing", async () => {
    const { repository, caseId, orderId } = await seedWaitingCase();
    await provision(repository, orderId);
    let transportCalls = 0;
    const transport: WhatsappTransport = async () => {
      transportCalls += 1;
      return { status: 200, bodyJson: { messages: [{ id: "wamid.never" }] } };
    };
    const keyless = { ...baseEnv(), WHATSAPP_CONTACT_HMAC_KEY: "", WHATSAPP_CONTACT_ENCRYPTION_KEY: "" } as unknown as NodeJS.ProcessEnv;
    const skipped = await requestCorrectionViaWhatsapp({ repository, caseId, env: keyless, transport });
    expect(skipped.outcome).toBe("SKIPPED_DISABLED");
    expect(skipped.errorCode).toBe("WHATSAPP_KEYS_MISSING");
    expect(transportCalls).toBe(0);
  });

  it("refuses when consent is withdrawn and keeps the scoped form path", async () => {
    const { repository, caseId, orderId } = await seedWaitingCase();
    await provision(repository, orderId, true);
    await provision(repository, orderId, false);
    let transportCalls = 0;
    const transport: WhatsappTransport = async () => {
      transportCalls += 1;
      return { status: 200, bodyJson: { messages: [{ id: "wamid.never" }] } };
    };
    const result = await requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), transport });
    expect(result.outcome).toBe("CONSENT_WITHDRAWN");
    expect(result.errorCode).toBe("CUSTOMER_CONSENT_MISSING");
    expect(transportCalls).toBe(0);
    expect((await repository.getCaseSnapshot(caseId))?.status).toBe("WAITING_CUSTOMER");
  });
});
