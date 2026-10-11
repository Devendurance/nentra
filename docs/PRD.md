# Nentra — Product Requirements Document (PRD)

> **Version:** 1.0 — 11 October 2026  
> **Decision:** **Nentra** is the final product name. The product direction and hackathon MVP below are locked.  
> **Product:** Visually observable AI order-exception recovery for Nigerian social-commerce merchants  
> **Event:** neatHack 2026 (12 October submission)  
> **Related documents:** [`TRD.md`](TRD.md) · [`architecture.md`](architecture.md) · [`projectplan.md`](projectplan.md)

## 1. Executive summary

**Nentra is an AI operations team that helps Nigerian online merchants recover orders blocked before dispatch.** Rather than merely identifying that an order is stuck, Nentra investigates the exception, delegates work to bounded specialist agents, requests missing information or merchant approval where necessary, selects a safe recovery action, executes it through a connected or explicitly simulated operations provider, and independently verifies the outcome.

Its defining user experience is a **live, 2.5D agent operations floor**. Merchants watch real tasks travel between stations, agents perform actual tool actions, failures trigger visible recovery behavior, and the right-side activity panel explains decisions and shows proof. All meaningful animation must be driven by persisted backend events; it must never substitute for work that did not occur.

**Initial buyer:** the owner or operations lead of a Lagos-based Instagram/WhatsApp-first fashion, beauty, or accessories store managing recurring orders across messaging, inventory, and delivery tools.

**Primary commercial job:** reduce the time and preventable revenue loss caused by pre-dispatch order exceptions.

**MVP job:** resolve one reproducible, end-to-end Nigerian shipping exception—from incomplete delivery information to a **verified shipment booking**—with real agent delegation, a real tool failure, bounded recovery, and independent verification. A completed booking is **not** a completed physical delivery.

## 2. Problem definition

### 2.1 The customer experience today

A typical merchant receives orders in WhatsApp or Instagram, records sales in a storefront or spreadsheet, confirms payment, obtains customer details, and books a dispatch partner. Different systems own different pieces. When an address is incomplete, a rate quote times out, a courier is ineligible, or inventory differs from the listing, the merchant becomes the incident manager: checking records, asking questions, comparing options, coordinating a rider, and confirming the outcome.

Many existing products already perform order capture, shipping aggregation, inventory management, or messaging automation. **Nentra is not replacing them**. Its wedge is the **exception-resolution work between those systems**: identify the blocker, coordinate a repair, execute authorized steps, and prove the updated state.

### 2.2 Problem statement

> For a small Nigerian online merchant whose order cannot proceed to dispatch, manually diagnosing and coordinating a recovery across fragmented tools creates delays, operational cost, uncertainty, and preventable cancellations. The merchant needs a trusted agent that performs the resolution workflow and leaves verifiable evidence, with control over customer communications and spending.

### 2.3 Narrow initial problem

**In scope first:** missing/incomplete delivery information combined with unavailable or failed courier quotation before shipment booking.

**Out of scope first:** parcels already in transit, physical dispatch tracking as proof of delivery, refunds, debt collection, chargebacks, procurement, autonomous payment movement, inventory purchasing, multi-country logistics.

### 2.4 Why a generic chatbot is insufficient

A generic chatbot may explain possible steps, but Nentra is judged on connected execution: persisted case state, provider adapters, customer correction workflow, delegated agent tasks, safe approval gates, idempotent shipment actions, replayable events, and independent post-action verification. The differentiator is **the resolved operational case**, not the existence of an LLM or an animated interface.

## 3. Goals and non-goals

### Product goals

1. Convert a pre-dispatch exception into a concrete, evidence-backed outcome with minimal merchant micromanagement.
2. Make the agent's actual work legible: who owns the task, what was attempted, what failed, why the next step was chosen, and what was verified.
3. Preserve merchant authority over consequential operations and additional costs.
4. Be useful as a standalone Nigerian merchant workflow, while allowing future integrations with commerce systems.
5. Demonstrate authentic use of **neatlogs, Entire, and cfo.ai** for neatHack 2026.

### Hackathon success criteria

- A fresh seeded case can be started and completed from the UI without editing database rows or running manual repair commands.
- The case includes at least two **real delegated specialist executions** with distinct responsibilities, tools, and persisted results.
- At least one actual tool call fails in the demo scenario; the workflow recognizes it and recovers or escalates within policy.
- The interface depicts agent handoff, failure, retry/fallback, approval (if required), and verification from stored events.
- A verified shipment booking is persisted with provider/adapter reference and evidence; no false delivery claim.
- An actual neatlogs workflow trace includes agent/tool spans, and a comparable before/after trace demonstrates one measurable improvement.
- Entire checkpoints from build sessions and a cfo.ai-created financial plan are accessible in submission evidence.
- Public repo, <=3-minute demo, and public X submission satisfy the published competition requirements.

### Non-goals

- A generalized commerce ERP or CRM.
- A production-ready WhatsApp Business API integration as a prerequisite to demo.
- A native mobile app, game engine, multiplayer simulation, or autonomous agent marketplace.
- An agent that can charge customers, transfer money, cancel orders or message real customers without authorization.
- Recreating neatlogs' tracing UI, Entire's code-history product, or cfo.ai's financial model inside Nentra.

## 4. Customer and jobs-to-be-done

### Persona A — Ayo, merchant-owner (primary buyer)

- Runs a Lagos online fashion store with frequent orders, uses WhatsApp and a storefront, books third-party shipping.
- Pain: dispatch issues interrupt selling and require repeated manual checks.
- Job: "When an order gets stuck before dispatch, resolve it safely and tell me what changed, what it cost, and what I still need to do."
- Trust requirement: approval over extra delivery cost; no duplicate shipment fees; customer details protected.

### Persona B — Tola, fulfillment coordinator (daily user)

- Works from a queue of orders and exceptions.
- Job: "Give me a clear list of cases, who is handling each one, what's blocking them, and evidence for closure."
- Trust requirement: understandable status updates, actionable escalation, reliable timestamps.

### Customer hypothesis

The initial niche is a product hypothesis, not a proven willingness-to-pay claim. Validate after the hackathon with 5–10 merchant conversations and anonymized real case histories; compare cost of manual handling with Nentra's resolution time and actual outcomes.

## 5. Positioning and core value

**Category:** AI order-exception operations / autonomous merchant recovery.  
**Positioning:** "When an order gets stuck, Nentra gets to work." *(provisional marketing copy, not a locked tagline.)*  
**Functional promise:** investigate, coordinate, recover, verify.  
**Emotional promise:** the merchant retains control and can understand what their AI team is doing.

**Competitive distinction to substantiate:** focused pre-dispatch resolution across systems, verifiable closed-loop execution, human approval and spatial observability—rather than order listing, passive alerting, or a scripted assistant conversation.

## 6. Locked MVP scenario: the Nentra Rescue Run

This **fictional Nigerian test order** is a seeded demo scenario, clearly labeled "Demo / Sandbox" in the application and evidence.

**Order:** `NG-2048`; Lagos-based fashion merchant; order subtotal **₦65,000**; sender in Ikeja, receiver in Lekki. Values are illustration only, not measured market averages.

**Starting state:** paid/confirmed test order; recipient address lacks a required landmark/field; merchant has a shipping-price ceiling. No shipment has been booked.

**End-to-end job:**

1. The operations controller receives the exception and creates a case plan.
2. Order investigator checks order, address requirements, payment flag, and current booking state; flags missing information.
3. Customer liaison creates a **secure customer-correction request**. In demo, a second browser/view acts as the fictional customer and submits the corrected address. This is a real API/database change; do not pretend a WhatsApp message was sent.
4. Fulfillment specialist requests eligible shipping quotes using an adapter.
5. In demo/sandbox mode, the first preferred-courier quote call returns a **persisted, deliberate transient failure** (e.g., HTTP 503). This is a real failing adapter invocation, not a front-end animation.
6. Recovery specialist classifies the error, consults retry policy and either retries safely or selects a permitted alternative. It does not make duplicate booking attempts.
7. Controller checks proposed cost against merchant ceiling and requests approval if above threshold.
8. Authorized booking occurs via the adapter; return a unique booking reference.
9. Verifier fetches the booking independently and confirms order ID, recipient, selected courier/price, uniqueness and booking status.
10. The UI shows **Resolved: booking verified**, receipt/evidence, and links to available traces. Never show "delivered".

### Required alternative endpoints

- **Success:** booking verified.
- **Waiting for customer:** correction still required; no auto-invented address.
- **Waiting for approval:** additional cost or policy-bound action; no auto-approval.
- **Escalated:** provider exhausted/unavailable, invalid data, excessive budget, ambiguous booking outcome, or verification mismatch.

## 7. Functional requirements

Priorities: **P0 = must ship for hackathon**, **P1 = only if P0 is stable**, **P2 = post-hackathon**.

| ID | Priority | Requirement | Acceptance test |
|---|---|---|---|
| FR-01 | P0 | Merchant-facing case inbox and case detail | New seeded case visible with current blocker and owner |
| FR-02 | P0 | Durable order, case and run state | Refresh/restart keeps state and event history |
| FR-03 | P0 | Controller delegates scoped tasks to actual specialist executors | Persisted `task_delegated` and `agent_started/completed` with distinct task owners |
| FR-04 | P0 | Order investigator detects missing address field | Cannot quote until required correction arrives |
| FR-05 | P0 | Customer correction through a scoped, expiring link or protected demo endpoint | Corrected data persists; invalid token rejected |
| FR-06 | P0 | Shipping adapter returns quote options, availability and provider errors | Quotes include source, currency, expiration and eligible flags |
| FR-07 | P0 | Bounded retry/fallback policy | Transient fault leads to a bounded next action; business rejection does not loop |
| FR-08 | P0 | Cost and action approval guard | Over-ceiling proposal pauses; no booking without valid approval |
| FR-09 | P0 | Idempotent booking | Double-click/resume does not create two bookings |
| FR-10 | P0 | Independent provider-side booking verification | Verified reference and checks recorded; unresolved if evidence mismatches |
| FR-11 | P0 | Live 2.5D visual operations floor | Backend events move/task-own avatars and show honest failure/recovery |
| FR-12 | P0 | Right-side activity and decision pane | Shows plain-language event summary, owner, timestamp, result/error, evidence |
| FR-13 | P0 | Replay/inspect persisted events | Refresh/replay never invents missing events |
| FR-14 | P0 | neatlogs end-to-end traces and linked evidence | One trace per complete run, nested role/tool spans, PII masked |
| FR-15 | P0 | Before/after regression evidence | Two repeatable scenario runs, measurable outcome difference |
| FR-16 | P0 | Entire development checkpoints and cfo.ai business model | Both artifacts linked in repo/submission; truthful use descriptions |
| FR-17 | P0 | Demo reset and seeding (access controlled) | Idempotent seed; reset restores deterministic fault schedule |
| FR-18 | P1 | Actual Shipbubble test API for rate/booking (if credentials and test behavior validated) | Test booking verified via API response/readback |
| FR-19 | P1 | Additional Nigerian merchant exception templates | Second flow works without breaking first |
| FR-20 | P2 | Bumpa/storefront connector and WhatsApp Business integration | Live input and compliant communications under merchant authorization |
| FR-21 | P2 | Post-booking recovery and field support workflows | New domain design, not silently part of pre-dispatch MVP |

## 8. User experience and information architecture

### Primary routes

- `/` — premium landing page: value, how it works, sample visual, launch demo.
- `/app` — case inbox / overview (case cards, state, urgency, recoveries).
- `/app/cases/[id]` — flagship Nentra live operations floor.
- `/c/[token]` — fictional-customer correction portal (secure scoped link, demo-labelled).
- `/app/evidence/[id]` — resolution receipt and event timeline (may be a section of case page for MVP).

### The operations floor

**Desktop-first composition:**

- **Top bar:** merchant/case, amount NGN, current phase, sandbox badge, overall outcome.
- **Main canvas (60–70% width):** isometric 2.5D operational floor, six distinct stations, moving agent characters and task tokens, contextual indicators.
- **Right rail (30–40%):** task objective, present owner, decision rationale in concise language, tool outcomes, approval actions, error/recovery updates and evidence.
- **Bottom timeline:** chronological event milestones and scrub/replay control (P0 simple event list; P1 interactive scrub).

**Station map:** Intake/Controller → Investigation → Customer Liaison → Fulfillment → Recovery → Verification. Agents only move in response to corresponding event types. Work can return to a previous station after failed verification or retry.

### Behavioral principles

- Visual events are **read models** of persisted backend facts, not sources of truth.
- Use specific states: `Investigating`, `Waiting for customer`, `Quoting`, `Recovering`, `Waiting for approval`, `Booking`, `Verifying`, `Verified`, `Escalated`.
- Never expose raw model chain-of-thought. Show short decision summaries, actions and supporting evidence instead.
- Every failure should show cause, responsible tool, allowed next step, and retry limit or escalation.
- A paused case should look paused, not like an agent is secretly continuing.
- Provide accessible non-animated event list and respect reduced-motion preferences.
- Mobile fallback: stacked operations map and activity panel; do not attempt full game-engine controls.

### Visual/art direction (product-level, not the unfinished brand kit)

Sophisticated and friendly, **not childish**. Consider a premium editorial interface with an isometric desk/workshop/warehouse metaphor, animated task parcels, and readable labels. Brand color, typography, logo and agent character art remain open for the brand system; **Nentra** is the only finalized identity element.

## 9. Agent behavior and authorization

### Agent responsibilities

| Role | Responsibility | Approved tool domain |
|---|---|---|
| Controller | Own objective, classify next task, delegate, assess completion | Case plan, task delegation, policy inspection |
| Investigator | Validate order and diagnose blockers | Read orders/address/booking status |
| Customer Liaison | Create correction request and interpret response | Read missing fields, create correction link; no unsolicited live messaging |
| Fulfillment | Fetch and evaluate eligible quotes | Read quotes, eligibility, cost policy |
| Recovery | Classify failure and choose bounded retry/alternative | Error analysis, retry/fallback commands |
| Verifier | Independently check external result and issue receipt | Read booking provider result, compare authoritative fields |

Not every "station" must be an independent LLM process. **At minimum, the controller delegates real bounded tasks to at least two specialist agent executions with separate role instructions/tool access and persisted outputs.** Safety checks, budget gates, idempotency and verification should be deterministic, not delegated to unconstrained language generation.

### Human-in-the-loop

- Approve extra spend or deviation from merchant policy.
- Explicitly authorize booking in live-provider mode; sandbox can use predefined demo policy.
- Merchant/customer input pauses processing when required.
- Human may cancel or escalate a case; no auto-action while terminal/cancelled.

## 10. Evidence, success metrics and analytics

### MVP proof

- Trace A: baseline case fails when the preferred courier quote fails; captures failure/error and unresolved state.
- Trace B: same starting fixture, improved recovery logic enables eligible fallback and verified booking.
- Compare: final status, successful booking rate for that case, recovery count, retries, elapsed time, model/token cost where accurately available, and verification outcome. **Do not invent or promise specific reductions before measurement.**
- Entire: actual hackathon-dated commits with linked checkpoint metadata or graph output.
- cfo.ai: actual financial plan with pricing, customers, cases per month, inference/provider costs, monthly gross margin and runway assumptions.
- Submission: public repo, 3-minute maximum demo, X quote post tagged `#neatHack`, source links and evidence screenshots.

### Product KPIs (longer-term targets, not current results)

- **Verified recovery rate:** verified resolved cases / eligible recovery cases.
- **Median time to verified resolution:** timestamps from case open to verified booking.
- **Human touches per case:** count of required interventions.
- **Additional recovery spend:** courier charge and provider/inference fees per recovered case.
- **Unsafe action count:** duplicate bookings, unauthorized spend or invented success; target zero in MVP testing.

## 11. Commercial assumptions to test

**Business model hypothesis:** monthly B2B subscription with included agent-managed cases plus usage-based overage for higher volumes. Candidate pricing for model sensitivity only: **₦10,000, ₦20,000 and ₦30,000/month**, not validated purchase intent. Model exchange rates, messaging/API charges, LLM tokens, hosting, refunds, support and payment fees explicitly in **cfo.ai** rather than inventing margins.

**Expansion path:** once pre-dispatch resolution works, add verified integrations to commerce platforms, compliant messaging, inventory corrections and broader African markets. None belongs in the time-critical neatHack scope.

## 12. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Unavailable live logistics credentials/test API | High | Ship self-contained, truthful sandbox adapter; live integration is optional P1 |
| LLM invents outcome or takes impermissible action | Critical | Typed tools; deterministic policy/verification; no free-form external actions |
| Duplicate booking after timeout/retry | Critical | Case-scoped idempotency key, reconcile unknown outcome, never blindly retry ambiguous writes |
| PII enters public traces, screenshots or repo | Critical | Fictional demo only; mask telemetry; server-side secrets; sanitize evidence |
| Animation desynchronizes from execution | High | Durable event log; render from backend sequence; reconnect/resync |
| Agent flow is a scripted theatrical demo | High | Real subagent executions, actual tools/DB writes, provider fault at adapter boundary |
| Overbuilding causes unfinished submission | High | Stop at one complete scenario; defer real integrations and advanced visual features |
| Brand overpromises courier delivery | Medium | Language says "verified booking", not "delivery completed" |

## 13. Release gates

**Gate 1 — Domain:** one case moves through correction → quote failure → recovery → authorized booking → provider readback.

**Gate 2 — Agent:** actual controller-to-specialist calls with stored inputs/outcomes; one real failure; bounded recovery.

**Gate 3 — Presentation:** 2.5D workspace and activity panel synchronized to the event journal; no fake animations.

**Gate 4 — Sponsor evidence:** actual neatlogs before/after traces; Entire checkpoints; completed cfo.ai plan.

**Gate 5 — Submission:** deployment accessible, public repository with hackathon-date commits, under-3-minute demo, public build posts and final quote-post submission before Discord-confirmed cutoff.

## 14. Open decisions that do not block building

- Final brand palette, typography, logo and 2.5D character art.
- Specific model provider/model through supplied LiteLLM account versus user's own key.
- Whether Shipbubble test credentials will be available and stable; sandbox remains canonical.
- Exact subscription prices after merchant interviews.
- How many live customer/order integrations the post-hackathon version should support.

## 15. Reference material

- Hackathon rules: https://neatlogs.com/hackathon
- neatlogs TypeScript SDK: https://docs.neatlogs.com/sdk/typescript
- Entire CLI: https://github.com/entireio/cli
- Shipbubble getting started/test key: https://docs.shipbubble.com/get-started
- Shipbubble rates: https://docs.shipbubble.com/api-reference/rates/request-shipping-rates
- Shipbubble shipment creation: https://docs.shipbubble.com/api-reference/shipments/create-shipment

*Scope note: External documentation verifies potential technology paths; it does not mean Nentra has been built or connected yet.*
