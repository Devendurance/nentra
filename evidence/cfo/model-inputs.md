# Nentra — cfo.ai Financial Model Inputs (implementation-ready worksheet)

**Status:** Prepared assumptions only. No actual cfo.ai model exists yet.
**Date prepared:** 12 October 2026 (WAT).
**Owner action required:** A user with cfo.ai account access must create the actual
financial model on the cfo.ai platform from this worksheet and return a real
link/export. This Markdown file is NOT the sponsor deliverable.

All paying-merchant, volume, price, cost, and FX figures below are
**UNVALIDATED hypotheses** for sensitivity modeling only. Nentra has no existing
paying customers. Do not present projected merchants as customers. Merchandise
GMV and shipping pass-through are NOT platform revenue.

## 1. Base assumptions (all unvalidated)

| # | Assumption | Value | Status |
|---|------------|-------|--------|
| A1 | Merchant subscription | NGN 20,000 / month | Unvalidated hypothesis |
| A2 | Base-case paying merchants | 50 | Unvalidated hypothesis |
| A3 | Downside paying merchants | 20 | Unvalidated hypothesis |
| A4 | Upside paying merchants | 150 | Unvalidated hypothesis |
| A5 | Base cases per merchant per month | 80 | Unvalidated hypothesis |
| A6 | Cases processed, base | 50 x 80 = 4,000 / month | Derived from A2 x A5 |
| A7 | Cases processed, downside | 20 x 80 = 1,600 / month | Derived from A3 x A5 |
| A8 | Cases processed, upside | 150 x 80 = 12,000 / month | Derived from A4 x A5 |
| A9 | Billing | Monthly B2B subscription, per merchant | Hypothesis; overage model undecided |
| A10 | Existing paying customers | 0 | Fact: none. Projections are not customers |

## 2. Revenue model

Subscription revenue per month = paying merchants x NGN 20,000.

| Scenario | Merchants | Revenue / month (NGN) |
|----------|-----------|----------------------|
| Downside | 20 | 400,000 |
| Base | 50 | 1,000,000 |
| Upside | 150 | 3,000,000 |

Revenue per year = monthly revenue x 12. No GMV, shipping fees, or courier
pass-through is counted as revenue. Any future usage overage is out of scope
for this worksheet until a price is set.

## 3. AI inference cost per case (measured structure, estimated tokens)

Measured facts from the codebase (12 Oct 2026):

- LLM calls per recovered case (B1 path): up to 4 structured calls:
  investigator (1) + fulfillment on empty quotes after the 503 (1) + recovery (1)
  + fulfillment evaluate (1). Baseline B0 path uses fewer calls and escalates.
- Output bound enforced in code: `MAX_OUTPUT_TOKENS = 512` per call
  (`src/integrations/llm/index.ts`).
- No production token-usage metering is persisted. Test mocks use 1 prompt +
  1 completion token and prove nothing about production cost.

Token estimate per call (UNVALIDATED, for sensitivity only):

- Input: system instructions (~200-300 tokens) + case JSON (~200-400 tokens).
  Planning figure: 500 input tokens per call.
- Output: small structured JSON, typically 100-200 tokens; bound 512.
  Planning figure: 200 output tokens per call.

Planning figure per case: 4 calls x (500 in + 200 out) = 2,000 input + 800 output tokens.

Provider pricing inputs (VERIFY on provider pricing pages on the day the cfo.ai
model is built; indicative training-knowledge ranges only, NOT quotes):

| Provider | Role | Price input to confirm |
|----------|------|------------------------|
| Groq (`openai/gpt-oss-20b` default) | Investigator, Fulfillment | USD per 1M input / 1M output tokens |
| DeepSeek (default `deepseek-flash`-family) | Recovery | USD per 1M input / 1M output tokens |
| OpenAI-compatible fallback | Any role when routed keys absent | USD per 1M input / 1M output tokens for the chosen fallback model |

Inference cost formula per month:

```
monthly_inference_usd = monthly_cases x 4 x
  ((500 / 1e6) x blended_input_usd_per_1M + (200 / 1e6) x blended_output_usd_per_1M)
```

Enter the verified per-provider prices into cfo.ai as separate line items so
Groq vs DeepSeek mix is visible. Keep deterministic-mode (no-LLM) cases at
zero inference cost.

## 4. Hosting, database, observability, other operating costs (monthly)

All figures below are UNVALIDATED planning placeholders. Confirm each on the
vendor page/bill on the day the cfo.ai model is built (label: 12 Oct 2026).

| Line | Item | Planning placeholder | Source to verify |
|------|------|----------------------|------------------|
| O1 | AWS EC2 worker + web (e.g. t3.small-class, Lagos-closest region) | USD 20-40 | AWS EC2 pricing page |
| O2 | Neon PostgreSQL (managed, incl. storage + data transfer) | USD 20-70 by volume | Neon pricing page + actual bill |
| O3 | neatlogs ingestion (trace volume = spans per case x cases) | Vendor plan or USD 0-50 | neatlogs pricing page + actual bill |
| O4 | Entire | Current checkpoints via git-refs; confirm paid tier if any | Entire pricing page |
| O5 | cfo.ai | Confirm plan cost, if any | cfo.ai pricing page |
| O6 | Messaging/API (correction links, notifications, if enabled) | USD 0-30 | Provider bills |
| O7 | Domain, TLS, incidentals | USD 5-15 | Receipts |

Spans per case for neatlogs volume planning: ~1 WORKFLOW span per worker step
(9 steps max in B1) + 1 AGENT span per agent call (up to 4) + 1 TOOL span per
tool attempt (quotes, booking, readback). Planning figure: 12-18 spans per
recovered case before LLM-provider spans.

## 5. FX assumption (verify on build day)

| Item | Value |
|------|-------|
| NGN per USD | UNVALIDATED planning figure: 1,550. Verify against the applicable CBN / market rate on the day the cfo.ai model is built and record the date and source in cfo.ai. |

Convert USD-denominated provider/hosting costs to NGN at the recorded rate
before margin math.

## 6. Gross profit and margin (monthly, base scenario template)

```
subscription_revenue_ngn  = merchants x 20,000
inference_cost_ngn       = monthly_inference_usd x fx
operating_cost_ngn      = (O1 + O2 + O3 + O4 + O5 + O6 + O7 in USD) x fx
gross_profit_ngn        = subscription_revenue_ngn - inference_cost_ngn - operating_cost_ngn
gross_margin_pct        = gross_profit_ngn / subscription_revenue_ngn x 100
```

Worked illustration with placeholders only (NOT a claim):

- Base revenue: 50 x 20,000 = NGN 1,000,000.
- If verified inference + operating costs totalled, say, NGN 250,000,
  gross profit = NGN 750,000, margin = 75%.
- Replace every placeholder with verified bills before sharing with judges.

## 7. Fixed expenses and runway

Record in cfo.ai as monthly fixed lines (all unvalidated until invoiced):

- Team / contractor costs.
- Support and operations time.
- Payment-processing fees on collected subscriptions.
- Refunds and chargebacks provision.
- Compliance / business registration amortisation.

Runway formula:

```
runway_months = cash_on_hand_ngn / max(1, monthly_fixed_ngn + operating_cost_ngn + inference_cost_ngn - subscription_revenue_ngn)
```

If the denominator is zero or negative (profitable), report "profitable at
this volume" instead of a month count.

## 8. Three scenarios (structure for cfo.ai)

Build all three from the same formulas, changing only merchants and cases:

| Scenario | Merchants | Cases / mo | Revenue / mo (NGN) | Inference | Operating | Gross profit | Margin |
|----------|-----------|------------|--------------------|-----------|-----------|--------------|--------|
| Downside | 20 | 1,600 | 400,000 | scale by 1,600 cases | mostly fixed + volume lines | formula | formula |
| Base | 50 | 4,000 | 1,000,000 | scale by 4,000 cases | mostly fixed + volume lines | formula | formula |
| Upside | 150 | 12,000 | 3,000,000 | scale by 12,000 cases | step up DB/trace tiers | formula | formula |

## 9. Sensitivity checks to run in cfo.ai

1. Inference volume: double tokens per case (1,000 in + 400 out) and re-run
   all three scenarios. Report margin impact.
2. Churn: lose 20% of paying merchants month over month for 3 months at base
   acquisition. Report revenue and runway impact.
3. Paying-customer count: break-even merchants at NGN 20,000 given verified
   costs. Report the integer break-even point.
4. Price: repeat base at NGN 10,000 and NGN 30,000 (the PRD candidate band)
   with identical costs. Report margin and break-even for each.
5. FX: move NGN/USD by +/-20% with USD costs fixed. Report margin impact.

## 10. What to enter into cfo.ai (checklist)

- [ ] Subscription price NGN 20,000 (mark unvalidated).
- [ ] Merchant counts 20 / 50 / 150 (mark unvalidated, not customers).
- [ ] 80 cases per merchant per month (mark unvalidated).
- [ ] Verified Groq, DeepSeek, fallback USD per-1M-token prices with source + date.
- [ ] Token planning figures (500 in / 200 out per call, 4 calls per case) marked estimated.
- [ ] EC2, Neon, neatlogs, Entire, cfo.ai, messaging, incidental lines with bills.
- [ ] FX rate with source + date.
- [ ] Fixed expenses and cash on hand.
- [ ] Three scenarios + five sensitivity runs above.

## 11. Explicit non-claims

- No paying merchants exist today. All counts are hypotheses.
- No revenue has been collected. All revenue figures are projections.
- Token figures are estimates. No production metering exists yet.
- Provider prices in this file are placeholders until verified on vendor pages.
- GMV and courier charges are never revenue.
