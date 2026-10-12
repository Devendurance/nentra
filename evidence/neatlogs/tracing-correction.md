# Neatlogs ERROR-status investigation — tracing correction (12 Oct 2026)

Scope: `src/integrations/neatlogs/index.ts`, `src/worker/main.ts`,
`src/worker/coordinator.ts`, `src/agents/index.ts`, `tests/agents/neatlogs.test.ts`,
installed `neatlogs@1.1.28` SDK source (`node_modules/neatlogs/dist/index.mjs`).

## Verified root cause (two parts)

### 1. Confirmed instrumentation bug: trace callbacks returned `undefined`

All three wrappers (`withAgent`, `withTool`, `withWorkflow`) ran the operation,
stored the result for the caller, then returned `undefined` from the
`sdk.trace()` callback.

Real SDK behavior (read from installed source, `trace()` spanCallback):

- Success path: only when the callback return is not `undefined`/`null` does
  the SDK set `output.value` on the span. Returning `undefined` leaves
  successful spans with no recorded output — "missing or unclear output
  without an actual failure" (category 4).
- Failure path: only when the callback throws does the SDK set status ERROR
  and record the exception, then rethrow. Returning `undefined` does NOT by
  itself set ERROR status.

Effect: every successful agent call, booking write, and readback span was
exported with empty output, while the intentional `shipping_quotes` 503
correctly threw through its TOOL span and was marked ERROR. The caller always
received the correct result; only the exported span data was degraded.

### 2. Session grouping explains why one handled failure colors the session view

- Each worker step (`runWorkerOnce`) opens its own WORKFLOW span named
  `recover_pre_dispatch_order` with `sessionId = runId`. Per the SDK docs, the
  backend groups traces by session: one worker step = one trace, the session
  groups all steps of the run.
- The PREFERRED-route 503 is a real thrown failure inside exactly one TOOL
  span (`shipping_quotes`). The coordinator catches it, records FAILED quote
  and tool attempts, and continues to recovery (`recover_fallback`), so the
  enclosing WORKFLOW span of that step still completes normally.
- Consequence: the session legitimately contains one ERROR span (the intended
  503) alongside later successful spans. Any dashboard view that rolls session
  status up from its worst span will show red at the session level even after
  recovery to RESOLVED + independent PASS. That roll-up is dashboard behavior
  Nentra cannot control from instrumentation.

Classification of the observed symptoms:

1. Genuine operation failure: the injected PREFERRED `shipping_quotes` 503.
   Correctly ERROR, preserved.
2. Correctly captured handled failure followed by recovery: the same 503 is
   caught, persisted as FAILED attempts, and recovery selects the eligible
   ALTERNATIVE quote. Session-level red after recovery reflects this handled
   failure, not a new failure.
3. Successful operation incorrectly marked ERROR: NOT proven at the span
   level. Span-level OTel status is ERROR only on throw; our wrappers never
   threw on success. If the dashboard shows red on individual booking/readback
   spans, that marking originates from dashboard/session aggregation, not from
   span status Nentra sets.
4. Missing output without failure: CONFIRMED for all successful spans before
   this fix (empty `output.value` from `undefined` returns).

## Fix (instrumentation-only, verified)

`src/integrations/neatlogs/index.ts`:

- Trace callbacks now return `toSafeSpanOutput(result)` instead of `undefined`.
- `toSafeSpanOutput` preserves a domain `status` when the operation result
  already carries one (e.g. `BOOKED`), otherwise records `status: "OK"`;
  passes short strings/numbers/booleans through truncated; reduces objects to
  an allowlist of safe scalars (`id`, `quoteId`, `providerCode`, `serviceCode`,
  `amountNgn`, `status`, `mode`, `provider`, `model`, `action`, `decision`,
  `classification`, `route`, `summary`, `reason`, and similar); drops address,
  phone, landmark, and all other non-allowlisted fields; maps arrays to
  `{ status: "OK", count }` and null/undefined to `{ status: "OK" }`.
- Exceptions still propagate untouched, so the real 503 remains ERROR and no
  successful step implies case failure.
- Caller return values are unchanged; only exported span output changed.
- Existing trace IDs and B0/B1 history untouched; no policy, booking, agent,
  recovery, or approval logic altered.

Acceptance mapping:

- Real thrown shipping-quote failure remains ERROR: yes, verified by the new
  throw-propagation regression tests.
- Successful agent/booking/readback spans recorded accurately: yes, with safe
  redacted summaries instead of empty output.
- Successful worker steps do not imply case failure: unchanged, still accurate.
- Safe redacted summaries: yes, allowlist + truncation + regression tests.
- Trace IDs and B0/B1 history untouched: yes, no migration or reseed.
- Tests: full suite 102/102 pass including 4 new tracing regression tests.

## What remains unresolved (honest)

- Whether the neatlogs dashboard colors individual successful spans red vs.
  only the session header could not be verified from this environment: no
  dashboard access and no new production demo run (correctly withheld pending
  explicit permission). If individual successful spans show ERROR status in
  the dashboard after this fix, that marking comes from dashboard/SDK behavior
  outside Nentra's control; the span-level evidence after this fix (accurate
  output, ERROR only on throw) is the complete instrumentation-side correction.
- A live post-fix trace verification requires explicit permission for a
  production demo run and has NOT been executed.
