# Left Off

- Doing: deliver the backend MVP and preserve a truthful handoff.
- Done: schema and migrations, domain policy, sanitized API routes, durable worker with fenced leases, bounded delegated agents, sandbox shipping fault/recovery, idempotent booking, independent verification, neatlogs hooks, reproducible B0/B1 recovery modes, focused tests, and setup docs.
- Next: deploy/apply migrations against PostgreSQL and run credentialed model and neatlogs scenarios when those services are available.
- Latest focused verification for the B0/B1 change: durable workflow integration suite 3/3, TypeScript check passed, lint passed. The earlier full suite was 93 tests before the baseline regression was added.
- Known issues: no external PostgreSQL, model, neatlogs, Shipbubble, Entire, or cfo.ai credentials in this environment. The requested frontend correction page remains intentionally out of scope for this backend-only sprint.
