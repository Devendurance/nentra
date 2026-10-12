# Project State

- Nentra backend MVP implementation is complete on `main`, pending external deployment credentials.
- PostgreSQL + Drizzle is the canonical runtime store. PGlite is the local test database.
- The web API and worker share persisted case, task, event, job, booking, and evidence records.
- Fictional demo fixture: NG-2048, NGN 65,000, Ikeja to Lekki, missing landmark.
- The worker uses fenced per-attempt leases with heartbeats. Model requests have bounded timeouts.
- The deterministic sandbox path passes the seeded case through customer correction, a persisted 503 quote fault, fallback approval, idempotent booking, and independent verification.
- `NENTRA_RECOVERY_MODE=BASELINE` reproduces B0 by escalating on the persisted quote 503 without a fallback or booking. Unset or `RECOVERED` runs B1.
- Specialist routing supports Groq for Investigator/Fulfillment and DeepSeek for Recovery, with bounded provider-specific JSON handling and `OPENAI_*` fallback.
- This cloud runtime currently exposes no requested secrets or provider egress, so real PostgreSQL, model, and neatlogs verification is blocked.

## Frontend

- The landing page is at `/` (`src/app/page.tsx`), with components in `src/components/landing/`: `SiteNav`, `Intro`, `Hero`, `EmberCanvas`, `MeltLockup`, `RecoveryLoop`, `intro-state.ts` and `gl.ts`.
- Tokens and component classes live in `src/app/globals.css` (Tailwind v4 `@theme inline`). The spotlight grid and bento classes are ready for later sections.
- Intro state lives on `<html data-intro>`, set before paint by an inline script in `layout.tsx`. `play` on every page entry, `reveal` after the hand-off, `skip` only for reduced motion. Nothing is stored. Client-side returns reset to `play` on mount, and bfcache restores replay via `pageshow`.
- Melt (`MeltLockup`): a WebGL1 shader samples the official lockup PNG with domain-warped displacement, marbled contour bands, tears and a hard alpha threshold. Automatic cycle: 2.6s form at hand-off, then a 14.4s loop (5.4s clean, 3s melt in, 2.4s sustain, 3.6s reform). The clean PNG shows whenever the melt is idle. Mouse movement adds an optional local melt. The timeline clock pauses off screen.
- Field (`EmberCanvas`): a WebGL1 domain-warped egg-crate lattice at about a third of the resolution, 30fps, paused off screen. Highlights are suppressed and the field darkened in the text column for contrast. The CSS gradient field is the fallback. Reduced motion draws one static frame.
- The landing page uses no GSAP or Lenis yet. Both are installed for later pinned sections.

## Nentra Floor (`/app`)

- Components live in `src/components/floor/`, with styles in `src/app/app/floor.css`. `/app` discovers the case via GET /api/cases. `/app/cases/[caseId]` shows the same floor in a Suspense-wrapped dynamic route.
- Data: `useCaseFeed` reads the snapshot, `events?after=` and evidence. It polls every 2s only while the case is non-terminal, dedupes by seq, rebuilds from 0 on a seq gap, uses exponential backoff, and handles reconnecting, error and not-found states. It never shows substitute data and makes no non-GET calls.
- `projection.ts` is a pure function from events to presentation state: station statuses, handoff tokens, blocker, recovery, approval, verification and outcome. Station state comes only from event type, actor, station and result code. Unit tests are in `tests/floor/`.
- Replay is client-side. A terminal case autoplays from 0, while live or reduced-motion views follow the latest event. A run observed live doesn't rewind when it finishes. Any viewer action cancels the pending autoplay.
- Approval amounts aren't parsed from text. The ceiling comes from `merchant.maxShippingNgn` and the verified amount from the evidence receipt.

## Branch fix/neatlogs-sponsor-evidence (12 Oct 2026)

- Tracing fix: safe span outputs. No policy, booking, or Neon changes. Branch adds no frontend work itself; Floor arrives via the main merge.
- Evidence staged: evidence/entire/, evidence/neatlogs/tracing-correction.md, evidence/cfo/model-inputs.md, docs/hackathon-demo-evidence.md. No live cfo.ai model (needs user account access).
- Entire checkpoint 01M4RDHBN8Z60Q0MVVS35EG3MK linked to commit a9d6aeb.
