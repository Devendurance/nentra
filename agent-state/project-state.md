# Project State

- Nentra backend MVP implementation is complete on `main`, pending external deployment credentials.
- PostgreSQL + Drizzle is the canonical runtime store. PGlite is the local test database.
- The web API and worker share persisted case, task, event, job, booking, and evidence records.
- Fictional demo fixture: NG-2048, NGN 65,000, Ikeja to Lekki, missing landmark.
- The worker uses fenced per-attempt leases with heartbeats. Model requests have bounded timeouts.
- The deterministic sandbox path passes the seeded case through customer correction, a persisted 503 quote fault, fallback approval, idempotent booking, and independent verification.
- `NENTRA_RECOVERY_MODE=BASELINE` reproduces B0 by escalating on the persisted quote 503 without a fallback or booking. Unset or `RECOVERED` runs B1.
