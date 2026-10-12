# Backend setup and operation

Nentra separates the App Router API from a database-backed worker. API mutations validate and enqueue work. The worker claims one persisted step at a time, runs its bounded operation, saves the result and event, then schedules the next step. Browser refreshes and disconnects do not run or finish the workflow.

## Requirements and environment

Use Node.js 22 or later, npm, and PostgreSQL 14 or later. Copy `.env.example` to `.env` and set:

| Variable | Required | Purpose |
|---|---:|---|
| `DATABASE_URL` | Yes | PostgreSQL connection for web, worker, migration and seed processes. |
| `NENTRA_DEMO_OPERATOR_SECRET` | For mutations | Server-only secret accepted as `x-nentra-operator-secret` or a Bearer token. Use a long random value. |
| `NENTRA_MODE` | No | `DEMO_SANDBOX` is the supported mode. |
| `NENTRA_PUBLIC_ORIGIN` | No | Public app origin for deployment configuration. |
| `NENTRA_WORKER_ID` | No | Stable worker label used for persisted job leases. |
| `NENTRA_WORKER_POLL_MS` | No | Idle poll delay. Defaults to 500 ms. |
| `NENTRA_JOB_LEASE_MS` | No | Job lease duration. Defaults to 30 seconds. |
| `NENTRA_RECOVERY_MODE` | No | `BASELINE` reproduces B0 by escalating after the persisted preferred-quote 503. `RECOVERED` (default) runs fallback, approval, booking and verification for B1. Set the same value on every worker for the duration of a run. |
| `GROQ_API_KEY` | No | Server-side Groq credential for Investigator and Fulfillment. With this key, the default model and official endpoint are used when their overrides are empty. |
| `GROQ_MODEL` | No | Optional Groq model override. Defaults to `openai/gpt-oss-20b`, which is configured for strict JSON Schema output. |
| `GROQ_BASE_URL` | No | Optional Groq-compatible endpoint override. Defaults to `https://api.groq.com/openai/v1`. |
| `GROQ_TIMEOUT_MS` | No | Bounded Groq request timeout in milliseconds. Defaults to 10,000 and is capped at 120,000. |
| `DEEPSEEK_API_KEY` | No | Server-side DeepSeek credential for Recovery. With this key, the default model and official endpoint are used when their overrides are empty. |
| `DEEPSEEK_MODEL` | No | Optional DeepSeek model override. Defaults to `deepseek-flash`, using JSON Object response mode plus an explicit schema instruction. |
| `DEEPSEEK_BASE_URL` | No | Optional DeepSeek-compatible endpoint override. Defaults to `https://api.deepseek.com`. |
| `DEEPSEEK_TIMEOUT_MS` | No | Bounded DeepSeek request timeout in milliseconds. Defaults to 20,000 and is capped at 120,000. |
| `OPENAI_API_KEY` | No | Backward-compatible server-side OpenAI-compatible fallback credential for any specialist role without its routed provider key. |
| `OPENAI_MODEL` | No | Model for the compatibility fallback. Both model and key are required to use it. |
| `OPENAI_BASE_URL` | No | Optional OpenAI-compatible fallback API base URL. |
| `OPENAI_TIMEOUT_MS` | No | Bounded fallback request timeout in milliseconds. Defaults to 8,000 and is capped at 120,000. |
| `NEATLOGS_API_KEY` | No | Optional neatlogs SDK credential. Trace IDs are saved only when the SDK returns a valid ID. |
| `SHIPBUBBLE_API_KEY` | No | Reserved for a separately verified Shipbubble test integration, currently unused. |
| `SHIPBUBBLE_BASE_URL` | No | Reserved for a separately verified Shipbubble test integration, currently unused. |

No `NEXT_PUBLIC_*` variable should contain a database, model, operator, neatlogs or shipping credential. The seeded phone and address are fictional test values.

## Database and processes

```bash
npm ci
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
npm run dev:worker
```

`npm run db:generate` generates a migration after a schema change. `npm run db:migrate` applies committed migrations using `DATABASE_URL`. `npm run db:seed` resets and creates the fictional `NG-2048` case. Its JSON output contains a fresh correction token once. Only its SHA-256 hash is stored. Keep the token in the operator environment for the correction API call.

The worker can run as a separate supervised process with `npm run start:worker`; run the web process with `npm run start` after `npm run build`. `npm run dev:worker` and `npm run start:worker` poll continuously. `npm run demo:run -- <CASE_ID>` drains available jobs from the CLI and prints the latest sanitized snapshot. Run the web app and worker against the same PostgreSQL database.

Tests use an isolated in-memory PGlite database with the generated migration. They do not need `DATABASE_URL` or external service credentials.

## Demo flow

1. The operator starts the seeded case. The start handler stores one run and one ready job and responds without doing workflow work inline.
2. The controller delegates address review to the Investigator. Since the fictional address has no landmark, the Liaison creates a waiting state. The correction form accepts only its scoped token and allowed address fields.
3. A valid correction resumes the same run. Fulfillment calls the persisted sandbox adapter. The one seeded `quote_primary` fault is consumed atomically and the preferred quote call returns a real typed 503 error.
4. In `RECOVERED` mode, Recovery classifies that saved failure and selects the persisted alternative quote. The demo alternative costs NGN 7,200 against the seeded NGN 6,500 ceiling, so the case waits for approval bound to that exact quote and proposal hash.
5. Approval schedules booking work. The worker persists a unique booking intent and idempotency key before the sandbox write. If a prior write has an unknown outcome, it queries by the same key and stops for review when it cannot reconcile the result. It never repeats an ambiguous write blindly.
6. A separate verifier reads the saved sandbox booking back and compares booking identity, order, booked status, courier/service, price and uniqueness. Only a full pass writes a `PASS` evidence receipt and changes the case to `RESOLVED`.

The sandbox adapter creates fictional quotes and booking records in PostgreSQL. This proves application persistence and adapter behavior, not a real courier booking. `RESOLVED` means the sandbox booking passed the independent database readback. It never means the parcel was collected or delivered.

The same seeded fixture and one-shot fault support reproducible baseline and recovered comparisons. Use `NENTRA_RECOVERY_MODE=BASELINE` for B0: after the persisted preferred quote 503, the fulfillment task records failure, the case escalates, and no alternative quote or booking is created. Leave the setting unset or set it to `RECOVERED` for B1, which executes the recovery flow described above. Keep the worker setting unchanged while draining a run.

Investigator and Fulfillment route independently to Groq. Recovery routes independently to DeepSeek. Each provider key can be configured without the other. Groq requests use strict JSON Schema output. DeepSeek requests use JSON Object mode, include the expected JSON schema in the system instruction, and are parsed and validated with Zod before existing domain-policy checks run. Responses are bounded to 512 generated tokens. Provider timeouts default to 10 seconds for Groq and 20 seconds for DeepSeek, and each has an independent model, endpoint and timeout override.

When a routed provider key is absent, a complete `OPENAI_API_KEY` plus `OPENAI_MODEL` configuration remains a backward-compatible fallback for that role. When neither routed nor fallback credentials are available, the three specialist functions use deterministic validated decisions and persist the mode as `deterministic`. Provider-backed tasks persist the provider and model alongside their execution mode. Model output remains advice, and workflow policy validates the quote, approval and booking boundaries. A configured model request that fails is reported as failed, with no silent switch to deterministic behavior. No model or tool trace is claimed when no real neatlogs SDK trace was returned. neatlogs ingestion failure does not change the booking outcome.

## API flow

Public reads return only the fictional demo case and sanitized projections. Mutating operator routes require `x-nentra-operator-secret` or `Authorization: Bearer <secret>`. The customer correction endpoint authorizes its single-use token by stored hash.

| Method and path | Access | Behavior |
|---|---|---|
| `GET /api/cases` | Public | List sanitized fictional case snapshots. |
| `GET /api/cases/{caseId}` | Public | Return one sanitized snapshot or `404`. |
| `GET /api/cases/{caseId}/events?after={seq}` | Public | Return ordered event deltas after a nonnegative sequence cursor. |
| `GET /api/cases/{caseId}/evidence` | Public | Return sanitized verification receipts. |
| `POST /api/cases/{caseId}/start` | Operator | Start or reuse the active run and queue its first step. A new start returns `202`; an idempotent repeat returns `200`. |
| `POST /api/cases/{caseId}/cancel` | Operator | Cancel at a safe boundary. In-flight booking or terminal cases return `409`. |
| `POST /api/cases/{caseId}/approvals/{approvalId}` | Operator | Approve or reject the exact pending quote proposal. Stale versions and reviewed approvals return `409`. |
| `POST /api/customer-corrections/{token}` | Scoped token | Submit only `houseNumber`, `street`, `area`, and/or `landmark`. Invalid fields return `422`; invalid or reused tokens return `403`; a case that is not waiting returns `409`. |
| `POST /api/demo/reset` | Operator | Reset the fictional fixture and return its fresh correction token to this authenticated caller. |

Bodies are strict JSON. A start body may be `{}` or `{ "expectedVersion": 0 }`. A cancellation may contain `reason` and `expectedVersion`. An approval body is `{ "decision": "approve" }` or `{ "decision": "reject", "reason": "..." }`, with optional `expectedVersion`. Reset accepts `{}`. Schema failures return `422`; missing operator credentials return `401`; wrong credentials return `403`; missing cases and scoped records return `404`; state, version or idempotency conflicts return `409`.

Example correction submission:

```bash
curl -X POST "http://localhost:3000/api/customer-corrections/$CORRECTION_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"landmark":"Opposite the fictional market gate"}'
```

For operator calls, pass the secret in the `x-nentra-operator-secret` header. Keep it out of browser code and public logs.

## Credential and artifact limits

The committed environment example has empty Groq, DeepSeek, OpenAI-compatible, neatlogs and Shipbubble credentials. Without a routed provider key or a complete `OPENAI_API_KEY` and `OPENAI_MODEL` fallback, agents run in deterministic mode. Without a valid `NEATLOGS_API_KEY`, there are no external neatlogs traces or trace references. The repository does not claim verified Shipbubble behavior, live courier calls, customer messaging, Entire session captures, cfo.ai exports, or delivery. Those items require their real service credentials and independent artifacts before they can be reported as completed.
