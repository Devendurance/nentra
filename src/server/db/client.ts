import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { schema } from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

type DatabaseGlobals = typeof globalThis & {
  __nentraPostgresClient?: ReturnType<typeof postgres>;
  __nentraDatabase?: Database;
};

const globals = globalThis as DatabaseGlobals;

/** Create the shared runtime database connection on first use. */
export function getDb(): Database {
  if (globals.__nentraDatabase) return globals.__nentraDatabase;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to connect to PostgreSQL");
  }

  const client = postgres(connectionString, {
    max: parsePositiveInteger(process.env.DATABASE_POOL_MAX, 10),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });

  globals.__nentraPostgresClient = client;
  globals.__nentraDatabase = drizzle(client, { schema });
  return globals.__nentraDatabase;
}

/** Close the shared connection, primarily for worker shutdown and tests. */
export async function closeDb(): Promise<void> {
  const client = globals.__nentraPostgresClient;
  globals.__nentraDatabase = undefined;
  globals.__nentraPostgresClient = undefined;
  if (client) await client.end({ timeout: 5 });
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
