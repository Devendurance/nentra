import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Generation is offline. This local fallback keeps the config usable before
    // a developer has started PostgreSQL; migrations still use DATABASE_URL.
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/nentra",
  },
  strict: true,
  verbose: true,
});
