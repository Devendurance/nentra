import "dotenv/config";

import { eq } from "drizzle-orm";

import { closeDb, getDb } from "@/server/db/client";
import { DemoRepository } from "@/server/db/repository";
import { telegramOutboundMessages } from "@/server/db/schema";
import { requestCorrectionViaTelegram } from "@/server/telegram/outbound";

const PRODUCTION_HOST_MARKER = "ep-wispy-meadow-b5lxcnuj";
const STAGING_HOST_MARKER = "ep-floral-sunset-b4qbqg0r";
const ACTIVE_SEND_STATUSES: readonly string[] = ["SENT", "SENDING", "NEEDS_REVIEW"];

async function main(): Promise<void> {
  if (process.argv[3] !== "--confirm") {
    throw new Error("Refusing: pass the case id plus --confirm for an explicit production one-shot send.");
  }
  const url = (process.env.PRODUCTION_DATABASE_URL ?? process.env.DATABASE_URL ?? "").trim();
  if (!url) throw new Error("PRODUCTION_DATABASE_URL is required.");
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("The production database URL is not valid.");
  }
  if (host.includes(STAGING_HOST_MARKER)) throw new Error("Refusing: staging host.");
  if (!host.startsWith(PRODUCTION_HOST_MARKER)) throw new Error("Refusing: not the production host.");
  process.env.DATABASE_URL = url;
  const caseId = (process.argv[2] ?? "").trim();
  if (!caseId) throw new Error("A case id is required.");

  const repository = new DemoRepository(getDb());
  try {
    const snapshot = await repository.getCaseSnapshot(caseId);
    if (!snapshot || snapshot.order.orderNumber !== "NG-2049") {
      throw new Error("Refusing: only the NG-2049 smoke case may be contacted in production.");
    }
    if (snapshot.status !== "WAITING_CUSTOMER" || !snapshot.run) {
      throw new Error("The case is not WAITING_CUSTOMER with an active run.");
    }
    const existing = await repository.db.select().from(telegramOutboundMessages)
      .where(eq(telegramOutboundMessages.caseId, caseId));
    const active = existing.filter((r) => ACTIVE_SEND_STATUSES.includes(r.status));
    if (active.length > 0) throw new Error(`A Telegram send already exists in status ${active[0]!.status}.`);
    const result = await requestCorrectionViaTelegram({
      repository,
      caseId,
      env: { ...process.env, TELEGRAM_ENABLED: "true" },
    });
    process.stdout.write(`${JSON.stringify({
      outcome: result.outcome,
      errorCode: result.errorCode ?? null,
      status: result.message.status,
      messageIdPresent: !!result.message.providerMessageId,
      attemptCount: result.message.attemptCount,
      created: result.created,
    })}\n`);
  } finally {
    await closeDb();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/telegram-prod-send.once.ts")) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Production one-shot send failed"}\n`);
    process.exitCode = 1;
  });
}
