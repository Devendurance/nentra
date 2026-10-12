# Left Off

- Doing: Nentra Floor (Phase 2), a read-only operations floor and replay of the persisted NG-2048 run.
- Done (branch `frontend/phase-2-operations-floor`):
  - `/app` discovers cases via GET /api/cases. `/app/cases/[caseId]` is the same floor scoped to one case.
  - The isometric SVG floor has six stations and agents, task-token handoffs, the failure state, a recovery branch and the verifier seal.
  - Also built: the decisions rail, the event-strip scrubber, the full timeline with inspection, and the verification receipt.
  - Replay supports play, pause, restart, step, scrub and 1x/2x.
  - Cursor-polling live mode, plus loading, error, not-found and reconnecting states.
  - Landing entry links.
- Verified against real Neon data on the production build:
  - 45 events rendered, and all 45 replay positions match the persisted titles. The seal appears only at #44 PASS and the banner at #45.
  - Keyboard, refresh, case route, 404, the API-failure state (no substitute data), the live-polling harness, 390px mobile and reduced motion all pass.
  - No non-GET requests and no secrets in the client bundle. 107/107 tests pass.
- Next: wait for the user's instruction. Candidate next slice is an operator-authenticated new run, the customer correction form and approval controls.
- Known issues: each public API read takes about 3-5s from this machine to Neon, so the first floor load takes about 8-10s. Provider and model attribution (Groq or DeepSeek) isn't exposed by the public API, so the floor doesn't show it.
