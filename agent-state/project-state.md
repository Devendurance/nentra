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
- The landing page uses no GSAP or Lenis yet. Both are installed for Phase 2 pinning.

## Branch fix/neatlogs-sponsor-evidence (12 Oct 2026)

- Tracing fix: safe span outputs, full suite green, build green. No policy/booking/frontend/Neon changes.
- Evidence staged: evidence/entire/, evidence/neatlogs/tracing-correction.md, evidence/cfo/model-inputs.md. No live cfo.ai model (needs user account access).
