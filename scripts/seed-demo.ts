import "dotenv/config";

import { randomBytes } from "node:crypto";

import { DemoRepository } from "@/server/db/repository";
import { closeDb, getDb } from "@/server/db/client";

export async function seedDemoScenario(
  repository: DemoRepository,
  options: { correctionToken?: string; now?: Date } = {},
): Promise<{ caseId: string; orderId: string; merchantId: string; correctionToken: string }> {
  const correctionToken = options.correctionToken ?? randomBytes(32).toString("base64url");
  if (correctionToken.length < 32 || !/^[A-Za-z0-9_-]+$/.test(correctionToken)) {
    throw new TypeError("The demo correction token must be URL safe and at least 32 characters long.");
  }
  return repository.resetAndSeed({ correctionToken, now: options.now });
}

async function main(): Promise<void> {
  const repository = new DemoRepository(getDb());
  try {
    const fixture = await seedDemoScenario(repository);
    process.stdout.write(`${JSON.stringify(fixture, null, 2)}\n`);
  } finally {
    await closeDb();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/seed-demo.ts")) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Demo seed failed"}\n`);
    process.exitCode = 1;
  });
}
