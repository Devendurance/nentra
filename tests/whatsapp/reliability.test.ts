import { createHmac, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import type { WhatsappTransport } from "@/integrations/whatsapp";
import { caseEvents, whatsappMessages } from "@/server/db/schema";
import { createTestDb } from "@/server/db/test-client";
import { DemoRepository } from "@/server/db/repository";
import { provisionCustomerContact } from "@/server/whatsapp/contacts";
import {
  requestCorrectionViaWhatsapp,
  resolveUncertainSend,
  retryWhatsappSend,
} from "@/server/whatsapp/outbound";
import { processWhatsappWebhook } from "@/server/whatsapp/inbound";
import { runWorkerOnce } from "@/worker/main";
import { seedDemoScenario } from "../../scripts/seed-demo";

const HMAC_KEY = "test-reliability-hmac-key";
const ENC_KEY = randomBytes(32).toString("hex");
const APP_SECRET = "test-reliability-app-secret";
const BUSINESS_ID = "test-reliability-business-id";
const CUSTOMER_PHONE = "+2348012345678";

function baseEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    WHATSAPP_ENABLED: "true",
    WHATSAPP_PHONE_NUMBER_ID: BUSINESS_ID,
    WHATSAPP_ACCESS_TOKEN: "test-access-token",
    WHATSAPP_TEMPLATE_NAME: "nentra_correction_request",
    WHATSAPP_TEMPLATE_LANGUAGE: "en",
    WHATSAPP_APP_SECRET: APP_SECRET,
    WHATSAPP_CONTACT_HMAC_KEY: HMAC_KEY,
    WHATSAPP_CONTACT_ENCRYPTION_KEY: ENC_KEY,
    ...extra,
  } as unknown as NodeJS.ProcessEnv;
}

function sign(raw: string): string {
  return `sha256=${createHmac("sha256", APP_SECRET).update(raw).digest("hex")}`;
}

function statusEnvelope(options: { wamid: string; status: string; timestamp?: string }): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{
      id: "test-entry",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "15550001111", phone_number_id: BUSINESS_ID },
          statuses: [{
            id: options.wamid,
            status: options.status,
            timestamp: options.timestamp ?? "1760290001",
            recipient_id: "2348012345678",
          }],
        },
      }],
    }],
  });
}

describe("WhatsApp reliability and idempotency", () => {
  let database: Awaited<ReturnType<typeof createTestDb>> | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  async function seedWaitingCase(token = "test-reliability-token-which-is-long-and-url-safe-3001") {
    database = await createTestDb();
    const repository = new DemoRepository(database.db);
    const fixture = await seedDemoScenario(repository, { correctionToken: token });
    await repository.startCase(fixture.caseId);
    for (let i = 0; i < 20; i += 1) {
      const snapshot = await repository.getCaseSnapshot(fixture.caseId);
      if (snapshot?.status === "WAITING_CUSTOMER") break;
      await runWorkerOnce(repository, { workerId: "test-reliability-worker" });
    }
    const waiting = await repository.getCaseSnapshot(fixture.caseId);
    expect(waiting?.status).toBe("WAITING_CUSTOMER");
    await provisionCustomerContact(repository, {
      orderId: waiting!.order.id,
      phoneE164: CUSTOMER_PHONE,
      consented: true,
      provenance: "test-operator-console",
      provisionedBy: "test-operator",
      hmacKey: HMAC_KEY,
      encryptionKey: ENC_KEY,
    });
    return { repository, caseId: fixture.caseId };
  }

  const successTransport: WhatsappTransport = async () => ({
    status: 200,
    bodyJson: { messages: [{ id: "wamid.concurrent1" }] },
  });

  it("lets exactly one concurrent sender through from independent repositories", async () => {
    const { repository, caseId } = await seedWaitingCase();
    const second = new DemoRepository(database!.db);
    let transportCalls = 0;
    const transport: WhatsappTransport = async (request) => {
      transportCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return successTransport(request);
    };
    const [first, other] = await Promise.all([
      requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), transport }),
      requestCorrectionViaWhatsapp({ repository: second, caseId, env: baseEnv(), transport }),
    ]);
    expect(transportCalls).toBe(1);
    expect([first.outcome, other.outcome].sort()).toEqual(["IN_PROGRESS", "SENT"]);
    const rows = await database!.db.select().from(whatsappMessages).where(eq(whatsappMessages.caseId, caseId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("SENT");
    expect(rows[0]!.attemptCount).toBe(1);
  });

  it("parks crashed sends as uncertain and resolves them only by explicit authorization", async () => {
    const { repository, caseId } = await seedWaitingCase("test-reliability-token-which-is-long-and-url-safe-3002");
    let transportCalls = 0;
    const crashing: WhatsappTransport = async () => {
      transportCalls += 1;
      throw new Error("connection reset after possible send");
    };
    const crashed = await requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), transport: crashing });
    expect(crashed.outcome).toBe("NEEDS_REVIEW");
    expect(crashed.message.status).toBe("NEEDS_REVIEW");

    const again = await requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), transport: successTransport });
    expect(again.outcome).toBe("NEEDS_REVIEW");
    expect(transportCalls).toBe(1);

    await expect(resolveUncertainSend({ repository, messageId: crashed.message.id, resolution: "CONFIRMED_UNSENT", resolvedBy: "" }))
      .rejects.toThrow();
    const reopened = await resolveUncertainSend({
      repository,
      messageId: crashed.message.id,
      resolution: "CONFIRMED_UNSENT",
      resolvedBy: "test-operator",
    });
    expect(reopened.outcome).toBe("RETRYABLE");
    let successCalls = 0;
    const countingSuccess: WhatsappTransport = async (request) => {
      successCalls += 1;
      return successTransport(request);
    };
    const retried = await requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), transport: countingSuccess });
    expect(retried.outcome).toBe("SENT");
    expect(transportCalls).toBe(1);
    expect(successCalls).toBe(1);
    expect(retried.message.attemptCount).toBe(2);
  });

  it("confirms uncertain sends without touching the provider again", async () => {
    const { repository, caseId } = await seedWaitingCase("test-reliability-token-which-is-long-and-url-safe-3003");
    let transportCalls = 0;
    const crashing: WhatsappTransport = async () => {
      transportCalls += 1;
      throw new Error("timeout");
    };
    const crashed = await requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), transport: crashing });
    const confirmed = await resolveUncertainSend({
      repository,
      messageId: crashed.message.id,
      resolution: "CONFIRMED_SENT",
      providerMessageId: "wamid.manually-confirmed",
      resolvedBy: "test-operator",
    });
    expect(confirmed.outcome).toBe("SENT");
    expect(confirmed.message.providerMessageId).toBe("wamid.manually-confirmed");
    expect(transportCalls).toBe(1);
  });

  it("bounds retries for definitively unsent attempts", async () => {
    const { repository, caseId } = await seedWaitingCase("test-reliability-token-which-is-long-and-url-safe-3004");
    const env = baseEnv({ WHATSAPP_MAX_SEND_ATTEMPTS: "1" });
    const failing: WhatsappTransport = async () => ({
      status: 503,
      bodyJson: { error: { code: 131000, message: "busy" } },
    });
    const failed = await requestCorrectionViaWhatsapp({ repository, caseId, env, transport: failing });
    expect(failed.outcome).toBe("RETRYABLE");
    const capped = await retryWhatsappSend({ repository, messageId: failed.message.id, env, transport: successTransport });
    expect(capped.outcome).toBe("MAX_ATTEMPTS_EXHAUSTED");
    const rows = await database!.db.select().from(whatsappMessages).where(eq(whatsappMessages.caseId, caseId));
    expect(rows).toHaveLength(1);
  });

  it("applies out-of-order statuses monotonically and dedupes repeats", async () => {
    const { repository, caseId } = await seedWaitingCase("test-reliability-token-which-is-long-and-url-safe-3005");
    const sent = await requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), transport: successTransport });
    expect(sent.outcome).toBe("SENT");
    const post = async (status: string, timestamp: string) => {
      const raw = statusEnvelope({ wamid: "wamid.concurrent1", status, timestamp });
      return processWhatsappWebhook({ repository, rawBody: Buffer.from(raw), signature: sign(raw), env: baseEnv() });
    };
    expect((await post("read", "1760290010")).processed[0]!.result).toBe("STATUS_RECORDED");
    expect((await post("delivered", "1760290005")).processed[0]!.result).toBe("STATUS_RECORDED");
    const [afterReorder] = await database!.db.select().from(whatsappMessages).where(eq(whatsappMessages.caseId, caseId));
    expect(afterReorder!.status).toBe("READ");

    expect((await post("read", "1760290010")).processed[0]!.result).toBe("DUPLICATE_ACK");
    expect((await post("failed", "1760290020")).processed[0]!.result).toBe("STATUS_RECORDED");
    const [afterFailure] = await database!.db.select().from(whatsappMessages).where(eq(whatsappMessages.caseId, caseId));
    expect(afterFailure!.status).toBe("READ");
    expect(afterFailure!.attemptCount).toBe(1);

    const unknown = statusEnvelope({ wamid: "wamid.unknown7", status: "delivered" });
    expect((await processWhatsappWebhook({ repository, rawBody: Buffer.from(unknown), signature: sign(unknown), env: baseEnv() })).processed[0]!.result)
      .toBe("STATUS_RECORDED");
  });

  it("reconciles manually confirmed sends when late provider statuses arrive", async () => {
    const { repository, caseId } = await seedWaitingCase("test-reliability-token-which-is-long-and-url-safe-3006");
    const crashing: WhatsappTransport = async () => {
      throw new Error("timeout");
    };
    const crashed = await requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), transport: crashing });
    expect(crashed.message.status).toBe("NEEDS_REVIEW");
    const confirmed = await resolveUncertainSend({
      repository,
      messageId: crashed.message.id,
      resolution: "CONFIRMED_SENT",
      providerMessageId: "wamid.reconciled1",
      resolvedBy: "test-operator",
    });
    expect(confirmed.message.status).toBe("SENT");
    const raw = statusEnvelope({ wamid: "wamid.reconciled1", status: "delivered" });
    const result = await processWhatsappWebhook({ repository, rawBody: Buffer.from(raw), signature: sign(raw), env: baseEnv() });
    expect(result.processed[0]!.result).toBe("STATUS_RECORDED");
    const [reconciled] = await database!.db.select().from(whatsappMessages).where(eq(whatsappMessages.caseId, caseId));
    expect(reconciled!.status).toBe("DELIVERED");
  });

  it("leaves the worker liaison step untouched while disabled", async () => {
    const { repository, caseId } = await seedWaitingCase("test-reliability-token-which-is-long-and-url-safe-3009");
    const rows = await database!.db.select().from(whatsappMessages).where(eq(whatsappMessages.caseId, caseId));
    expect(rows).toHaveLength(0);
    expect((await repository.getCaseSnapshot(caseId))?.status).toBe("WAITING_CUSTOMER");
  });

  it("sends through the worker liaison step only when enabled and contactable", async () => {
    database = await createTestDb();
    const repository = new DemoRepository(database.db);
    const fixture = await seedDemoScenario(repository, {
      correctionToken: "test-reliability-token-which-is-long-and-url-safe-3007",
    });
    const waiting = await repository.getCaseSnapshot(fixture.caseId);
    expect(waiting?.status).toBe("NEW");
    await provisionCustomerContact(repository, {
      orderId: fixture.orderId,
      phoneE164: CUSTOMER_PHONE,
      consented: true,
      provenance: "test-operator-console",
      provisionedBy: "test-operator",
      hmacKey: HMAC_KEY,
      encryptionKey: ENC_KEY,
    });

    await repository.startCase(fixture.caseId);
    const realFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ messages: [{ id: "wamid.worker1" }] }), { status: 200 });
    }) as typeof fetch;
    process.env.WHATSAPP_ENABLED = "true";
    process.env.WHATSAPP_PHONE_NUMBER_ID = BUSINESS_ID;
    process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token";
    process.env.WHATSAPP_TEMPLATE_NAME = "nentra_correction_request";
    process.env.WHATSAPP_TEMPLATE_LANGUAGE = "en";
    process.env.WHATSAPP_CONTACT_HMAC_KEY = HMAC_KEY;
    process.env.WHATSAPP_CONTACT_ENCRYPTION_KEY = ENC_KEY;
    try {
      for (let i = 0; i < 20; i += 1) {
        const snapshot = await repository.getCaseSnapshot(fixture.caseId);
        if (snapshot?.status === "WAITING_CUSTOMER") break;
        await runWorkerOnce(repository, { workerId: "test-reliability-worker" });
      }
      expect((await repository.getCaseSnapshot(fixture.caseId))?.status).toBe("WAITING_CUSTOMER");
      expect(fetchCalls).toBe(1);
      const [sent] = await database.db.select().from(whatsappMessages).where(eq(whatsappMessages.caseId, fixture.caseId));
      expect(sent!.status).toBe("SENT");
      expect(sent!.providerMessageId).toBe("wamid.worker1");
    } finally {
      delete process.env.WHATSAPP_ENABLED;
      delete process.env.WHATSAPP_PHONE_NUMBER_ID;
      delete process.env.WHATSAPP_ACCESS_TOKEN;
      delete process.env.WHATSAPP_TEMPLATE_NAME;
      delete process.env.WHATSAPP_TEMPLATE_LANGUAGE;
      delete process.env.WHATSAPP_CONTACT_HMAC_KEY;
      delete process.env.WHATSAPP_CONTACT_ENCRYPTION_KEY;
      globalThis.fetch = realFetch;
    }
  });

  it("keeps raw customer data out of reliability events", async () => {
    const { repository, caseId } = await seedWaitingCase("test-reliability-token-which-is-long-and-url-safe-3008");
    const crashing: WhatsappTransport = async () => {
      throw new Error("timeout");
    };
    await requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), transport: crashing });
    const raw = statusEnvelope({ wamid: "wamid.concurrent1", status: "failed" });
    await processWhatsappWebhook({ repository, rawBody: Buffer.from(raw), signature: sign(raw), env: baseEnv() });
    const events = await database!.db.select().from(caseEvents).where(eq(caseEvents.caseId, caseId));
    const dump = JSON.stringify(events);
    expect(dump).not.toContain("2348012345678");
    expect(dump).not.toContain("test-access-token");
    expect(dump).not.toContain(APP_SECRET);
  });
});
