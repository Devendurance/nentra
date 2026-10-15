import "dotenv/config";

import { closeDb, getDb } from "@/server/db/client";
import { DemoRepository } from "@/server/db/repository";
import { resolveTelegramConfig } from "@/integrations/telegram/client";
import { createBindingToken } from "@/server/telegram/contacts";

const STAGING_HOST_MARKER = "ep-floral-sunset-b4qbqg0r";
const PRODUCTION_HOST_MARKER = "ep-wispy-meadow";

async function main(): Promise<void> {
  const dbUrl = (process.env.STAGING_DATABASE_URL ?? process.env.DATABASE_URL ?? "").trim();
  if (!dbUrl) throw new Error("STAGING_DATABASE_URL is required.");
  let host = "";
  try {
    host = new URL(dbUrl).hostname;
  } catch {
    throw new Error("The staging database URL is not valid.");
  }
  if (host.includes(PRODUCTION_HOST_MARKER)) throw new Error("Refusing: production host.");
  if (!host.includes(STAGING_HOST_MARKER)) throw new Error("Refusing: not the staging host.");
  process.env.DATABASE_URL = dbUrl;
  const orderNumber = (process.argv[2] ?? "NG-2048").trim();
  const provisionedBy = (process.env.TELEGRAM_LINK_OPERATOR ?? "staging-operator").trim();

  const repository = new DemoRepository(getDb());
  try {
    const target = (await repository.listCases()).find((c) => c.order.orderNumber === orderNumber);
    if (!target) throw new Error(`Order ${orderNumber} was not found on staging.`);
    const telegram = resolveTelegramConfig({ ...process.env, TELEGRAM_ENABLED: "true" });
    if (!telegram.ok) throw new Error(`Telegram bot is not configured: ${telegram.reason}.`);
    const { token, expiresAt } = await createBindingToken(repository, {
      orderId: target.order.id,
      provisionedBy,
    });
    process.stdout.write(`${JSON.stringify({
      orderNumber,
      caseStatus: target.status,
      deepLink: `https://t.me/${telegram.config.botUsername}?start=${token}`,
      expiresAt: expiresAt.toISOString(),
      note: "Single-use. The token is shown once and never stored in plain text.",
    })}\n`);
  } finally {
    await closeDb();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/telegram-link.ts")) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Telegram link step failed"}\n`);
    process.exitCode = 1;
  });
}
