import { createHmac, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import type { WhatsappTransport } from "@/integrations/whatsapp";
import type { TwilioMessageSender } from "@/integrations/whatsapp/twilio";
import { twilioWebhookUrl } from "@/integrations/whatsapp/twilio";
import {
  bookings,
  caseEvents,
  correctionRequests,
  customerContacts,
  whatsappInboundEvents,
  whatsappMessages,
} from "@/server/db/schema";
import { createTestDb } from "@/server/db/test-client";
import { DemoRepository, type PublicCaseSnapshot } from "@/server/db/repository";
import { provisionCustomerContact, contactLookupHash, normalizePhoneE164 } from "@/server/whatsapp/contacts";
import { requestCorrectionViaWhatsapp } from "@/server/whatsapp/outbound";
import { processTwilioIncoming, processTwilioStatus } from "@/server/whatsapp/twilio-inbound";
import { runWorkerOnce } from "@/worker/main";
import { seedDemoScenario } from "../../scripts/seed-demo";

const HMAC_KEY = "test-twilio-hmac-key";
const ENC_KEY = randomBytes(32).toString("hex");
const ACCOUNT_SID = "ACtestaccountsid000000000000000001";
const AUTH_TOKEN = "test-twilio-auth-token";
const SANDBOX_FROM = "whatsapp:+14155238886";
const PUBLIC_BASE = "https://test.example";
const CUSTOMER_PHONE = "+2348012345678";

function baseEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    WHATSAPP_ENABLED: "true",
    WHATSAPP_PROVIDER: "twilio",
    TWILIO_ACCOUNT_SID: ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: AUTH_TOKEN,
    TWILIO_WHATSAPP_FROM: SANDBOX_FROM,
    TWILIO_PUBLIC_BASE_URL: PUBLIC_BASE,
    WHATSAPP_CONTACT_HMAC_KEY: HMAC_KEY,
    WHATSAPP_CONTACT_ENCRYPTION_KEY: ENC_KEY,
    ...extra,
  } as unknown as NodeJS.ProcessEnv;
}

function twilioSign(url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((key) => key + params[key]).join("");
  return createHmac("sha1", AUTH_TOKEN).update(data).digest("base64");
}

function formBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

function incomingParams(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    AccountSid: ACCOUNT_SID,
    From: `whatsapp:${CUSTOMER_PHONE}`,
    To: SANDBOX_FROM,
    Body: "hello",
    MessageSid: "SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    NumMedia: "0",
    ...overrides,
  };
}

describe("Twilio WhatsApp sandbox provider", () => {
  let database: Awaited<ReturnType<typeof createTestDb>> | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  async function seedWaitingCase(token = "test-twilio-token-which-is-long-and-url-safe-4001") {
    database = await createTestDb();
    const repository = new DemoRepository(database.db);
    const fixture = await seedDemoScenario(repository, { correctionToken: token });
    await repository.startCase(fixture.caseId);
    for (let i = 0; i < 20; i += 1) {
      const snapshot = await repository.getCaseSnapshot(fixture.caseId);
      if (snapshot?.status === "WAITING_CUSTOMER") break;
      await runWorkerOnce(repository, { workerId: "test-twilio-worker" });
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

  async function drainTo(repository: DemoRepository, caseId: string, done: (snapshot: PublicCaseSnapshot | null) => boolean, cap = 40) {
    for (let i = 0; i < cap; i += 1) {
      const snapshot = await repository.getCaseSnapshot(caseId);
      if (done(snapshot)) return snapshot;
      await runWorkerOnce(repository, { workerId: "test-twilio-worker" });
    }
    return repository.getCaseSnapshot(caseId);
  }

  async function recordInboundHello(repository: DemoRepository, sid: string, body = "hello"): Promise<void> {
    const url = twilioWebhookUrl({ publicBaseUrl: PUBLIC_BASE }, "/api/whatsapp/twilio/incoming")!;
    const params = incomingParams({ MessageSid: sid, Body: body });
    const result = await processTwilioIncoming({
      repository,
      rawFormBody: formBody(params),
      signature: twilioSign(url, params),
      env: baseEnv(),
    });
    expect(result.acknowledged).toBe(true);
  }

  it("routes to Meta by default and keeps Meta sends working", async () => {
    const { repository, caseId } = await seedWaitingCase();
    const metaEnv = {
      WHATSAPP_ENABLED: "true",
      WHATSAPP_PHONE_NUMBER_ID: "test-phone-number-id",
      WHATSAPP_ACCESS_TOKEN: "test-access-token",
      WHATSAPP_TEMPLATE_NAME: "nentra_correction_request",
      WHATSAPP_TEMPLATE_LANGUAGE: "en",
      WHATSAPP_CONTACT_HMAC_KEY: HMAC_KEY,
      WHATSAPP_CONTACT_ENCRYPTION_KEY: ENC_KEY,
    } as unknown as NodeJS.ProcessEnv;
    let metaCalls = 0;
    const transport: WhatsappTransport = async () => {
      metaCalls += 1;
      return { status: 200, bodyJson: { messages: [{ id: "wamid.meta-default" }] } };
    };
    const result = await requestCorrectionViaWhatsapp({ repository, caseId, env: metaEnv, transport });
    expect(result.outcome).toBe("SENT");
    expect(result.message.provider).toBe("meta");
    expect(metaCalls).toBe(1);
  });

  it("sends through the Twilio sandbox with the authorized contact only", async () => {
    const { repository, caseId } = await seedWaitingCase("test-twilio-token-which-is-long-and-url-safe-4002");
    await recordInboundHello(repository, "SMbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    const seen: Array<{ from: string; to: string; body: string }> = [];
    const sender: TwilioMessageSender = async (input) => {
      seen.push(input);
      return { sid: "SMcccccccccccccccccccccccccccccccc" };
    };
    const result = await requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), twilioSender: sender });
    expect(result.outcome).toBe("SENT");
    expect(result.message.provider).toBe("twilio");
    expect(result.message.providerMessageId).toBe("SMcccccccccccccccccccccccccccccccc");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.from).toBe(SANDBOX_FROM);
    expect(seen[0]!.to).toBe(`whatsapp:${CUSTOMER_PHONE}`);
    expect(seen[0]!.body).toContain("NG-2048");
    expect(seen[0]!.body).toContain("LANDMARK:");
    expect(seen[0]!.body).not.toContain(CUSTOMER_PHONE);
  });

  it("refuses Twilio sends without a contact, consent, window, or sandbox evidence", async () => {
    const { repository, caseId } = await seedWaitingCase("test-twilio-token-which-is-long-and-url-safe-4003");
    const waiting = (await repository.getCaseSnapshot(caseId))!;
    await database!.db.delete(customerContacts).where(eq(customerContacts.orderId, waiting.order.id));
    let calls = 0;
    const sender: TwilioMessageSender = async () => {
      calls += 1;
      return { sid: "SMnever" };
    };
    const noContact = await requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), twilioSender: sender });
    expect(noContact.outcome).toBe("CONTACT_UNAVAILABLE");
    expect(calls).toBe(0);
  });

  it("requires sandbox evidence before any Twilio send", async () => {
    const { repository, caseId } = await seedWaitingCase("test-twilio-token-which-is-long-and-url-safe-4004");
    const sender: TwilioMessageSender = async () => ({ sid: "SMnever" });
    const unverified = await requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), twilioSender: sender });
    expect(unverified.outcome).toBe("SKIPPED_DISABLED");
    expect(unverified.errorCode).toBe("WHATSAPP_SANDBOX_UNVERIFIED");
  });

  it("requires an open 24-hour window for Twilio sends", async () => {
    const { repository, caseId } = await seedWaitingCase("test-twilio-token-which-is-long-and-url-safe-4013");
    const sender: TwilioMessageSender = async () => ({ sid: "SMnever" });
    await recordInboundHello(repository, "SMdddddddddddddddddddddddddddddddd");
    await database!.db.update(whatsappInboundEvents)
      .set({ createdAt: new Date(Date.now() - 25 * 3600_000), updatedAt: new Date() })
      .where(eq(whatsappInboundEvents.providerMessageId, "SMdddddddddddddddddddddddddddddddd"));
    const stale = await requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), twilioSender: sender });
    expect(stale.outcome).toBe("SKIPPED_DISABLED");
    expect(stale.errorCode).toBe("WHATSAPP_WINDOW_CLOSED");
  });

  it("rejects unsigned, forged, wrong-account, and wrong-destination webhooks", async () => {
    const { repository } = await seedWaitingCase("test-twilio-token-which-is-long-and-url-safe-4005");
    const url = twilioWebhookUrl({ publicBaseUrl: PUBLIC_BASE }, "/api/whatsapp/twilio/incoming")!;
    const params = incomingParams();
    const raw = formBody(params);
    await expect(processTwilioIncoming({ repository, rawFormBody: raw, signature: null, env: baseEnv() }))
      .rejects.toMatchObject({ status: 401 });
    await expect(processTwilioIncoming({ repository, rawFormBody: `${raw}&extra=1`, signature: twilioSign(url, params), env: baseEnv() }))
      .rejects.toMatchObject({ status: 401 });

    const wrongAccount = incomingParams({ AccountSid: "ACwrong0000000000000000000000000000" });
    await expect(processTwilioIncoming({
      repository,
      rawFormBody: formBody(wrongAccount),
      signature: twilioSign(url, wrongAccount),
      env: baseEnv(),
    })).rejects.toMatchObject({ status: 403 });

    const wrongTo = incomingParams({ To: "whatsapp:+15550001111" });
    await expect(processTwilioIncoming({
      repository,
      rawFormBody: formBody(wrongTo),
      signature: twilioSign(url, wrongTo),
      env: baseEnv(),
    })).rejects.toMatchObject({ status: 403 });

    const stored = await database!.db.select().from(whatsappInboundEvents);
    expect(stored).toHaveLength(0);
  });

  it("rejects unknown senders and non-text payloads without mutating the order", async () => {
    const { repository, caseId } = await seedWaitingCase("test-twilio-token-which-is-long-and-url-safe-4006");
    const url = twilioWebhookUrl({ publicBaseUrl: PUBLIC_BASE }, "/api/whatsapp/twilio/incoming")!;
    const stranger = incomingParams({ From: "whatsapp:+2347000000000", MessageSid: "SMe0000000000000000000000000000001" });
    const first = await processTwilioIncoming({
      repository, rawFormBody: formBody(stranger), signature: twilioSign(url, stranger), env: baseEnv(),
    });
    expect(first.processed[0]!.result).toBe("NO_MATCHING_CONTACT");

    const media = incomingParams({ MessageSid: "SMe0000000000000000000000000000002", NumMedia: "1", Body: "landmark: Near the park" });
    const second = await processTwilioIncoming({
      repository, rawFormBody: formBody(media), signature: twilioSign(url, media), env: baseEnv(),
    });
    expect(second.processed[0]!.result).toBe("UNSUPPORTED_MESSAGE_TYPE");
    expect((await repository.getCaseSnapshot(caseId))?.status).toBe("WAITING_CUSTOMER");
  });

  it("lets exactly one concurrent Twilio sender through", async () => {
    const { repository, caseId } = await seedWaitingCase("test-twilio-token-which-is-long-and-url-safe-4007");
    await recordInboundHello(repository, "SMffffffffffffffffffffffffffffffff");
    const second = new DemoRepository(database!.db);
    let calls = 0;
    const sender: TwilioMessageSender = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { sid: "SM11111111111111111111111111111111" };
    };
    const [first, other] = await Promise.all([
      requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), twilioSender: sender }),
      requestCorrectionViaWhatsapp({ repository: second, caseId, env: baseEnv(), twilioSender: sender }),
    ]);
    expect(calls).toBe(1);
    expect([first.outcome, other.outcome].sort()).toEqual(["IN_PROGRESS", "SENT"]);
    const rows = await database!.db.select().from(whatsappMessages).where(eq(whatsappMessages.caseId, caseId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.provider).toBe("twilio");
  });

  it("applies a valid LANDMARK reply and resumes the same run to one booking", async () => {
    const { repository, caseId } = await seedWaitingCase("test-twilio-token-which-is-long-and-url-safe-4008");
    await recordInboundHello(repository, "SM22222222222222222222222222222222");
    const sender: TwilioMessageSender = async () => ({ sid: "SM33333333333333333333333333333333" });
    const sent = await requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), twilioSender: sender });
    expect(sent.outcome).toBe("SENT");
    const runBefore = (await repository.getCaseSnapshot(caseId))!.run!.id;

    const url = twilioWebhookUrl({ publicBaseUrl: PUBLIC_BASE }, "/api/whatsapp/twilio/incoming")!;
    const reply = incomingParams({ MessageSid: "SM44444444444444444444444444444444", Body: "LANDMARK: Behind Ikeja Mall gate" });
    const result = await processTwilioIncoming({
      repository, rawFormBody: formBody(reply), signature: twilioSign(url, reply), env: baseEnv(),
    });
    expect(result).toEqual({ acknowledged: true, processed: [{ providerMessageId: "SM44444444444444444444444444444444", result: "CORRECTION_APPLIED" }] });

    const resumed = await drainTo(repository, caseId, (snapshot) => snapshot?.status === "WAITING_APPROVAL");
    expect(resumed?.status).toBe("WAITING_APPROVAL");
    expect(resumed?.run?.id).toBe(runBefore);
    const approval = resumed!.pendingApproval!;
    await repository.decideApproval(caseId, approval.id, { decision: "approve", expectedVersion: resumed!.version });
    const resolved = await drainTo(repository, caseId, (snapshot) => snapshot?.status === "RESOLVED");
    expect(resolved?.status).toBe("RESOLVED");
    const caseBookings = await database!.db.select().from(bookings).where(eq(bookings.caseId, caseId));
    expect(caseBookings.filter((booking) => booking.state === "BOOKED")).toHaveLength(1);

    const dupe = await processTwilioIncoming({
      repository, rawFormBody: formBody(reply), signature: twilioSign(url, reply), env: baseEnv(),
    });
    expect(dupe.processed[0]!.result).toBe("DUPLICATE_ACK");
    const eventsAfter = await database!.db.select().from(caseEvents).where(eq(caseEvents.caseId, caseId));
    expect(eventsAfter.filter((event) => (event.publicPayload as { resultCode?: string }).resultCode === "WHATSAPP_VALIDATED")).toHaveLength(1);
  });

  it("rejects invalid replies and keeps the correction pending", async () => {
    const { repository, caseId } = await seedWaitingCase("test-twilio-token-which-is-long-and-url-safe-4009");
    const url = twilioWebhookUrl({ publicBaseUrl: PUBLIC_BASE }, "/api/whatsapp/twilio/incoming")!;
    const chatter = incomingParams({ MessageSid: "SM55555555555555555555555555555555", Body: "hello, anybody there?" });
    const result = await processTwilioIncoming({
      repository, rawFormBody: formBody(chatter), signature: twilioSign(url, chatter), env: baseEnv(),
    });
    expect(result.processed[0]!.result).toBe("INVALID_FORMAT");
    expect((await repository.getCaseSnapshot(caseId))?.status).toBe("WAITING_CUSTOMER");
    const [request] = await database!.db.select().from(correctionRequests).where(eq(correctionRequests.caseId, caseId));
    expect(request!.status).toBe("PENDING");
  });

  it("separates acceptance from delivery and orders statuses monotonically", async () => {
    const { repository, caseId } = await seedWaitingCase("test-twilio-token-which-is-long-and-url-safe-4010");
    await recordInboundHello(repository, "SM66666666666666666666666666666666");
    const sender: TwilioMessageSender = async () => ({ sid: "SM77777777777777777777777777777777" });
    await requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), twilioSender: sender });

    const statusUrl = twilioWebhookUrl({ publicBaseUrl: PUBLIC_BASE }, "/api/whatsapp/twilio/status")!;
    const post = async (status: string, sid = "SM77777777777777777777777777777777") => {
      const params = { AccountSid: ACCOUNT_SID, MessageSid: sid, MessageStatus: status };
      return processTwilioStatus({
        repository, rawFormBody: formBody(params), signature: twilioSign(statusUrl, params), env: baseEnv(),
      });
    };
    expect((await post("sent")).processed[0]!.result).toBe("STATUS_RECORDED");
    const [accepted] = await database!.db.select().from(whatsappMessages).where(eq(whatsappMessages.caseId, caseId));
    expect(accepted!.status).toBe("SENT");

    expect((await post("read")).processed[0]!.result).toBe("STATUS_RECORDED");
    expect((await post("delivered")).processed[0]!.result).toBe("STATUS_RECORDED");
    const [ordered] = await database!.db.select().from(whatsappMessages).where(eq(whatsappMessages.caseId, caseId));
    expect(ordered!.status).toBe("READ");

    expect((await post("sent")).processed[0]!.result).toBe("DUPLICATE_ACK");
    expect((await post("failed")).processed[0]!.result).toBe("STATUS_RECORDED");
    const [kept] = await database!.db.select().from(whatsappMessages).where(eq(whatsappMessages.caseId, caseId));
    expect(kept!.status).toBe("READ");
    expect(kept!.attemptCount).toBe(1);

    const unknown = await post("delivered", "SM99999999999999999999999999999999");
    expect(unknown.processed[0]!.result).toBe("STATUS_RECORDED");

    const bogusParams = { AccountSid: ACCOUNT_SID, MessageSid: "SM77777777777777777777777777777777", MessageStatus: "flying" };
    const bogus = await processTwilioStatus({
      repository, rawFormBody: formBody(bogusParams), signature: twilioSign(statusUrl, bogusParams), env: baseEnv(),
    });
    expect(bogus.processed[0]!.result).toBe("STATUS_IGNORED");
  });

  it("keeps provider namespaces separate", async () => {
    const { repository, caseId } = await seedWaitingCase("test-twilio-token-which-is-long-and-url-safe-4011");
    const metaEnv = {
      WHATSAPP_ENABLED: "true",
      WHATSAPP_PHONE_NUMBER_ID: "test-phone-number-id",
      WHATSAPP_ACCESS_TOKEN: "test-access-token",
      WHATSAPP_TEMPLATE_NAME: "nentra_correction_request",
      WHATSAPP_TEMPLATE_LANGUAGE: "en",
      WHATSAPP_CONTACT_HMAC_KEY: HMAC_KEY,
      WHATSAPP_CONTACT_ENCRYPTION_KEY: ENC_KEY,
    } as unknown as NodeJS.ProcessEnv;
    const transport: WhatsappTransport = async () => ({
      status: 200, bodyJson: { messages: [{ id: "wamid.shared-id-1" }] },
    });
    await requestCorrectionViaWhatsapp({ repository, caseId, env: metaEnv, transport });

    const found = await repository.getWhatsappMessageByProviderSid("twilio", "wamid.shared-id-1");
    expect(found).toBeNull();
    const statusUrl = twilioWebhookUrl({ publicBaseUrl: PUBLIC_BASE }, "/api/whatsapp/twilio/status")!;
    const params = { AccountSid: ACCOUNT_SID, MessageSid: "wamid.shared-id-1", MessageStatus: "delivered" };
    const result = await processTwilioStatus({
      repository, rawFormBody: formBody(params), signature: twilioSign(statusUrl, params), env: baseEnv(),
    });
    expect(result.processed[0]!.result).toBe("STATUS_RECORDED");
    const [metaRow] = await database!.db.select().from(whatsappMessages).where(eq(whatsappMessages.caseId, caseId));
    expect(metaRow!.status).toBe("SENT");
    expect(metaRow!.provider).toBe("meta");
  });

  it("keeps private data out of public projections", async () => {
    const { repository, caseId } = await seedWaitingCase("test-twilio-token-which-is-long-and-url-safe-4012");
    await recordInboundHello(repository, "SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1");
    const sender: TwilioMessageSender = async () => ({ sid: "SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2" });
    await requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), twilioSender: sender });
    const url = twilioWebhookUrl({ publicBaseUrl: PUBLIC_BASE }, "/api/whatsapp/twilio/incoming")!;
    const reply = incomingParams({ MessageSid: "SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3", Body: "LANDMARK: Opposite the fuel station" });
    await processTwilioIncoming({
      repository, rawFormBody: formBody(reply), signature: twilioSign(url, reply), env: baseEnv(),
    });
    const snapshot = await repository.getCaseSnapshot(caseId);
    const events = await database!.db.select().from(caseEvents).where(eq(caseEvents.caseId, caseId));
    const dump = JSON.stringify({ snapshot, events });
    for (const secret of [CUSTOMER_PHONE, "2348012345678", AUTH_TOKEN, ACCOUNT_SID, "Opposite the fuel station"]) {
      expect(dump).not.toContain(secret);
    }
    expect(dump).not.toContain("14155238886");
  });

  it("unblocks a skipped send once the customer window opens", async () => {
    const { repository, caseId } = await seedWaitingCase("test-twilio-token-which-is-long-and-url-safe-4014");
    let calls = 0;
    const sender: TwilioMessageSender = async () => {
      calls += 1;
      return { sid: "SMb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0" };
    };
    const skipped = await requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), twilioSender: sender });
    expect(skipped.outcome).toBe("SKIPPED_DISABLED");
    expect(skipped.errorCode).toBe("WHATSAPP_SANDBOX_UNVERIFIED");
    expect(calls).toBe(0);

    await recordInboundHello(repository, "SMc1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1");
    const sent = await requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), twilioSender: sender });
    expect(sent.outcome).toBe("SENT");
    expect(sent.message.providerMessageId).toBe("SMb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0");
    expect(calls).toBe(1);
    const rows = await database!.db.select().from(whatsappMessages).where(eq(whatsappMessages.caseId, caseId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("SENT");
    expect((await repository.getCaseSnapshot(caseId))?.status).toBe("WAITING_CUSTOMER");
  });

  it("ignores Meta inbound when proving the Twilio window", async () => {
    const { repository, caseId } = await seedWaitingCase("test-twilio-token-which-is-long-and-url-safe-4015");
    const senderE164 = normalizePhoneE164(CUSTOMER_PHONE)!;
    await repository.recordInboundEvent({
      providerMessageId: "wamid.meta-window-evidence-1",
      kind: "MESSAGE",
      senderLookupHash: contactLookupHash(senderE164, HMAC_KEY),
    });
    const sender: TwilioMessageSender = async () => ({ sid: "SMnever" });
    const unverified = await requestCorrectionViaWhatsapp({ repository, caseId, env: baseEnv(), twilioSender: sender });
    expect(unverified.outcome).toBe("SKIPPED_DISABLED");
    expect(unverified.errorCode).toBe("WHATSAPP_SANDBOX_UNVERIFIED");

    await recordInboundHello(repository, "SMe1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1");
    await database!.db.update(whatsappInboundEvents)
      .set({ createdAt: new Date(Date.now() - 25 * 3600_000), updatedAt: new Date() })
      .where(eq(whatsappInboundEvents.providerMessageId, "SMe1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1"));
    const senderHash = contactLookupHash(senderE164, HMAC_KEY);
    const windowStart = new Date(Date.now() - 24 * 3600_000);
    expect(await repository.hasInboundFromSenderHash(senderHash, "twilio")).toBe(true);
    expect(await repository.hasRecentInboundFromSenderHash(senderHash, windowStart, "twilio")).toBe(false);
  });
});
