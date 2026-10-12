# Nentra

Nentra is a durable demo workflow for a fictional Lagos order blocked by missing delivery details. It stores case state, agent tasks, events, quotes, approval decisions, booking intent and verification evidence in PostgreSQL through Drizzle.

## Run locally

Use Node.js 22 or later and PostgreSQL. Install dependencies, set the server environment, apply migrations, seed the demo, then start the web process and worker in separate terminals:

```bash
npm ci
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
npm run dev:worker
```

The seed command prints the one-time customer correction token to its caller. Keep it for the correction request. See [Backend setup and API flow](docs/backend.md) for environment details, endpoints, worker operation, sandbox behavior, and credential limits.

For a reproducible comparison on the same seeded case, set `NENTRA_RECOVERY_MODE=BASELINE` to capture B0 after the real persisted quote failure, or leave it at `RECOVERED` to run the B1 recovery path.

To execute queued jobs locally without a long-running worker, run:

```bash
npm run demo:run -- <CASE_ID>
```

This drains available persisted steps until the case pauses for customer input or approval, completes, or escalates. It does not claim delivery.

## Development checks

```bash
npm test
npm run type-check
npm run lint
```

`npm run db:generate` creates a migration from a schema change. Apply it with `npm run db:migrate`. Never use `drizzle-kit push`.
