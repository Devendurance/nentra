# Left Off

- Doing: landing sections 02 to 04 on branch `frontend/landing-sections-02-04`, PR open and waiting for the user's visual approval. Do not merge before approval.
- Done:
  - Section 02: pinned walkthrough of the recorded run (`Walkthrough`, `PhoneScreen`, `recorded/beats.ts`), GSAP ScrollTrigger on desktop only, stacked on mobile and reduced motion.
  - Section 03: five stacked story scenes with one aperture transition (`StoryStack`), proof bento from real API data (`ProofBento`), existing `RecoveryLoop` kept as the general loop (`#loop`).
  - Section 04: closing CTA and monumental footer (`Closing.tsx`).
  - Fixes found in the browser: Back from `/app` after clicking an in-page anchor left the floor on screen with the landing unreachable (now `HashNavigation`), and the intro overlay didn't replay on a client-side return because Next keeps the route alive (Intro now resets on re-entry).
  - Verified on the production build: pin, unpin, reverse, keyboard index and pager, refresh, back navigation, API failure and empty states, reduced motion, no overflow at 375/390/768/1280/1440, no non-GET requests, no secrets in the client bundle. 120/120 tests.
- Next: wait for visual approval, then merge. Later slices: live workflow controls, customer correction and approval (need operator auth).
- Known issues:
  - Neon reads from this machine take 5 to 14s each and the public API sometimes returns 500, so the recorded panels can take 25 to 75s to fill. They show loading and retry states meanwhile.
  - Next prefetches `/app`'s stylesheet from the landing's `/app` links, which logs a harmless "preloaded but not used" warning.
  - A browser refresh lands near the top (the intro replays) rather than restoring a mid-page position.
