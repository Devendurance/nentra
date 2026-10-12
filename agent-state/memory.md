# Memory

- Backend only. Do not change frontend presentation or CSS.
- Never call a booking delivered. `RESOLVED` means independently verified booking.
- All mutations are policy checked and all public payloads are sanitized.
- Never use `drizzle push`. Generate and apply migrations.
- External credentials and sponsor endpoints must never be guessed.
- The local acceptance suite uses PGlite and applies committed Drizzle migrations. A real PostgreSQL migration still requires `DATABASE_URL`.
- Without `OPENAI_API_KEY` plus `OPENAI_MODEL`, specialist decisions run in deterministic mode. Without `NEATLOGS_API_KEY`, no external trace is claimed.
- Keep `NENTRA_RECOVERY_MODE` consistent across workers during a run. `BASELINE` stops safely after the seeded preferred-quote 503; the default `RECOVERED` mode continues recovery.
