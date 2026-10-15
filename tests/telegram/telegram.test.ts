import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import type { TelegramMessageSender } from "@/integrations/telegram/client";
import {
  bookings,
  cases,
  caseEvents,
  correctionRequests,
  telegramContacts,
  telegramInboundUpdates,
  telegramOutboundMessages,
} from "@/server/db/schema";
import { createTestDb } from "@/server/db/test-client";
import { DemoRepository, type PublicCaseSnapshot } from "@/server/db/repository";
import { createBindingToken } from "@/server/telegram/contacts";
import { processTelegramUpdate } from "@/server/telegram/inbound";
import { requestCorrectionViaTelegram } from "@/server/telegram/outbound";
import { runWorkerOnce } from "@/worker/main";
import { seedDemoScenario } from "../../scripts/seed-demo";

const HMAC_KEY = "test-telegram-hmac-key";
const ENC_KEY = randomBytes(32).toString("hex");
const BOT_TOKEN = "test-telegram-bot-token";
const BOT_USERNAME = "nentra_test_bot";
const WEBHOOK_SECRET = "test-telegram-webhook-secret";
const CUSTOMER_CHAT_ID = 555111222;
const STRANGER_CHAT_ID = 555999000;

function baseEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    TELEGRAM_ENABLED: "true",
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_BOT_USERNAME: BOT_USERNAME,
    TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
    WHATSAPP_CONTACT_HMAC_KEY: HMAC_KEY,
    WHATSAPP_CONTACT_ENCRYPTION_KEY: ENC_KEY,
    ...extra,
  } as unknown as NodeJS.ProcessEnv;
}

function updateBody(updateId: number, text: string | null, chatId = CUSTOMER_CHAT_ID, chatType = "private"): Buffer {
  return Buffer.from(JSON.stringify({
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: 999888777 },
      chat: { id: chatId, type: chatType },
      ...(text === null ? {} : { text }),
    },
  }), "utf8");
}

describe("Telegram customer-messaging channel", () => {
  let database: Awaited<ReturnType<typeof createTestDb>> | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  async function seedWaitingCase(token = "test-telegram-token-which-is-long-and-url-safe-5001") {
    database = await createTestDb();
    const repository = new DemoRepository(database.db);
    const fixture = await seedDemoScenario(repository, { correctionToken: token });
    await repository.startCase(fixture.caseId);
    for (let i = 0; i < 20; i += 1) {
      const snapshot = await repository.getCaseSnapshot(fixture.caseId);
      if (snapshot?.status === "WAITING_CUSTOMER") break;
      await runWorkerOnce(repository, { workerId: "test-telegram-worker" });
    }
    const waiting = await repository.getCaseSnapshot(fixture.caseId);
    expect(waiting?.status).toBe("WAITING_CUSTOMER");
    return { repository, caseId: fixture.caseId, orderId: waiting!.order.id };
  }

  async function linkChat(repository: DemoRepository, orderId: string, chatId = CUSTOMER_CHAT_ID, updateId = 1000) {
    const { token } = await createBindingToken(repository, { orderId, provisionedBy: "test-operator" });
    const result = await processTelegramUpdate({
      repository,
      rawBody: updateBody(updateId, `/start ${token}`, chatId),
      secret: WEBHOOK_SECRET,
      env: baseEnv(),
    });
    expect(result.processed[0]!.result).toBe("LINKED");
  }

  async function drainTo(repository: DemoRepository, caseId: string, done: (snapshot: PublicCaseSnapshot | null) => boolean, cap = 40) {
    for (let i = 0; i < cap; i += 1) {
      const snapshot = await repository.getCaseSnapshot(caseId);
      if (done(snapshot)) return snapshot;
      await runWorkerOnce(repository, { workerId: "test-telegram-worker" });
    }
    return repository.getCaseSnapshot(caseId);
  }

  it("rejects unsigned and forged webhook calls without recording anything", async () => {
    const { repository } = await seedWaitingCase();
    const raw = updateBody(2001, "hello");
    await expect(processTelegramUpdate({ repository, rawBody: raw, secret: null, env: baseEnv() }))
      .rejects.toMatchObject({ status: 401 });
    await expect(processTelegramUpdate({ repository, rawBody: raw, secret: "wrong-secret", env: baseEnv() }))
      .rejects.toMatchObject({ status: 401 });
    await expect(processTelegramUpdate({ repository, rawBody: raw, secret: WEBHOOK_SECRET, env: baseEnv({ TELEGRAM_WEBHOOK_SECRET: "" }) }))
      .rejects.toMatchObject({ status: 500 });
    expect(await database!.db.select().from(telegramInboundUpdates)).toHaveLength(0);
  });

  it("links a chat through a single-use binding token and records /start consent", async () => {
    const { repository, orderId } = await seedWaitingCase("test-telegram-token-which-is-long-and-url-safe-5002");
    const { token } = await createBindingToken(repository, { orderId, provisionedBy: "test-operator" });
    const linked = await processTelegramUpdate({
      repository,
      rawBody: updateBody(2002, `/start ${token}`),
      secret: WEBHOOK_SECRET,
      env: baseEnv(),
    });
    expect(linked.processed[0]!.result).toBe("LINKED");
    const [contact] = await database!.db.select().from(telegramContacts).where(eq(telegramContacts.orderId, orderId));
    expect(contact!.consentStatus).toBe("OPTED_IN");
    expect(contact!.consentProvenance).toBe("telegram-/start");
    expect(contact!.bindingTokenHash).toBeNull();

    const replay = await processTelegramUpdate({
      repository,
      rawBody: updateBody(2003, `/start ${token}`),
      secret: WEBHOOK_SECRET,
      env: baseEnv(),
    });
    expect(replay.processed[0]!.result).toBe("EXPIRED_OR_INVALID_TOKEN");

    const bogus = await processTelegramUpdate({
      repository,
      rawBody: updateBody(2004, "/start not-a-real-token-000"),
      secret: WEBHOOK_SECRET,
      env: baseEnv(),
    });
    expect(bogus.processed[0]!.result).toBe("EXPIRED_OR_INVALID_TOKEN");

    const bare = await processTelegramUpdate({
      repository,
      rawBody: updateBody(2005, "/start"),
      secret: WEBHOOK_SECRET,
      env: baseEnv(),
    });
    expect(bare.processed[0]!.result).toBe("START_WITHOUT_TOKEN");
  });

  it("rejects expired binding tokens", async () => {
    const { repository, orderId } = await seedWaitingCase("test-telegram-token-which-is-long-and-url-safe-5003");
    const { token } = await createBindingToken(repository, { orderId, provisionedBy: "test-operator", ttlMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const result = await processTelegramUpdate({
      repository,
      rawBody: updateBody(2006, `/start ${token}`),
      secret: WEBHOOK_SECRET,
      env: baseEnv(),
    });
    expect(result.processed[0]!.result).toBe("EXPIRED_OR_INVALID_TOKEN");
    const [contact] = await database!.db.select().from(telegramContacts).where(eq(telegramContacts.orderId, orderId));
    expect(contact!.consentStatus).toBe("OPTED_OUT");
  });

  it("rejects group chats, unknown senders and non-text payloads without mutating the order", async () => {
    const { repository, caseId } = await seedWaitingCase("test-telegram-token-which-is-long-and-url-safe-5004");
    const group = await processTelegramUpdate({
      repository,
      rawBody: updateBody(2007, "LANDMARK: Near the park", CUSTOMER_CHAT_ID, "group"),
      secret: WEBHOOK_SECRET,
      env: baseEnv(),
    });
    expect(group.processed[0]!.result).toBe("NON_PRIVATE_CHAT");

    const stranger = await processTelegramUpdate({
      repository,
      rawBody: updateBody(2008, "LANDMARK: Near the park", STRANGER_CHAT_ID),
      secret: WEBHOOK_SECRET,
      env: baseEnv(),
    });
    expect(stranger.processed[0]!.result).toBe("NO_LINKED_CONTACT");
    expect((await repository.getCaseSnapshot(caseId))?.status).toBe("WAITING_CUSTOMER");
    const [request] = await database!.db.select().from(correctionRequests).where(eq(correctionRequests.caseId, caseId));
    expect(request!.status).toBe("PENDING");
  });

  it("sends once with provider acceptance and keeps the second caller on the same claim", async () => {
    const { repository, caseId, orderId } = await seedWaitingCase("test-telegram-token-which-is-long-and-url-safe-5005");
    await linkChat(repository, orderId);
    let calls = 0;
    const sender: TelegramMessageSender = async (input) => {
      calls += 1;
      expect(input.chatId).toBe(String(CUSTOMER_CHAT_ID));
      expect(input.text).toContain("NG-2048");
      expect(input.text).toContain("LANDMARK:");
      return { messageId: 4242 };
    };
    const first = await requestCorrectionViaTelegram({ repository, caseId, env: baseEnv(), sender });
    expect(first.outcome).toBe("SENT");
    expect(first.message.providerMessageId).toBe("4242");
    expect(first.created).toBe(true);
    const second = await requestCorrectionViaTelegram({ repository, caseId, env: baseEnv(), sender });
    expect(second.outcome).toBe("SENT");
    expect(second.created).toBe(false);
    expect(calls).toBe(1);
    const rows = await database!.db.select().from(telegramOutboundMessages).where(eq(telegramOutboundMessages.caseId, caseId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("SENT");
    expect(rows[0]!.attemptCount).toBe(1);
  });

  it("refuses sends without linking, consent or enablement", async () => {
    const { repository, caseId, orderId } = await seedWaitingCase("test-telegram-token-which-is-long-and-url-safe-5006");
    const sender: TelegramMessageSender = async () => ({ messageId: 1 });
    const unlinked = await requestCorrectionViaTelegram({ repository, caseId, env: baseEnv(), sender });
    expect(unlinked.outcome).toBe("CONTACT_UNAVAILABLE");

    await linkChat(repository, orderId, CUSTOMER_CHAT_ID, 2010);
    await database!.db.update(telegramContacts).set({ consentStatus: "OPTED_OUT" })
      .where(eq(telegramContacts.orderId, orderId));
    const withdrawn = await requestCorrectionViaTelegram({ repository, caseId, env: baseEnv(), sender });
    expect(withdrawn.outcome).toBe("CONSENT_WITHDRAWN");

    const disabled = await requestCorrectionViaTelegram({
      repository,
      caseId,
      env: baseEnv({ TELEGRAM_ENABLED: "false" }),
      sender,
    });
    expect(disabled.outcome).toBe("SKIPPED_DISABLED");
    expect(disabled.errorCode).toBe("TELEGRAM_DISABLED");
  });

  it("applies a LANDMARK reply and resumes the same run to one booking, exactly once", async () => {
    const { repository, caseId, orderId } = await seedWaitingCase("test-telegram-token-which-is-long-and-url-safe-5007");
    await linkChat(repository, orderId, CUSTOMER_CHAT_ID, 2011);
    const sender: TelegramMessageSender = async () => ({ messageId: 5151 });
    const sent = await requestCorrectionViaTelegram({ repository, caseId, env: baseEnv(), sender });
    expect(sent.outcome).toBe("SENT");
    const runBefore = (await repository.getCaseSnapshot(caseId))!.run!.id;

    const reply = await processTelegramUpdate({
      repository,
      rawBody: updateBody(2012, "LANDMARK: Behind Ikeja Mall gate"),
      secret: WEBHOOK_SECRET,
      env: baseEnv(),
    });
    expect(reply.processed[0]!.result).toBe("CORRECTION_APPLIED");

    const resumed = await drainTo(repository, caseId, (snapshot) => snapshot?.status === "WAITING_APPROVAL");
    expect(resumed?.status).toBe("WAITING_APPROVAL");
    expect(resumed?.run?.id).toBe(runBefore);
    await repository.decideApproval(caseId, resumed!.pendingApproval!.id, {
      decision: "approve",
      expectedVersion: resumed!.version,
    });
    const resolved = await drainTo(repository, caseId, (snapshot) => snapshot?.status === "RESOLVED");
    expect(resolved?.status).toBe("RESOLVED");
    expect((await database!.db.select().from(bookings).where(eq(bookings.caseId, caseId)))
      .filter((booking) => booking.state === "BOOKED")).toHaveLength(1);

    const dupe = await processTelegramUpdate({
      repository,
      rawBody: updateBody(2012, "LANDMARK: Behind Ikeja Mall gate"),
      secret: WEBHOOK_SECRET,
      env: baseEnv(),
    });
    expect(dupe.processed[0]!.result).toBe("DUPLICATE_ACK");
    const validated = await database!.db.select().from(caseEvents).where(eq(caseEvents.caseId, caseId));
    expect(validated.filter((event) => (event.publicPayload as { resultCode?: string }).resultCode === "TELEGRAM_VALIDATED")).toHaveLength(1);
  });

  it("holds ambiguous replies when two corrections wait on one order", async () => {
    const { repository, caseId, orderId } = await seedWaitingCase("test-telegram-token-which-is-long-and-url-safe-5008");
    await linkChat(repository, orderId, CUSTOMER_CHAT_ID, 2013);
    const [secondCase] = await database!.db.insert(cases).values({ orderId, status: "WAITING_CUSTOMER" }).returning();
    await database!.db.insert(correctionRequests).values({
      caseId: secondCase!.id,
      tokenHash: `test-telegram-ambiguous-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 3600_000),
      status: "PENDING",
    });
    const result = await processTelegramUpdate({
      repository,
      rawBody: updateBody(2014, "LANDMARK: Near the junction"),
      secret: WEBHOOK_SECRET,
      env: baseEnv(),
    });
    expect(result.processed[0]!.result).toBe("AMBIGUOUS_CORRELATION");
    expect((await repository.getCaseSnapshot(caseId))?.status).toBe("WAITING_CUSTOMER");
  });

  it("rejects invalid replies and keeps the correction pending", async () => {
    const { repository, caseId, orderId } = await seedWaitingCase("test-telegram-token-which-is-long-and-url-safe-5009");
    await linkChat(repository, orderId, CUSTOMER_CHAT_ID, 2015);
    const result = await processTelegramUpdate({
      repository,
      rawBody: updateBody(2016, "hello, anybody there?"),
      secret: WEBHOOK_SECRET,
      env: baseEnv(),
    });
    expect(result.processed[0]!.result).toBe("INVALID_FORMAT");
    expect((await repository.getCaseSnapshot(caseId))?.status).toBe("WAITING_CUSTOMER");
  });

  it("keeps private data out of public projections", async () => {
    const { repository, caseId, orderId } = await seedWaitingCase("test-telegram-token-which-is-long-and-url-safe-5010");
    await linkChat(repository, orderId, CUSTOMER_CHAT_ID, 2017);
    const sender: TelegramMessageSender = async () => ({ messageId: 7777 });
    await requestCorrectionViaTelegram({ repository, caseId, env: baseEnv(), sender });
    await processTelegramUpdate({
      repository,
      rawBody: updateBody(2018, "LANDMARK: Opposite the fuel station"),
      secret: WEBHOOK_SECRET,
      env: baseEnv(),
    });
    const snapshot = await repository.getCaseSnapshot(caseId);
    const events = await database!.db.select().from(caseEvents).where(eq(caseEvents.caseId, caseId));
    const dump = JSON.stringify({ snapshot, events });
    for (const secret of [String(CUSTOMER_CHAT_ID), "555111222", BOT_TOKEN, WEBHOOK_SECRET, "Opposite the fuel station"]) {
      expect(dump).not.toContain(secret);
    }
  });
});
