import "dotenv/config";

import { closeDb, getDb } from "@/server/db/client";
import { DemoRepository } from "@/server/db/repository";
import { resolveTelegramConfig } from "@/integrations/telegram/client";
import { createBindingToken } from "@/server/telegram/contacts";

const PRODUCTION_HOST_MARKER = "ep-wispy-meadow-b5lxcnuj";
const STAGING_HOST_MARKER = "ep-floral-sunset-b4qbqg0r";

function productionDatabaseUrl(): string {
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
  return host;
}

async function main(): Promise<void> {
  if (process.argv[3] !== "--confirm") {
    throw new Error("Refusing: pass the order number plus --confirm for an explicit production link.");
  }
  productionDatabaseUrl();
  const orderNumber = (process.argv[2] ?? "").trim();
  if (orderNumber !== "NG-2049") throw new Error("Refusing: only NG-2049 may be linked in production.");
  const provisionedBy = (process.env.TELEGRAM_LINK_OPERATOR ?? "").trim();
  if (!provisionedBy) throw new Error("TELEGRAM_LINK_OPERATOR is required.");

  const repository = new DemoRepository(getDb());
  try {
    const target = (await repository.listCases()).find((c) => c.order.orderNumber === orderNumber);
    if (!target) throw new Error("NG-2049 was not found in production.");
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

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/telegram-prod-link.ts")) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Production link step failed"}\n`);
    process.exitCode = 1;
  });
}
