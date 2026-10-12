# Memory

- Backend only. Do not change frontend presentation or CSS.
- Never call a booking delivered. `RESOLVED` means independently verified booking.
- All mutations are policy checked and all public payloads are sanitized.
- Never use `drizzle push`. Generate and apply migrations.
- External credentials and sponsor endpoints must never be guessed.
- The local acceptance suite uses PGlite and applies committed Drizzle migrations. A real PostgreSQL migration still requires `DATABASE_URL`.
- Without a routed provider key (`GROQ_API_KEY` for Investigator/Fulfillment or `DEEPSEEK_API_KEY` for Recovery), the complete `OPENAI_API_KEY` plus `OPENAI_MODEL` fallback is used; without all of those, specialist decisions run in deterministic mode. Without `NEATLOGS_API_KEY`, no external trace is claimed.
- Keep `NENTRA_RECOVERY_MODE` consistent across workers during a run. `BASELINE` stops safely after the seeded preferred-quote 503; the default `RECOVERED` mode continues recovery.
- Groq variables are `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_BASE_URL`, `GROQ_TIMEOUT_MS`. DeepSeek variables are `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_TIMEOUT_MS`.
- Investigator and Fulfillment prefer Groq strict JSON Schema. Recovery prefers DeepSeek JSON Object mode with schema instructions. Missing routed credentials use complete `OPENAI_*` fallback, otherwise deterministic mode.
