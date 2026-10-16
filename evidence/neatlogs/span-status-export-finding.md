# Neatlogs span-status export finding — isolated SDK reproduction (16 Oct 2026)

Scope: installed `neatlogs@1.1.28` (`node_modules/neatlogs/dist/index.mjs`),
Nentra `src/integrations/neatlogs/index.ts` (unchanged by this investigation).

## Minimal reproduction

```ts
// Fake OTLP endpoint captures the exact exported bytes. No production data.
import { createServer } from "node:http";
const bodies: Buffer[] = [];
const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => { bodies.push(Buffer.concat(chunks)); res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as AddressInfo).port;

import { trace, init, flush } from "neatlogs";
await init({ apiKey: "test-key", endpoint: `http://127.0.0.1:${port}`, workflowName: "repro" });

// Case 1: throwing callback. SDK code sets ERROR + recordException, then rethrows.
try {
  await trace({ name: "throwing_op", kind: "TOOL", sessionId: "s" }, async () => {
    throw new Error("boom-503");
  });
} catch { /* handled, like the coordinator handles the 503 */ }

// Case 2: explicit setStatus inside a succeeding callback.
await trace({ name: "manual_error", kind: "TOOL", sessionId: "s" }, async (span: any) => {
  span.setStatus({ code: 2, message: "manual-error" }); // OTel ERROR = 2
  return "ok";
});

await flush();
```

Decode each gzipped POST body as OTLP `TracesData` and read
`resourceSpans[].scopeSpans[].spans[]` → `status.code` (OTel: 0 = UNSET,
1 = OK, 2 = ERROR) and `events[].name`.

## Observed export (verified, repeatable)

- `throwing_op`: `status.code = 0` (UNSET), `events = ["exception"]`.
- `manual_error`: `status.code = 0` (UNSET), no events.
- Successful workflow/agent/tool spans: `status.code = 0` (UNSET), with
  `neatlogs.{agent,tool,workflow}.output` attributes present and `output.value`
  absent.
- A direct `span.setStatus({ code: 2 })` inside the callback is readable back
  as `{ code: 2 }` on the span object in the same tick, yet exports as `0`.

## Conclusion

In `neatlogs@1.1.28`, span status set inside `trace()`/`span()` callbacks —
including the SDK's own catch-block `setStatus(ERROR)` — does not survive to
the OTLP export. Every span exports UNSET. The throwing span's only error
signal in the payload is the `exception` event. Nentra's wrappers return safe
outputs and never set ERROR themselves, and bare-SDK calls behave identically,
so the cause is not in Nentra's instrumentation.

Because successful spans export with no error marker at all, per-span ERROR
labels on the dashboard cannot be derived from the exported OTel status or
from exception events on those spans. Assigning ERROR there happens
provider-side. Do not add instrumentation workarounds that fake real failures:
they would corrupt the genuine 503 signal, which is the only error marker
that exports correctly (as an exception event).

Recommended provider report: the six observations above plus the SDK version
and this repro. Ask neatlogs support (a) why callback-set statuses are lost
before export and (b) what backend rule labels UNSET spans without exception
events as ERROR.
