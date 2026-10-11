# Nentra — Technical Requirements Document (TRD)

> **Version:** 1.0 — 11 October 2026  
> **Implementation target:** a working, demonstrable neatHack 2026 MVP, not a production-ready Nigerian logistics platform  
> **Product name:** **Nentra** (locked)  
> **Related:** [`PRD.md`](PRD.md) · [`architecture.md`](architecture.md) · [`projectplan.md`](projectplan.md)

## 1. Technical mandate

Deliver one deployable, durable agent workflow that turns a fictional Lagos merchant's **blocked pre-dispatch order** into a **verified shipment booking**, or into an honest waiting/escalation state. The system has to record true events and tool results so the 2.5D floor, neatlogs traces and case evidence all describe the same underlying run.

### Hard constraints

1. Real task execution: controller delegates to **at least two bounded specialist agent executions**, with actual tool calls and persisted task outcomes.
2. A seeded provider tool genuinely raises/returns a failure; recovery handles it with a policy-constrained alternative.
3. Every consequential state change is committed to durable storage; refreshing a browser never completes a fake task.
4. Booking is idempotent. Unknown external write outcomes are reconciled before any retry.
5. The system never calls a verified booking "delivered" or invents customer replies, courier bookings, or measured improvements.
6. **neatlogs**, **Entire**, and **cfo.ai** produce real, independently checkable competition artifacts.
7. The UX must be an agent operations environment with a side status panel, not a chatbot or raw log viewer.
8. Build only code permitted within hackathon dates; public commit history must show work made during the event.

## 2. Recommended stack (decisions for MVP)

| Layer | Locked implementation direction | Reason |
|---|---|---|
| Language | TypeScript, strict mode, Node.js 22+ / 24 preferred | One language across domain, server, workers and UI |
| Web | Next.js App Router + React + Tailwind CSS | Quick polished product + API routes, familiar development model |
| Visuals | React SVG / CSS isometric layers + `motion` | Real 2.5D agent movement without unnecessary 3D/game-engine overhead |
| Backend | Node.js route handlers for API, **separate long-running worker process** | Durable execution independent of browser lifecycle |
| Persistence | PostgreSQL with Drizzle ORM and migrations | Durable cases, task leases, idempotency and event journal |
| Deployment | One always-on Node container (web + worker), or separate web/worker services sharing Postgres | Avoid depending on ephemeral serverless requests for long agent runs |
| LLM | OpenAI-compatible model API (hackathon LiteLLM if available) | Structured reasoning and tool selection; budget monitored |
| Validation | Zod | Type-safe tool inputs, agent decisions and API bodies |
| Observability | `neatlogs` TypeScript SDK | Native workflow/agent/tool spans and real before/after traces |
| Development provenance | Entire CLI with Pi integration | Session-to-commit checkpoints and reviewable development context |
| Business modeling | cfo.ai account and financial plan | Sponsor requirement; **submission artifact**, not an agent runtime dependency |
| Tests | Vitest + simple API/integration tests + Playwright smoke if time | Verify domain invariants before visual polish |
| Deployment database | Hosted Postgres (e.g., Supabase Postgres or Railway Postgres) | No separate Redis or message broker required at MVP scale |

**Do not make a 3D engine, queues-as-a-service, microservices, or graph-agent framework mandatory.** The visual effect can be excellent in 2.5D using layered SVG, CSS transform, and path animations driven by backend events. Avoid third-party libraries that introduce brittle deployment or heavy builds.

### Run-mode boundary

- `DEMO_SANDBOX` **default** — fictional customer/order data; persistent shipping adapter backed by Postgres; one planned transient failure; truthful test outcome.
- `SHIPBUBBLE_TEST` **optional P1** — actual Shipbubble test credentials and API behavior, only if available and verified; must be labeled as provider test environment.
- `LIVE` **disabled for hackathon** — no real shipment purchase or communication without explicit authorization, sufficient validation, and safeguards.

No fake screenshots or static traces may be presented as outputs of real integrations.

## 3. Components and ownership

### Web/UI

- Case inbox; case detail view with live animated floor, progress labels, side event panel and evidence receipt.
- Customer correction portal (`/c/[token]`), demo-only seeded fictional data.
- Merchant approval control for over-ceiling recovery choices.
- Replay view rebuilt from persisted events.
- Read-only fallback when no permission to modify a case.

### API server

- Validates requests and authorization.
- Creates cases, schedules jobs, receives corrected address/approval, serves case/events/evidence.
- Never runs a long multi-step orchestration inside a UI-triggered request handler.

### Durable worker

- Claims runnable jobs/steps using database-backed leases or row locking.
- Executes one bounded step at a time and checkpoints after each meaningful operation.
- Calls controller and specialist agent modules; applies deterministic guardrails and retries.
- Appends atomic events and transitions state; survives process restart.

### Provider adapters

- `OrderAdapter`: read seeded order and payment flag; no production payment verification claim.
- `CustomerCorrectionAdapter`: request/receive customer address completion; no fake WhatsApp send.
- `ShippingAdapter`: `getQuotes`, `bookShipment`, `getBooking`; sandbox implementation required; optional Shipbubble test adapter.
- `Clock`/`FaultPlan`: injectable to make tests repeatable (one-shot scenario fault stored by case/attempt).

### Sponsor interfaces

- neatlogs wraps controller/specialist/tool methods and correlates traces with run/task IDs.
- Entire runs in developer's git/agent workflow, **not** as an invented customer-facing runtime service.
- cfo.ai is used manually (or through official tooling only if available) to create the business plan; exported results linked in `/evidence/`.

## 4. Data contracts

### Primary entities

| Entity | Required fields | Core constraints |
|---|---|---|
| `merchants` | `id`, `name`, `currency`, `max_shipping_ngn`, `mode` | One demo merchant |
| `orders` | `id`, `merchant_id`, `amount_ngn`, `payment_status`, `address_json`, `fulfillment_status` | Seeded fake customer; order amount never changes via LLM |
| `cases` | `id`, `order_id`, `status`, `blocker`, `active_run_id`, `version`, timestamps | At most one active recovery run per case |
| `runs` | `id`, `case_id`, `attempt`, `engine_version`, `status`, timestamps, `trace_ref` | Explicit version for before/after comparison |
| `agent_tasks` | `id`, `run_id`, `role`, `goal`, `status`, `input_json`, `output_json`, `parent_task_id` | Task owners and delegation links persist |
| `case_events` | `id`, `case_id`, `run_id`, `seq`, `type`, `actor`, `task_id`, `public_payload`, `occurred_at` | Unique `(case_id, seq)`; canonical UI history |
| `tool_attempts` | `id`, `task_id`, `tool`, `attempt`, `result_code`, `status`, `latency_ms`, `safe_result_json` | No secret/PII leaks |
| `correction_requests` | `id`, `case_id`, `token_hash`, `expires_at`, `status`, `completed_at` | Scoped token; one-time acceptance |
| `quote_options` | `id`, `case_id`, `provider`, `service`, `amount_ngn`, `eligible`, `expires_at`, `quote_token` | Server-side quote token only |
| `approvals` | `id`, `case_id`, `proposal_hash`, `requested_cost_ngn`, `status`, `reviewed_at` | Approval bound to exact proposal |
| `bookings` | `id`, `case_id`, `idempotency_key`, `provider_booking_id`, `state`, `cost_ngn`, timestamps | Unique `idempotency_key`; at most one active booking |
| `evidence_receipts` | `id`, `case_id`, `booking_id`, `verification_json`, `verified_at`, `result` | Produced by independent verifier |
| `job_leases` / `jobs` | `id`, `case_id`, `step`, `state`, `available_at`, `lease_until`, `attempt` | No concurrent execution for same case |
| `demo_faults` | `id`, `case_id`, `tool`, `remaining_failures`, `error_code` | Atomic decrement across worker restarts |

Use UUID or ULID IDs; event sequence must be server-assigned monotonically per case. Model-generated IDs should never be trusted for primary records.

### Case states

`NEW` → `TRIAGING` → (`WAITING_CUSTOMER` ↔ `TRIAGING`) → `QUOTING` → (`RECOVERING` ↔ `QUOTING`) → `WAITING_APPROVAL` (conditional) → `BOOKING` → `VERIFYING` → `RESOLVED`.

Alternative terminal/paused states: `ESCALATED`, `CANCELLED`; `WAITING_CUSTOMER` and `WAITING_APPROVAL` are explicit **paused**, not failed or completed states.

- State transitions go through a single validated transition function.
- Every state transition and its event append occur in the same DB transaction.
- `RESOLVED` requires verified booking receipt with `result = PASS`.
- Never transition from `CANCELLED` or `RESOLVED` back into booking execution without opening a new authorized case.

### Event envelope (public sanitized shape)

```ts
type CaseEvent = {
  id: string;
  caseId: string;
  runId: string;
  seq: number;
  type:
    | 'CASE_STARTED' | 'PLAN_CREATED' | 'TASK_DELEGATED'
    | 'AGENT_STARTED' | 'AGENT_COMPLETED' | 'TOOL_CALLED'
    | 'TOOL_FAILED' | 'RETRY_SCHEDULED' | 'FALLBACK_SELECTED'
    | 'CUSTOMER_INPUT_REQUIRED' | 'CUSTOMER_INPUT_RECEIVED'
    | 'APPROVAL_REQUIRED' | 'APPROVAL_GRANTED' | 'BOOKING_CREATED'
    | 'VERIFICATION_STARTED' | 'VERIFICATION_PASSED'
    | 'VERIFICATION_FAILED' | 'CASE_ESCALATED' | 'CASE_RESOLVED';
  actor: 'controller' | 'investigator' | 'liaison' | 'fulfillment'
    | 'recovery' | 'verifier' | 'system' | 'customer' | 'merchant';
  taskId?: string;
  payload: {
    title: string;
    summary: string;          // short, user-readable; no chain-of-thought
    station?: string;
    resultCode?: string;
    evidenceRef?: string;
    nextAction?: string;
  };
  occurredAt: string; // ISO 8601, server-issued
};
```

**Client visualization is event-sourced for presentation only; transactional tables remain authoritative for business state.** Do not derive a successful booking only from a UI event.

## 5. Agent runtime contract

### Orchestration strategy

Use an explicit, persisted workflow coordinator rather than letting unrestricted LLM chat decide when to mutate the DB. Each runnable step executes an actual function/agent and returns a typed output. The worker validates outputs and chooses the next legal transition.

Minimum real specialist executions:

1. **Investigator agent:** receives narrow order context, can read order/address status; returns structured blockers and requested fields.
2. **Fulfillment agent:** receives corrected order and shipping policy, calls quotes tool; returns ranked *eligible* options and rationale.
3. **Recovery agent:** receives actual tool failure and allowed policy; chooses bounded retry or eligible fallback, producing a typed recovery plan.

Controller can use LLM for high-level plan/delegation; Customer Liaison can be a templated agent with a narrow message task; Verifier must use deterministic independent reads. The UI can show all six roles **only when those roles have real executions or explicit deterministic steps**.

### Agent output examples

```ts
const InvestigationResult = z.object({
  missingFields: z.array(z.string()),
  blockers: z.array(z.enum(['ADDRESS_INCOMPLETE','QUOTE_UNAVAILABLE','COST_LIMIT','NONE'])),
  nextAction: z.enum(['REQUEST_CUSTOMER_INPUT','EVALUATE_QUOTES','ESCALATE']),
  summary: z.string().max(400),
});

const RecoveryDecision = z.discriminatedUnion('action', [
  z.object({ action: z.literal('RETRY'), maxAdditionalAttempts: z.number().int().min(1).max(2), reason: z.string().max(400) }),
  z.object({ action: z.literal('FALLBACK'), quoteOptionId: z.string(), reason: z.string().max(400) }),
  z.object({ action: z.literal('ESCALATE'), reason: z.string().max(400) }),
]);
```

An LLM proposal is **advice**, not permission. The coordinator checks role allowlists, tool schemas, retry budgets, timeouts, price ceiling, valid quote provenance, and current case version. A malformed output fails closed; it may be retried a bounded number of times, then escalates.

### Recovery classification

- **Transient read errors:** timeout/429/502/503; at most two additional attempts with backoff/jitter then eligible fallback/escalation.
- **Permanent/business errors:** bad address, invalid dimensions, unsupported COD, courier ineligible; change inputs or route to customer/merchant rather than retrying blindly.
- **Ambiguous write outcome:** booking timeout after request was sent; **query provider using idempotency/reference first**; if reconciliation impossible, escalate instead of risking duplicate charges/bookings.
- **Verification mismatch:** never mark resolved; flag evidence mismatch and escalate.
- **Global budgets:** cap tool attempts, total run time, LLM calls and per-case spend; persisted across retries.

### Timeouts and resumability

A single agent/tool operation should have a bounded timeout. Each step persists its inputs/outputs before scheduling the next. Workers claim a lease, heartbeat when necessary, and return abandoned leases to a runnable state after expiry. UI disconnects do not terminate a case. Cancellation only takes effect between safe action boundaries; in-flight bookings require reconciliation.

## 6. Shipping adapter interface

```ts
interface ShippingAdapter {
  mode: 'DEMO_SANDBOX' | 'SHIPBUBBLE_TEST';
  getQuotes(input: QuoteRequest): Promise<QuoteResponse>; // read-like
  bookShipment(input: BookingRequest & { idempotencyKey: string }): Promise<BookingResult>; // write
  getBooking(providerBookingId: string): Promise<BookingReadback>; // independent check
}
```

**Sandbox:** writes to DB and returns simulated quote/booking references. A failure fixture triggers a real rejected tool attempt (not a visual-only flash). Recorded results and simulated references must carry `mode: DEMO_SANDBOX`.

**Optional Shipbubble:** official docs describe `POST /v1/shipping/fetch_rates` and `POST /v1/shipping/labels` using a rate `request_token`, `courier_id`, and `service_code`; provider test key is available through their dashboard. Do **not** assume undocumented idempotency support or a production-ready booking-readback endpoint. Validate sandbox endpoint behavior first; if an authoritative readback API cannot be confirmed, classify as *booking acknowledged, not independently verified* and do not issue a verified receipt.

Reference: https://docs.shipbubble.com/get-started and https://docs.shipbubble.com/api-reference/shipments/create-shipment

### Core invariants

- One active booking per case/order and one idempotency key per intended booking action.
- Quote must match the current corrected destination, parcel details and payment mode.
- Currency must be NGN; money stored as integer kobo **or explicitly named integer NGN**, but never inconsistently mixed. For MVP prefer `amount_ngn` integer for whole-naira fixture; do not use floating point.
- Server controls provider API keys; UI never receives them or original provider auth tokens.
- An unconfirmed payment flag must not be silently interpreted as paid; MVP payment status is explicit seeded test metadata only.

## 7. HTTP API contract (proposed; implement minimally)

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| `GET` | `/api/cases` | Case list + summary | Read-only demo/viewer |
| `GET` | `/api/cases/:caseId` | Case snapshot, state and policy | Read-only demo/viewer |
| `GET` | `/api/cases/:caseId/events?after=NN` | Ordered event deltas for visualization | Read-only demo/viewer |
| `GET` | `/api/cases/:caseId/evidence` | Sanitized receipt and verification | Read-only demo/viewer |
| `POST` | `/api/demo/reset` | Restore fictional data, reset fault schedule | Operator only |
| `POST` | `/api/cases/:caseId/start` | Schedule a run, idempotent | Operator only |
| `POST` | `/api/cases/:caseId/cancel` | Cancel further actions if safe | Operator only |
| `POST` | `/api/cases/:caseId/approvals/:approvalId` | Approve/reject exact proposal | Operator only |
| `GET` | `/c/:token` | Customer correction form | Signed/opaque scoped token |
| `POST` | `/api/customer-corrections/:token` | Update required fields and resume case | Valid unexpired token |

All mutation endpoints return meaningful 409 for stale state, 422 for invalid input, 401/403 for unauthorized actions, and bounded errors. Response metadata carries `caseId`, `state`, `version`, and newly available `after` cursor. UI polls every ~1s for MVP and resumes from last seen sequence; use SSE/WebSockets only if stable and time remains.

### Security in demo mode

- Public viewers: can inspect **fictional** seeded cases and their sanitized events only.
- Operator: authenticated by server-side secret/passcode or session; can reset/start/approve/cancel.
- Customer correction: scoped one-time token, hashed at rest, expires, validates allowed fields.
- Never publish personal data, keys, unredacted prompts or operational addresses from actual customers.
- Rate-limit reset/start/customer mutation endpoints; set CSP and safe CORS defaults.

## 8. neatlogs technical integration

Official TypeScript package: `npm install neatlogs@latest`. `await init({ apiKey, workflowName: 'nentra-rescue' })` in long-lived Node worker initialization; store key in server secrets. Use explicit spans:

```ts
import { init, span, flush } from 'neatlogs';

await init({
  apiKey: process.env.NEATLOGS_API_KEY,
  workflowName: 'nentra-rescue',
  captureLogs: true,
  // Configure a sanitizing mask before real customer data is allowed.
});

const runCase = span({ kind: 'WORKFLOW', name: 'recover_pre_dispatch_order', captureInput: false, captureOutput: false }, async (caseId: string) => {
  return coordinator.run(caseId);
});
const investigate = span({ kind: 'AGENT', name: 'order_investigator', captureInput: false, captureOutput: false }, async (context: SafeContext) => {
  return investigator.run(context);
});
const fetchQuotes = span({ kind: 'TOOL', toolName: 'fetch_shipping_quotes', captureInput: false, captureOutput: false }, async (request: SafeQuoteRequest) => {
  return shippingAdapter.getQuotes(request);
});
```

Instrument actual model calls using `wrapOpenAI(client)` when using compatible `openai` client, or the officially documented processor/hook for chosen agent SDK; do not assume wrapping `fetch` auto-traces LLM calls. Place agent and tools **under a common WORKFLOW root** for each uninterrupted worker segment. A paused case can resume in a new trace segment; correlate these segments by `caseId/runId` rather than inventing a continuous trace. Use `flush()` when worker finishes a run; no per-step flush required. Save trace IDs/links from SDK/dashboard if available; a local DB ID is not a valid invented neatlogs URL.

**PII:** neatlogs SDK captures inputs/outputs by default. Disable where sensitive, use mask/sanitization, and use entirely fictional demo data. A future live deployment requires privacy review.

### Evidence procedure

- Run baseline engine version **B0** on fixed seeded case; capture case failure and trace.
- Make a concrete recovery improvement **B1** (e.g., fallback after transient quote failure); rerun same fixture.
- Record real before/after result, elapsed time, tool attempts, token costs if emitted, and exact Git commits.
- Attach trace links/screenshots, a brief explanation of what changed, and status verification evidence.
- Do not present an artificially triggered demo fault as an organic provider outage; label it controlled fault injection.

Docs: https://docs.neatlogs.com/sdk/typescript

## 9. Entire integration / development provenance

- Initialize a new git repository within the hackathon eligibility period.
- Install official Entire CLI according to OS instructions, verify `entire version`.
- Enable on the **actual project repository**: `entire enable --agent pi` (supported by upstream agent hook documentation); verify `entire status`.
- Use Pi on bounded implementation slices and commit frequently enough to produce useful checkpoints.
- Inspect with `entire checkpoint list` and `entire checkpoint explain <id>` where supported by installed version.
- Push public project Git commits and ensure checkpoint evidence is accessible or provide actual screenshots/output. Do not assume private/local metadata is remotely inspectable.
- Never commit `.env`, credentials, personal data or user chat transcripts into a public checkpoint.

References: https://github.com/entireio/cli and https://github.com/entireio/cli/blob/main/docs/architecture/agent-guide.md

## 10. cfo.ai integration / business proof

Create an actual **Nentra merchant SaaS** model on https://cfo.ai/neathacks. The plan must cover:

- Proposed tiers: illustrative **₦10k / ₦20k / ₦30k per merchant/month** (assumption only).
- Cases resolved per merchant/month and optional overage rate.
- Inference token/call usage per case and retries; provider quote/booking fees (explicitly modeled assumptions).
- Hosting, database, storage/monitoring, customer support, payment processing, messaging costs where used.
- Base/downside/growth scenarios, gross margin, customer acquisition assumptions, cash burn/runway.
- NGN/USD conversion rate **dated and labeled as an assumption** where the tool requires USD.

Export or screenshot the real cfo.ai artifact into `evidence/cfo/`; link to it from README and demo. **No requirement exists to embed cfo.ai into Nentra's runtime UI**; doing so wastes critical build time.

Hackathon requirement: https://neatlogs.com/hackathon

## 11. Nonfunctional requirements

| ID | Requirement | Hackathon target |
|---|---|---|
| NFR-01 | Persistence | A worker restart cannot lose the full case/event/task history |
| NFR-02 | Idempotency | 0 duplicate bookings under tested retried/multi-click scenario |
| NFR-03 | Observability | Every agent/tool attempt correlatable by `caseId/runId/taskId` |
| NFR-04 | Consistency | UI case status agrees with authoritative DB and evidence |
| NFR-05 | Performance | Live panel refreshes within ~2 seconds of persisted event on stable network |
| NFR-06 | Accessibility | Semantic UI, text state labels, keyboard approval, reduced-motion mode |
| NFR-07 | Security | No client-side provider/LLM API keys, scoped demo writes, masked PII |
| NFR-08 | Budget | Configurable per-run token/cost and attempt ceilings |
| NFR-09 | Reliability | All retries bounded; nonrecoverable actions escalate safely |
| NFR-10 | Transparency | Sandbox mode and deliberate fault injection explicitly labeled |

Targets are design goals, not claims of passed verification.

## 12. Testing and verification matrix

### Unit/domain

- Missing address yields `WAITING_CUSTOMER`; no quote call before correction.
- Customer token invalid/expired/reused → denied without mutation.
- One quote 503 triggers recovery with a new typed task; finite retry/fallback.
- Ineligible COD, mismatched currency, over-limit price and stale quote are rejected.
- Over-ceiling booking cannot run without matching proposal approval.
- Repeated booking requests with same case key return one booking.
- An ambiguous booking timeout does not create an unbounded retry.
- Verification mismatch or missing booking leaves case unresolved.
- LLM invalid JSON/unsafe tool proposal fails closed.

### Integration

- Postgres case transaction inserts transition and event atomically.
- Worker restart resumes after a persisted step without duplicating write.
- UI refresh reconstructs stations, agent statuses and event panel from DB.
- Two concurrently triggered `start` requests create only one active run.
- Sandbox fault once is consumed atomically even across concurrent retries.
- One uninterrupted worker segment produces a neatlogs root with nested agent/tool children; paused segments are correlated by `caseId/runId`.

### End-to-end acceptance run

1. Reset the **fictional** demo case.
2. Start a run; see controller/investigator.
3. Submit missing customer information via correction link.
4. See real shipping quote tool failure and recovery delegation.
5. Observe permitted fallback; approve if cost guard triggers.
6. Persist single simulated booking and read it back independently.
7. Show `RESOLVED`, verified evidence receipt and case event replay.
8. Capture neatlogs trace; repeat after a deliberate code improvement for before/after evidence.

## 13. Environment variables (examples; never commit real values)

```dotenv
DATABASE_URL=
OPENAI_BASE_URL=             # official hackathon LiteLLM endpoint if provided
OPENAI_API_KEY=
OPENAI_MODEL=
NEATLOGS_API_KEY=
NENTRA_MODE=DEMO_SANDBOX
NENTRA_DEMO_OPERATOR_SECRET=
NENTRA_PUBLIC_ORIGIN=http://localhost:3000
SHIPBUBBLE_API_KEY=          # optional test-only
SHIPBUBBLE_BASE_URL=         # optional; confirm official provider test config
```

Avoid creating fake credentials or assuming a particular LiteLLM endpoint before verifying the issued account settings.

## 14. Definition of done

P0 is complete **only if** a deployed run is observable on the front end, survives refresh, performs real delegated executions and DB/tool changes, handles a visible actual adapter failure, finishes in an independently verified booking, and supplies the required neatHack evidence without false claims. A beautiful prerecorded animation does not satisfy this TRD.

## 15. External reference links

- neatHack rules: https://neatlogs.com/hackathon
- neatlogs TypeScript SDK: https://docs.neatlogs.com/sdk/typescript
- Entire CLI / Pi hooks: https://github.com/entireio/cli
- Shipbubble test credentials: https://docs.shipbubble.com/get-started
- Shipbubble rates: https://docs.shipbubble.com/api-reference/rates/request-shipping-rates
- Shipbubble labels: https://docs.shipbubble.com/api-reference/shipments/create-shipment
- cfo.ai hackathon entry: https://cfo.ai/neathacks
