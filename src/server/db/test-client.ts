import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";

import { schema } from "./schema";

export type TestDatabase = PgliteDatabase<typeof schema>;

export interface TestDbInstance {
  client: PGlite;
  db: TestDatabase;
  close: () => Promise<void>;
}

/** Create a fresh in-memory PostgreSQL-compatible database for tests. */
export async function createTestDb(options: { migrate?: boolean } = {}): Promise<TestDbInstance> {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  if (options.migrate !== false) {
    await migrate(db, {
      migrationsFolder: resolve(process.cwd(), "migrations"),
    });
  }

  return {
    client,
    db,
    close: () => client.close(),
  };
}
