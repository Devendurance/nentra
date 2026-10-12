# Left Off

- Doing: landing page frontend, built in phases with visual approval between each one.
- Done (Phase 1 + motion corrections, merged to `main` from `frontend/phase-1-intro-hero`): brand tokens and fonts, an intro that plays on every page entry, the ember-field hero with WebGL living field and automatic lockup melt cycle, nav with an accessible mobile menu, the interim "How it works" section, and the DESIGN.md corrections.
- Verified on production build: fresh load, refresh, back navigation and revisit all replay the intro. Skip works and rerenders don't replay. The melt cycles automatically (canvas active 8-10s of every 14.4s), the field animates at 30fps, and the page holds 60fps. Reduced motion is static. 375/768/1280 have no overflow and there are no console errors. Hero copy contrast stays at 5.8:1 or better over 30s of field motion.
- Next: wait for the user's approval to start Phase 2, the pinned walkthrough [B] driven by persisted NG-2048 events (read-only, DEMO_SANDBOX).
- Known gaps: C's dark forms are a regular round lattice and ours are deliberately irregular per the user's brief. C's melt is active almost constantly, while ours keeps 5.4s clean holds by request.
