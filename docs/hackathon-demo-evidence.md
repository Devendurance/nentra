# Nentra hackathon demo and evidence guide

Date: 12 Oct 2026. Branch: fix/neatlogs-sponsor-evidence, PR #3 open. Main reviewed at 40b84d4, PR #4 merged. This guide describes only what the code and tests prove. Placeholders stay placeholders until a live run produces them.

Fixture used everywhere: fictional order NG-2048, NGN 65,000, Ikeja to Lekki, missing landmark. Merchant ceiling NGN 6,500. Seeded preferred quote NGN 6,000. Seeded alternative NGN 7,200, so B1 needs exact-quote approval. Sources: src/server/db/repository.ts, src/integrations/shipping/index.ts, docs/backend.md.

## What the demo must show

Run B1 end to end on a fresh seed:

1. Operator starts NG-2048. API stores one run and one ready job and returns 202. No workflow work runs inline.
2. Investigator finds missing landmark. Liaison creates WAITING_CUSTOMER. Show the correction request pending.
3. Customer submits landmark through the scoped token endpoint. Only houseNumber, street, area, landmark are accepted.
4. Fulfillment calls the sandbox adapter. The seeded one-shot quote_primary fault is consumed and returns a typed PROVIDER_503. Show TOOL_FAILED with that code.
5. Recovery classifies the saved failure and selects the persisted alternative. Show FALLBACK_SELECTED.
6. Case waits for approval bound to the exact NGN 7,200 quote and proposal hash. Merchant approves. Show APPROVAL_REQUIRED then APPROVAL_GRANTED.
7. Worker persists booking intent and idempotency key before the sandbox write, books once, then reads the booking back independently. Show BOOKING_CREATED.
8. Verifier compares identity, order, BOOKED status, courier and service, price, and uniqueness. On full pass it writes a PASS receipt and CASE_RESOLVED atomically. RESOLVED means verified sandbox booking, not collection or delivery.

Then contrast with B0. Set NENTRA_RECOVERY_MODE=BASELINE on every worker for the run. After the same 503 the case escalates with BASELINE_UNRECOVERED and no fallback or booking.

## B0 and B1 recorded outcomes

Verified 12 Oct 2026 with PGlite and committed migrations through tests/integration/durable-workflow.test.ts. Counts below were rechecked by draining a fresh seed to each terminal state:

- B0: 21 events, status ESCALATED, 0 bookings, last event CASE_ESCALATED. Quote rows include PREFERRED FAILED PROVIDER_503 and no ALTERNATIVE row. Events include TOOL_FAILED PROVIDER_503 and CASE_ESCALATED BASELINE_UNRECOVERED, and no FALLBACK_SELECTED. No recovery task exists.
- B1: 45 events, status RESOLVED, 1 booking, 1 receipt with result PASS and adapterMode DEMO_SANDBOX, last event CASE_RESOLVED. Evidence receipt matches the snapshot. verifyBookingAgain returns PASS.

The floor on main renders the same 45 B1 events. The seal appears only at event 44 PASS and the banner at 45. See agent-state/left-off.md on main and tests/floor/projection.test.ts.

Do not present GMV or courier charges as revenue. Do not call a booking delivered.

## Groq and DeepSeek execution evidence

Routing lives in src/integrations/llm/index.ts and src/agents/index.ts. Docs/backend.md summarizes the same behavior.

- Investigator and Fulfillment prefer Groq. Default model openai/gpt-oss-20b, base https://api.groq.com/openai/v1, strict JSON Schema output, default timeout 10s.
- Recovery prefers DeepSeek. Default model deepseek-flash, base https://api.deepseek.com, JSON Object mode with the schema in the system instruction, default timeout 20s.
- Output bound is 512 tokens per call in code. B1 uses up to 4 structured calls. B0 uses fewer and escalates.
- When a role lacks its routed key, the complete OPENAI_API_KEY plus OPENAI_MODEL fallback applies. When neither routed nor fallback credentials exist, the role runs deterministic validated logic and persists mode deterministic. A configured model request that fails is reported as failed. It never silently falls back to deterministic.
- Provider and model are persisted with the task when a model runs. The public case API does not expose provider or model, so the floor does not show Groq or DeepSeek attribution. See agent-state/memory.md on main.

Tests that prove the wiring without live keys: tests/agents/agent-runtime.test.ts uses a local mock OpenAI-compatible server. It checks Groq strict json_schema plus DeepSeek json_object with schema text, 512 token bound, separate Bearer keys per role, no secret leakage into request bodies, Zod plus policy rejection of invented quotes, and no silent deterministic switch on 503. Without keys the same tests check deterministic outputs.

What is still missing: no live Groq or DeepSeek run is claimed from this environment. A live run needs routed keys and egress plus explicit permission, and has not been executed here.

## neatlogs traces

Integration lives in src/integrations/neatlogs/index.ts. Workflow name is nentra-rescue. Each worker step opens one WORKFLOW span named recover_pre_dispatch_order with sessionId set to runId. AGENT and TOOL spans nest inside with caseId, runId, taskId attributes. A traceRef is saved only when the SDK returns a valid 32 hex trace ID. Without NEATLOGS_API_KEY no trace is claimed.

Handled failure versus success:

- The seeded PREFERRED shipping_quotes 503 is a real thrown failure inside one TOOL span. The SDK marks that span ERROR and rethrows. The coordinator persists FAILED quote and tool attempts, then continues in RECOVERED mode. The enclosing WORKFLOW span of that step still completes.
- Successful agent, booking, and readback spans return a redacted safe summary from the trace callback, so output.value is populated. Exceptions still propagate untouched, so the real 503 keeps its ERROR status and no success implies case failure. Safe keys are allowlisted in code and drop address, phone, landmark, and other sensitive fields.
- By design one session groups all steps of a run by runId. A dashboard that rolls session status up from the worst span can show red at session level after recovery to RESOLVED plus PASS. That roll-up is dashboard behavior outside Nentra control.

Evidence: evidence/neatlogs/tracing-correction.md records the two-part root cause, the fix, and open questions. tests/agents/neatlogs.test.ts covers absent-key no-op, nested AGENT and TOOL plus WORKFLOW kinds and names, redacted booking and agent summaries, throw propagation for TOOL and WORKFLOW failures, OpenAI wrapping only when configured, and identifier sanitizing.

What is still missing: whether the dashboard colors individual successful spans red versus only the session header could not be verified here. No dashboard access and no live post-fix production run. That run needs explicit permission and has not been executed. Do not invent trace IDs or links.

## The /app floor and its limits

Main at 40b84d4 adds a read-only operations floor. Code lives in src/components/floor/ with styles in src/app/app/floor.css. Routes are /app and /app/cases/[caseId].

- /app discovers cases through GET /api/cases. The case view reads snapshot, events after a seq cursor, and evidence receipts.
- projection.ts maps persisted events to stations, handoffs, blocker, recovery, approval, booking, verification, and outcome. No event means no animation.
- Replay is client side with play, pause, restart, step, scrub, and 1x or 2x. A terminal case starts at 0. A live or reduced-motion view follows the latest event. A run seen live does not rewind when it finishes.
- Polling is every 2s only while the case is non-terminal. A seq gap rebuilds from 0. Loading, error, not-found, and reconnecting states show text. Nothing is shown in place of real data.

Limits judges should hear:

- Read-only. The feed makes only GET calls. It cannot start, reset, approve, or mutate a workflow.
- No provider attribution in the UI. The public API does not expose Groq, DeepSeek, or model names.
- No secrets in the client bundle.
- First load can take about 8 to 10s from some networks because each public API read takes seconds to hosted Postgres. This is a transport delay, not invented progress.
- Reduced-motion and small-screen behavior are covered, but visual approval for later phases is still required by project rules.

## What Entire must show

Entire captures Pi-assisted development sessions and checkpoints linked to real commits. CLI here is v0.11.4, repo enabled on branch fix/neatlogs-sponsor-evidence, Pi hooks installed, git hooks installed. Authenticated 12 Oct 2026. Checkpoint list on this branch showed 0 before this task. Snapshots are in evidence/entire/.

For judges: show entire status, entire checkpoint list plus the checkpoint detail for the commit that adds this guide, and the linked commit on PR #3. Do not merge PR #3 in the demo. Do not claim Entire coverage for commits made while Entire had no session state. The prior commit 44e1c13 records that gap honestly.

## What cfo.ai must show

There is no live cfo.ai model yet. evidence/cfo/model-inputs.md is an implementation-ready worksheet only, not the sponsor deliverable.

- Subscription hypothesis NGN 20,000 per merchant per month. Merchant hypotheses 20, 50, 150. Cases hypothesis 80 per merchant per month. All unvalidated.
- Existing paying customers: 0. All revenue figures are projections. Token figures are estimates at 500 input plus 200 output per call across up to 4 calls per recovered case. Provider prices must be verified on vendor pages on build day.
- Hosting lines for EC2, Neon, neatlogs, Entire, cfo.ai, messaging, and incidentals are placeholders until billed. FX uses an unvalidated 1,550 NGN per USD until a dated source is recorded.
- Owner action: a user with cfo.ai access must build the model from the worksheet checklist and return a real link or export.

Describe cfo.ai as business validation and modeling outside runtime, not as a step the order agent performs.

## Do not claim

- No live courier booking, no Shipbubble verification, no customer messaging, no delivery.
- No paying merchants, no collected revenue, no GMV as revenue.
- No production Groq, DeepSeek, Postgres, or neatlogs verification from local mocks or absent keys.
- No invented trace IDs, checkpoint IDs, links, stats, customers, testimonials, or integrations.
- No credentials or personal information in the repo, screenshots, or demo.

## How to re-verify

- npm test covers 102 tests on this branch including 4 tracing regression tests. Main reports 107 with floor tests.
- Focused runs: tests/integration/durable-workflow.test.ts for B0 and B1, tests/agents/agent-runtime.test.ts for routing, tests/agents/neatlogs.test.ts for spans, tests/floor/projection.test.ts on main for replay.
- Read docs/backend.md for API and recovery modes, docs/architecture.md for the floor and proof plan, .env.example for required and optional variables.
- Compare git show origin/main --stat against this branch before citing floor behavior from main.
