import { createHmac, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import type { WhatsappTransport } from "@/integrations/whatsapp";
import { verifyWebhookChallenge } from "@/integrations/whatsapp/webhook";
import {
  bookings,
  cases,
  caseEvents,
  correctionRequests,
  customerContacts,
  merchants,
  orders,
  runs,
  whatsappInboundEvents,
  whatsappMessages,
} from "@/server/db/schema";
import { createTestDb } from "@/server/db/test-client";
import { DemoRepository, type PublicCaseSnapshot } from "@/server/db/repository";
import { provisionCustomerContact } from "@/server/whatsapp/contacts";
import { processWhatsappWebhook } from "@/server/whatsapp/inbound";
import { requestCorrectionViaWhatsapp } from "@/server/whatsapp/outbound";
import { runWorkerOnce } from "@/worker/main";
import { seedDemoScenario } from "../../scripts/seed-demo";
import { GET } from "@/app/api/whatsapp/webhook/route";

const HMAC_KEY = "test-contact-hmac-key";
const ENC_KEY = randomBytes(32).toString("hex");
const APP_SECRET = "test-whatsapp-app-secret";
const BUSINESS_ID = "test-business-id-1";
const CUSTOMER_PHONE = "+2348012345678";

function baseEnv(): NodeJS.ProcessEnv {
  return {
    WHATSAPP_ENABLED: "true",
    WHATSAPP_PHONE_NUMBER_ID: BUSINESS_ID,
    WHATSAPP_ACCESS_TOKEN: "test-access-token",
    WHATSAPP_TEMPLATE_NAME: "nentra_correction_request",
    WHATSAPP_TEMPLATE_LANGUAGE: "en",
    WHATSAPP_APP_SECRET: APP_SECRET,
    WHATSAPP_CONTACT_HMAC_KEY: HMAC_KEY,
  } as unknown as NodeJS.ProcessEnv;
}

function sign(raw: string): string {
  return `sha256=${createHmac("sha256", APP_SECRET).update(raw).digest("hex")}`;
}

function messageEnvelope(options: {
  from?: string;
  wamid?: string;
  body?: string;
  messageType?: string;
  replyTo?: string;
  businessId?: string;
}): string {
  const { from = "2348012345678", wamid = "wamid.reply1", body = "landmark: Behind the junction", messageType = "text", replyTo, businessId = BUSINESS_ID } = options;
  const message: Record<string, unknown> = {
    from,
    id: wamid,
    timestamp: "1760290000",
    type: messageType,
  };
  if (messageType === "text") message.text = { body };
  if (replyTo) message.context = { id: replyTo };
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{
      id: "test-entry",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "15550001111", phone_number_id: businessId },
          messages: [message],
        },
      }],
    }],
  });
}

function statusEnvelope(options: { wamid: string; status: string; businessId?: string }): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{
      id: "test-entry",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "15550001111", phone_number_id: options.businessId ?? BUSINESS_ID },
          statuses: [{ id: options.wamid, status: options.status, timestamp: "1760290001", recipient_id: "2348012345678" }],
        },
      }],
    }],
  });
}

describe("WhatsApp inbound webhook and correction", () => {
  let database: Awaited<ReturnType<typeof createTestDb>> | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  async function seedWaitingCase(correctionToken = "test-inbound-token-which-is-long-and-url-safe-1001") {
    database = await createTestDb();
    const repository = new DemoRepository(database.db);
    const fixture = await seedDemoScenario(repository, { correctionToken });
    await repository.startCase(fixture.caseId);
    for (let i = 0; i < 20; i += 1) {
      const snapshot = await repository.getCaseSnapshot(fixture.caseId);
      if (snapshot?.status === "WAITING_CUSTOMER") break;
      await runWorkerOnce(repository, { workerId: "test-inbound-worker" });
    }
    const waiting = await repository.getCaseSnapshot(fixture.caseId);
    expect(waiting?.status).toBe("WAITING_CUSTOMER");
    return { repository, caseId: fixture.caseId, orderId: fixture.orderId };
  }

  async function provision(repository: DemoRepository, orderId: string, phone = CUSTOMER_PHONE) {
    return provisionCustomerContact(repository, {
      orderId,
      phoneE164: phone,
      consented: true,
      provenance: "test-operator-console",
      provisionedBy: "test-operator",
      hmacKey: HMAC_KEY,
      encryptionKey: ENC_KEY,
    });
  }

  const sentTransport: WhatsappTransport = async () => ({
    status: 200,
    bodyJson: { messages: [{ id: "wamid.outbound1" }] },
  });

  async function sendOutbound(repository: DemoRepository, caseId: string) {
    return requestCorrectionViaWhatsapp({
      repository,
      caseId,
      toPhoneE164: CUSTOMER_PHONE,
      customerConsented: true,
      env: baseEnv(),
      transport: sentTransport,
    });
  }

  async function drainTo(repository: DemoRepository, caseId: string, done: (snapshot: PublicCaseSnapshot | null) => boolean, cap = 40) {
    for (let i = 0; i < cap; i += 1) {
      const snapshot = await repository.getCaseSnapshot(caseId);
      if (done(snapshot)) return snapshot;
      await runWorkerOnce(repository, { workerId: "test-inbound-worker" });
    }
    return repository.getCaseSnapshot(caseId);
  }

  it("answers the GET challenge only with the correct verify token", async () => {
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "test-verify-token";
    try {
      const ok = await GET(new Request("https://nentra.test/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=challenge-123"));
      expect(ok.status).toBe(200);
      expect(await ok.text()).toBe("challenge-123");

      const bad = await GET(new Request("https://nentra.test/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123"));
      expect(bad.status).toBe(403);
    } finally {
      delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    }
    expect(verifyWebhookChallenge(new URL("https://x.test/?hub.mode=subscribe"), "").ok).toBe(false);
  });

  it("rejects unsigned and forged POST payloads", async () => {
    const { repository } = await seedWaitingCase();
    const raw = messageEnvelope({});
    await expect(processWhatsappWebhook({ repository, rawBody: Buffer.from(raw), signature: null, env: baseEnv() }))
      .rejects.toMatchObject({ status: 401 });
    await expect(processWhatsappWebhook({ repository, rawBody: Buffer.from(raw), signature: "sha256=00", env: baseEnv() }))
      .rejects.toMatchObject({ status: 401 });
    const tampered = `${raw} `;
    await expect(processWhatsappWebhook({ repository, rawBody: Buffer.from(tampered), signature: sign(raw), env: baseEnv() }))
      .rejects.toMatchObject({ status: 401 });
    const stored = await database!.db.select().from(whatsappInboundEvents);
    expect(stored).toHaveLength(0);
  });

  it("applies a valid landmark reply through reply context and resumes the same run", async () => {
    const { repository, caseId } = await seedWaitingCase();
    await provision(repository, (await repository.getCaseSnapshot(caseId))!.order.id);
    const outbound = await sendOutbound(repository, caseId);
    expect(outbound.outcome).toBe("SENT");
    const runBefore = (await repository.getCaseSnapshot(caseId))!.run!.id;

    const raw = messageEnvelope({ replyTo: "wamid.outbound1", body: "landmark: Behind Ikeja Mall gate" });
    const result = await processWhatsappWebhook({ repository, rawBody: Buffer.from(raw), signature: sign(raw), env: baseEnv() });
    expect(result).toEqual({ acknowledged: true, processed: [{ providerMessageId: "wamid.reply1", result: "CORRECTION_APPLIED" }] });

    const [order] = await database!.db.select().from(orders).where(eq(orders.id, (await repository.getCaseSnapshot(caseId))!.order.id));
    expect((order!.addressJson as Record<string, unknown>).landmark).toBe("Behind Ikeja Mall gate");

    const resumed = await drainTo(repository, caseId, (snapshot) => snapshot?.status === "WAITING_APPROVAL");
    expect(resumed?.status).toBe("WAITING_APPROVAL");
    expect(resumed?.run?.id).toBe(runBefore);

    const approval = resumed!.pendingApproval!;
    await repository.decideApproval(caseId, approval.id, { decision: "approve", expectedVersion: resumed!.version });
    const resolved = await drainTo(repository, caseId, (snapshot) => snapshot?.status === "RESOLVED");
    expect(resolved?.status).toBe("RESOLVED");
    expect(resolved?.run?.id).toBe(runBefore);
    const caseBookings = await database!.db.select().from(bookings).where(eq(bookings.caseId, caseId));
    expect(caseBookings.filter((booking) => booking.state === "BOOKED")).toHaveLength(1);
    expect(resolved?.evidence?.result).toBe("PASS");
  });

  it("acknowledges duplicate webhook delivery without duplicate work", async () => {
    const { repository, caseId } = await seedWaitingCase();
    await provision(repository, (await repository.getCaseSnapshot(caseId))!.order.id);
    const raw = messageEnvelope({ wamid: "wamid.dupe1", body: "landmark: Near the bus stop" });
    const first = await processWhatsappWebhook({ repository, rawBody: Buffer.from(raw), signature: sign(raw), env: baseEnv() });
    expect(first.processed[0]!.result).toBe("CORRECTION_APPLIED");
    const eventsBefore = await database!.db.select().from(caseEvents).where(eq(caseEvents.caseId, caseId));

    const second = await processWhatsappWebhook({ repository, rawBody: Buffer.from(raw), signature: sign(raw), env: baseEnv() });
    expect(second).toEqual({ acknowledged: true, processed: [{ providerMessageId: "wamid.dupe1", result: "DUPLICATE_ACK" }] });
    const eventsAfter = await database!.db.select().from(caseEvents).where(eq(caseEvents.caseId, caseId));
    expect(eventsAfter.length).toBe(eventsBefore.length);

    const replay = messageEnvelope({ wamid: "wamid.dupe2", body: "landmark: Another landmark" });
    const third = await processWhatsappWebhook({ repository, rawBody: Buffer.from(replay), signature: sign(replay), env: baseEnv() });
    expect(third.processed[0]!.result).toBe("NO_PENDING_CORRECTION");
  });

  it("rejects wrong senders, wrong business IDs and unparsable replies", async () => {
    const { repository, caseId } = await seedWaitingCase();
    await provision(repository, (await repository.getCaseSnapshot(caseId))!.order.id);

    const wrongSender = messageEnvelope({ wamid: "wamid.wrong1", from: "2347000000000" });
    expect((await processWhatsappWebhook({ repository, rawBody: Buffer.from(wrongSender), signature: sign(wrongSender), env: baseEnv() })).processed[0]!.result)
      .toBe("NO_MATCHING_CONTACT");

    const wrongBusiness = messageEnvelope({ wamid: "wamid.wrong2", businessId: "other-business-id" });
    expect((await processWhatsappWebhook({ repository, rawBody: Buffer.from(wrongBusiness), signature: sign(wrongBusiness), env: baseEnv() })).processed[0]!.result)
      .toBe("BUSINESS_ID_MISMATCH");

    const chatter = messageEnvelope({ wamid: "wamid.wrong3", body: "hello, is anybody there?" });
    expect((await processWhatsappWebhook({ repository, rawBody: Buffer.from(chatter), signature: sign(chatter), env: baseEnv() })).processed[0]!.result)
      .toBe("INVALID_FORMAT");

    const oversized = messageEnvelope({ wamid: "wamid.wrong4", body: `landmark: ${"x".repeat(3000)}` });
    expect((await processWhatsappWebhook({ repository, rawBody: Buffer.from(oversized), signature: sign(oversized), env: baseEnv() })).processed[0]!.result)
      .toBe("OVERSIZED_MESSAGE");

    const tooLong = messageEnvelope({ wamid: "wamid.wrong5", body: `landmark: ${"y".repeat(250)}` });
    expect((await processWhatsappWebhook({ repository, rawBody: Buffer.from(tooLong), signature: sign(tooLong), env: baseEnv() })).processed[0]!.result)
      .toBe("INVALID_LANDMARK");

    const injection = messageEnvelope({ wamid: "wamid.wrong6", body: "landmark: <script>alert(1)</script>\u0001" });
    expect((await processWhatsappWebhook({ repository, rawBody: Buffer.from(injection), signature: sign(injection), env: baseEnv() })).processed[0]!.result)
      .toBe("INVALID_LANDMARK");

    const nonText = messageEnvelope({ wamid: "wamid.wrong7", messageType: "image" });
    expect((await processWhatsappWebhook({ repository, rawBody: Buffer.from(nonText), signature: sign(nonText), env: baseEnv() })).processed[0]!.result)
      .toBe("UNSUPPORTED_MESSAGE_TYPE");

    const waiting = await repository.getCaseSnapshot(caseId);
    expect(waiting?.status).toBe("WAITING_CUSTOMER");
    const [request] = await database!.db.select().from(correctionRequests).where(eq(correctionRequests.caseId, caseId));
    expect(request!.status).toBe("PENDING");
  });

  it("holds ambiguous replies without resuming", async () => {
    const { repository, caseId } = await seedWaitingCase();
    const snapshot = (await repository.getCaseSnapshot(caseId))!;
    await provision(repository, snapshot.order.id, CUSTOMER_PHONE);

    const [merchant] = await database!.db.select().from(merchants).limit(1);
    const [order] = await database!.db.select().from(orders).where(eq(orders.id, snapshot.order.id));
    const [run] = await database!.db.select().from(runs).where(eq(runs.id, snapshot.run!.id));
    const [existingCase] = await database!.db.select().from(cases).where(eq(cases.id, caseId));
    const orderIdB = crypto.randomUUID();
    const runIdB = crypto.randomUUID();
    const caseIdB = crypto.randomUUID();
    await database!.db.insert(orders).values({ ...order!, id: orderIdB, orderNumber: "NG-2049" });
    await database!.db.insert(cases).values({ ...existingCase!, id: caseIdB, orderId: orderIdB, activeRunId: runIdB, lastEventSeq: 0 });
    await database!.db.insert(runs).values({ ...run!, id: runIdB, caseId: caseIdB });
    await database!.db.insert(correctionRequests).values({
      caseId: caseIdB,
      tokenHash: randomBytes(32).toString("hex"),
      expiresAt: new Date(Date.now() + 3600_000),
      status: "PENDING",
    });
    await provision(repository, orderIdB, CUSTOMER_PHONE);
    expect(merchant).toBeDefined();

    const ambiguous = messageEnvelope({ wamid: "wamid.amb1", body: "landmark: Near the market" });
    const result = await processWhatsappWebhook({ repository, rawBody: Buffer.from(ambiguous), signature: sign(ambiguous), env: baseEnv() });
    expect(result.processed[0]!.result).toBe("AMBIGUOUS_CORRELATION");
    expect((await repository.getCaseSnapshot(caseId))?.status).toBe("WAITING_CUSTOMER");
    const [caseB] = await database!.db.select().from(cases).where(eq(cases.id, caseIdB));
    expect(caseB!.status).toBe("WAITING_CUSTOMER");
    const [orderB] = await database!.db.select().from(orders).where(eq(orders.id, orderIdB));
    expect((orderB!.addressJson as Record<string, unknown>).landmark).toBeUndefined();
  });

  it("marks expired requests without resuming the workflow", async () => {
    const { repository, caseId } = await seedWaitingCase("test-inbound-token-which-is-long-and-url-safe-1002");
    await provision(repository, (await repository.getCaseSnapshot(caseId))!.order.id);
    await database!.db.update(correctionRequests)
      .set({ expiresAt: new Date(Date.now() - 1000), updatedAt: new Date() })
      .where(and(eq(correctionRequests.caseId, caseId), eq(correctionRequests.status, "PENDING")));

    const raw = messageEnvelope({ wamid: "wamid.exp1", body: "landmark: Behind the depot" });
    const result = await processWhatsappWebhook({ repository, rawBody: Buffer.from(raw), signature: sign(raw), env: baseEnv() });
    expect(result.processed[0]!.result).toBe("CORRECTION_EXPIRED");
    const [request] = await database!.db.select().from(correctionRequests).where(eq(correctionRequests.caseId, caseId));
    expect(request!.status).toBe("EXPIRED");
    expect((await repository.getCaseSnapshot(caseId))?.status).toBe("WAITING_CUSTOMER");
  });

  it("records provider statuses without inventing delivery outcomes", async () => {
    const { repository, caseId } = await seedWaitingCase();
    await provision(repository, (await repository.getCaseSnapshot(caseId))!.order.id);
    await sendOutbound(repository, caseId);

    const delivered = statusEnvelope({ wamid: "wamid.outbound1", status: "delivered" });
    expect((await processWhatsappWebhook({ repository, rawBody: Buffer.from(delivered), signature: sign(delivered), env: baseEnv() })).processed[0]!.result)
      .toBe("STATUS_RECORDED");
    const [sent] = await database!.db.select().from(whatsappMessages).where(eq(whatsappMessages.caseId, caseId));
    expect(sent!.status).toBe("DELIVERED");

    const unknown = statusEnvelope({ wamid: "wamid.unknown9", status: "read" });
    expect((await processWhatsappWebhook({ repository, rawBody: Buffer.from(unknown), signature: sign(unknown), env: baseEnv() })).processed[0]!.result)
      .toBe("STATUS_RECORDED");

    const bogus = statusEnvelope({ wamid: "wamid.never-sent-9", status: "flying" });
    expect((await processWhatsappWebhook({ repository, rawBody: Buffer.from(bogus), signature: sign(bogus), env: baseEnv() })).processed[0]!.result)
      .toBe("STATUS_IGNORED");
  });

  it("keeps phone numbers and secrets out of public projections", async () => {
    const { repository, caseId } = await seedWaitingCase();
    await provision(repository, (await repository.getCaseSnapshot(caseId))!.order.id);
    await sendOutbound(repository, caseId);
    const raw = messageEnvelope({ replyTo: "wamid.outbound1", body: "landmark: Opposite the fuel station" });
    await processWhatsappWebhook({ repository, rawBody: Buffer.from(raw), signature: sign(raw), env: baseEnv() });

    const snapshot = await repository.getCaseSnapshot(caseId);
    const events = await database!.db.select().from(caseEvents).where(eq(caseEvents.caseId, caseId));
    const contacts = await database!.db.select().from(customerContacts);
    expect(contacts).toHaveLength(1);
    const dump = JSON.stringify({ snapshot, events });
    for (const secret of [CUSTOMER_PHONE, "2348012345678", APP_SECRET, "test-access-token", "challenge-123"]) {
      expect(dump).not.toContain(secret);
    }
    expect(dump).not.toContain("Opposite the fuel station");
    expect(contacts[0]!.phoneCiphertext).not.toContain(CUSTOMER_PHONE);
  });
});
