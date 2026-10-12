# Memory

- Do not modify the working backend (API routes, server, worker, agents, schema) during frontend work.
- Never call a booking delivered. `RESOLVED` means independently verified booking.
- All mutations are policy checked and all public payloads are sanitized.
- Never use `drizzle push`. Generate and apply migrations.
- External credentials and sponsor endpoints must never be guessed.
- The local acceptance suite uses PGlite and applies committed Drizzle migrations. A real PostgreSQL migration still requires `DATABASE_URL`.
- Without a routed provider key (`GROQ_API_KEY` for Investigator/Fulfillment or `DEEPSEEK_API_KEY` for Recovery), the complete `OPENAI_API_KEY` plus `OPENAI_MODEL` fallback is used; without all of those, specialist decisions run in deterministic mode. Without `NEATLOGS_API_KEY`, no external trace is claimed.
- Keep `NENTRA_RECOVERY_MODE` consistent across workers during a run. `BASELINE` stops safely after the seeded preferred-quote 503; the default `RECOVERED` mode continues recovery.
- Groq variables are `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_BASE_URL`, `GROQ_TIMEOUT_MS`. DeepSeek variables are `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_TIMEOUT_MS`.
- Investigator and Fulfillment prefer Groq strict JSON Schema. Recovery prefers DeepSeek JSON Object mode with schema instructions. Missing routed credentials use complete `OPENAI_*` fallback, otherwise deterministic mode.
- Next 16: `Image` `priority` is deprecated. Use `loading="eager"` + `fetchPriority="high"` for the LCP image. Two `Image`s sharing one `src` trigger a false LCP warning, so the nav uses `nentra-lockup-nav.png`.
- The React compiler lint rejects setState inside effects. Read external DOM state with `useSyncExternalStore` (see `intro-state.ts`).
- ICO files Next processes must embed RGBA PNGs.
- Never call `WEBGL_lose_context().loseContext()` in effect cleanup. StrictMode reruns the effect on the same canvas, and `getContext` then returns the lost context, so the shader silently never renders.
- `npx next start` on Windows can leave an orphaned node process holding the port, which then serves stale build assets. Check `Get-NetTCPConnection -LocalPort <port>` before restarting.
- Measure hero text contrast over time (`contrast.mjs` style sampling of saturated background pixels), not one frame, because the field moves.
- Cream text over the brightest ember is about 4.4:1. Hero body copy stays full cream over the center scrim. Never use cream text on amber fills.
- Logos: use the trimmed official PNGs in `public/brand/nentra/` (`nentra-lockup.png`, `nentra-mark.png`). The glass orb is atmosphere only.
