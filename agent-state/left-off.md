# Left Off

- Doing: Phase 6 WhatsApp Customer Liaison on branch `feat/whatsapp-customer-liaison`. P6.1 through P6.3 done, P6.4 next. Do not merge before approval.
- Done:
  - P6.2: customer_contacts (HMAC-SHA256 lookup, AES-256-GCM number, OPTED_IN/OPTED_OUT with provenance) plus internal operator provisioning, no public route.
  - P6.2: verified webhook route (GET challenge, POST HMAC-SHA256 over raw bytes, constant-time compare), deduped inbound events, delivered/read/failed status recording with monotonic guard.
  - P6.2: reply-context plus single-candidate correlation, `landmark:` constrained replies through the shared correction core, same-run resumption to RESOLVED with one booking, token endpoint untouched.
  - Verified: 9/9 new inbound tests plus 5/5 P6.1 tests, type-check, lint, production build clean.
- Done:
  - P6.3: atomic send claims plus trusted-contact sending, SENT/RETRYABLE/FAILED/NEEDS_REVIEW classification with manual resolution, per-notification status dedupe with monotonic updates, worker liaison wiring gated on WHATSAPP_ENABLED, full suite 144/144 green.
- Next: P6.4 Floor messaging projections. Real sending stays disabled until P6.5 sandbox verification.
- Known issues:
  - WHATSAPP_API_VERSION default must be confirmed against current Meta docs before P6.5 sandbox verification.
  - No real WhatsApp delivery tested. Production sending stays disabled.
  - Landing sections 02-04 work merged via PR #5. Recorded NG-2048 case untouched.
