import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import type { WhatsappTransport } from "@/integrations/whatsapp";
import { caseEvents, whatsappMessages } from "@/server/db/schema";
import { createTestDb } from "@/server/db/test-client";
import { DemoRepository } from "@/server/db/repository";
import { requestCorrectionViaWhatsapp } from "@/server/whatsapp/outbound";
import { runWorkerOnce } from "@/worker/main";
import { seedDemoScenario } from "../../scripts/seed-demo";

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
      correctionToken: "test-whatsapp-token-which-is-long-and-url-safe-0001",
    });
    await repository.startCase(fixture.caseId);
    for (let i = 0; i < 20; i += 1) {
      const snapshot = await repository.getCaseSnapshot(fixture.caseId);
      if (snapshot?.status === "WAITING_CUSTOMER") break;
      await runWorkerOnce(repository, { workerId: "test-whatsapp-worker" });
    }
    const waiting = await repository.getCaseSnapshot(fixture.caseId);
    expect(waiting?.status).toBe("WAITING_CUSTOMER");
    return { repository, caseId: fixture.caseId };
  }

  const enabledEnv = {
    WHATSAPP_ENABLED: "true",
    WHATSAPP_PHONE_NUMBER_ID: "test-phone-number-id",
    WHATSAPP_ACCESS_TOKEN: "test-access-token",
    WHATSAPP_TEMPLATE_NAME: "nentra_correction_request",
    WHATSAPP_TEMPLATE_LANGUAGE: "en",
  } as unknown as NodeJS.ProcessEnv;

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
      toPhoneE164: "+2348012345678",
      customerConsented: true,
      env: {} as NodeJS.ProcessEnv,
      transport,
    });
    expect(first.outcome).toBe("SKIPPED_DISABLED");
    expect(first.message.status).toBe("SKIPPED");
    expect(transportCalls).toBe(0);

    const second = await requestCorrectionViaWhatsapp({
      repository,
      caseId,
      toPhoneE164: "+2348012345678",
      customerConsented: true,
      env: {} as NodeJS.ProcessEnv,
      transport,
    });
    expect(second.outcome).toBe("SKIPPED_DISABLED");
    expect(second.created).toBe(false);
    expect(second.message.id).toBe(first.message.id);
    expect(transportCalls).toBe(0);

    const rows = await database!.db.select().from(whatsappMessages);
    expect(rows).toHaveLength(1);
    const waiting = await repository.getCaseSnapshot(caseId);
    expect(waiting?.status).toBe("WAITING_CUSTOMER");
  });

  it("sends once with an enabled provider and never resends for the same correction", async () => {
    const { repository, caseId } = await seedWaitingCase();
    let transportCalls = 0;
    const seenUrls: string[] = [];
    const transport: WhatsappTransport = async (request) => {
      transportCalls += 1;
      seenUrls.push(request.url);
      expect(request.headers.Authorization).toBe("Bearer test-access-token");
      expect(request.body).toMatchObject({
        messaging_product: "whatsapp",
        to: "+2348012345678",
        type: "template",
      });
      return { status: 200, bodyJson: { messages: [{ id: "wamid.sent123" }] } };
    };
    const first = await requestCorrectionViaWhatsapp({
      repository,
      caseId,
      toPhoneE164: "+2348012345678",
      customerConsented: true,
      env: enabledEnv,
      transport,
    });
    expect(first.outcome).toBe("SENT");
    expect(first.message.status).toBe("SENT");
    expect(first.message.providerMessageId).toBe("wamid.sent123");
    expect(first.message.attemptCount).toBe(1);
    expect(transportCalls).toBe(1);
    expect(seenUrls[0]).toContain("test-phone-number-id/messages");

    const second = await requestCorrectionViaWhatsapp({
      repository,
      caseId,
      toPhoneE164: "+2348012345678",
      customerConsented: true,
      env: enabledEnv,
      transport,
    });
    expect(second.outcome).toBe("SENT");
    expect(second.created).toBe(false);
    expect(transportCalls).toBe(1);

    const events = await database!.db.select().from(caseEvents)
      .where(eq(caseEvents.caseId, caseId));
    const sentEvents = events.filter((event) => {
      const payload = event.publicPayload as { resultCode?: string };
      return payload.resultCode === "WHATSAPP_SENT";
    });
    expect(sentEvents).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("+2348012345678");
    expect(JSON.stringify(events)).not.toContain("test-access-token");
  });

  it("persists provider failures without throwing and keeps the correction usable", async () => {
    const { repository, caseId } = await seedWaitingCase();
    const transport: WhatsappTransport = async () => ({
      status: 500,
      bodyJson: { error: { code: 131000, message: "Something went wrong" } },
    });
    const result = await requestCorrectionViaWhatsapp({
      repository,
      caseId,
      toPhoneE164: "+2348098765432",
      customerConsented: true,
      env: enabledEnv,
      transport,
    });
    expect(result.outcome).toBe("FAILED_PROVIDER");
    expect(result.errorCode).toBe("META_131000");
    expect(result.message.status).toBe("FAILED");

    const waiting = await repository.getCaseSnapshot(caseId);
    expect(waiting?.status).toBe("WAITING_CUSTOMER");
    expect(waiting?.correctionRequest?.status).toBe("PENDING");
  });

  it("rejects an invalid recipient without calling the provider", async () => {
    const { repository, caseId } = await seedWaitingCase();
    let transportCalls = 0;
    const transport: WhatsappTransport = async () => {
      transportCalls += 1;
      return { status: 200, bodyJson: { messages: [{ id: "wamid.never" }] } };
    };
    const result = await requestCorrectionViaWhatsapp({
      repository,
      caseId,
      toPhoneE164: "not-a-number",
      customerConsented: true,
      env: enabledEnv,
      transport,
    });
    expect(result.outcome).toBe("FAILED_INVALID_RECIPIENT");
    expect(transportCalls).toBe(0);
  });

  it("skips sending without consent and keeps the scoped form path", async () => {
    const { repository, caseId } = await seedWaitingCase();
    let transportCalls = 0;
    const transport: WhatsappTransport = async () => {
      transportCalls += 1;
      return { status: 200, bodyJson: { messages: [{ id: "wamid.never" }] } };
    };
    const result = await requestCorrectionViaWhatsapp({
      repository,
      caseId,
      toPhoneE164: "+2348012345678",
      customerConsented: false,
      env: enabledEnv,
      transport,
    });
    expect(result.outcome).toBe("SKIPPED_DISABLED");
    expect(result.errorCode).toBe("CUSTOMER_CONSENT_MISSING");
    expect(transportCalls).toBe(0);
  });
});
