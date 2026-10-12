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

- The landing page is at `/` (`src/app/page.tsx`), with components in `src/components/landing/`: `SiteNav`, `Intro`, `Hero`, `MeltLockup`, `RecoveryLoop`, and `intro-state.ts`.
- Tokens and component classes live in `src/app/globals.css` (Tailwind v4 `@theme inline`). The spotlight grid and bento classes are ready for later sections.
- Intro state lives on `<html data-intro>` and is set before paint by an inline script in `layout.tsx`. The values are `play` on a first visit, `reveal` after the hand-off, and `skip` for returning visitors (localStorage `nentra:intro-seen`) or reduced motion.
- Melt: SVG feTurbulence + feDisplacementMap + alpha threshold on a masked overlay copy of the official lockup. The clean copy is always present. The melt only runs on mouse movement near the lockup and is never perpetual.
- The landing page uses no GSAP or Lenis yet. Both are installed for Phase 2 pinning.
