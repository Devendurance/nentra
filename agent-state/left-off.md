# Left Off

- Doing: landing page frontend, built in phases with visual approval between each one.
- Done (Phase 1, branch `frontend/phase-1-intro-hero`): brand tokens, self-hosted Satoshi, the Georama and Instrument Serif fonts, the intro (orb resolving into the official N symbol), the ember-field hero with the official lockup melt, nav with an accessible mobile menu, and an interim "How it works" recovery-loop section that the CTA points to. DESIGN.md contradictions are corrected.
- Verified: type-check, lint, `next build`, and 98/98 tests. Real-browser Playwright checks passed at 375, 768, 1280 and 1440 with no horizontal overflow and no console errors in dev or prod. Reduced motion skips the intro, and repeat visits skip it.
- Next: wait for the user's visual approval of Phase 1. Phase 2 is the pinned walkthrough [B] driven by persisted NG-2048 case events (read-only, labelled DEMO_SANDBOX).
- Known issues: the hero CTA points to the interim loop section because no live recovery view exists yet. The doc CTAs "Watch a recovery" and "Explore a sample case" wait for Phase 2. Backend external credentials are still unbound, as before.
