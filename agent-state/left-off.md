# Left Off

- Doing: Phase 6 WhatsApp Customer Liaison on branch `feat/whatsapp-customer-liaison` (based on origin/main 04626d3). P6.1 done, P6.2 next. Do not merge before approval.
- Done:
  - P6.1: Meta Cloud API template sender (`src/integrations/whatsapp`), disabled by default, injectable transport, transient/permanent/ambiguous classification.
  - P6.1: `whatsapp_messages` table + migration `0002_tidy_chameleon.sql`, idempotent insert-or-return by idempotency key.
  - P6.1: `requestCorrectionViaWhatsapp` service reuses pending correction request, persists SENT/SKIPPED/FAILED + sanitized liaison event, never resends, keeps scoped-form fallback.
  - Verified: 5/5 new tests, type-check, lint, production build all clean.
- Next: P6.2 inbound webhook + correlation + resumption. First gap: recipient phone + consent sourcing (orders has no phone/consent fields).
- Known issues:
  - WHATSAPP_API_VERSION default must be confirmed against current Meta docs before P6.5 sandbox verification.
  - No real WhatsApp delivery tested. Production sending stays disabled.
  - Landing sections 02-04 work merged via PR #5. Recorded NG-2048 case untouched.
