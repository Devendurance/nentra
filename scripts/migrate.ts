import "dotenv/config";

import { closeDb, getDb } from "@/server/db/client";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { resolve } from "node:path";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to apply migrations.");
  try {
    await migrate(getDb(), { migrationsFolder: resolve(process.cwd(), "migrations") });
    process.stdout.write("Database migrations applied.\n");
  } finally {
    await closeDb();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/migrate.ts")) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Migration failed"}\n`);
    process.exitCode = 1;
  });
}
