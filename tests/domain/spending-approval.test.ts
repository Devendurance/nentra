import { describe, expect, it } from "vitest";

import {
  evaluateQuoteSpend,
  quoteOptionSchema,
} from "@/domain/approvals/spending";

const quote = {
  id: "quote-1",
  provider: "demo-carrier",
  serviceCode: "same-day",
  amountNgn: 8_000,
  currency: "NGN",
  eligible: true,
  expiresAt: "2026-10-12T01:00:00.000Z",
};

describe("quote spending authorization", () => {
  it("allows an eligible current NGN quote within the merchant ceiling", () => {
    expect(
      evaluateQuoteSpend({
        caseId: "case-1",
        quote: quoteOptionSchema.parse(quote),
        merchantCeilingNgn: 10_000,
        expectedProposalHash: "proposal-1",
        now: new Date("2026-10-12T00:00:00.000Z"),
      }),
    ).toEqual({ decision: "ALLOW" });
  });

  it("requires exact approval for an over-ceiling quote", () => {
    const parsedQuote = quoteOptionSchema.parse({ ...quote, amountNgn: 12_000 });
    const base = {
      caseId: "case-1",
      quote: parsedQuote,
      merchantCeilingNgn: 10_000,
      expectedProposalHash: "proposal-1",
      now: new Date("2026-10-12T00:00:00.000Z"),
    } as const;

    expect(evaluateQuoteSpend(base)).toEqual({ decision: "REQUIRE_APPROVAL" });
    expect(
      evaluateQuoteSpend({
        ...base,
        approval: {
          caseId: "case-1",
          quoteId: "quote-1",
          proposalHash: "proposal-1",
          requestedCostNgn: 12_000,
          status: "APPROVED",
        },
      }),
    ).toEqual({ decision: "ALLOW" });
  });

  it("does not accept approval for a different quote, amount, or proposal", () => {
    const overCeilingQuote = quoteOptionSchema.parse({ ...quote, amountNgn: 12_000 });
    const approval = {
      caseId: "case-1",
      quoteId: "quote-1",
      proposalHash: "proposal-1",
      requestedCostNgn: 12_000,
      status: "APPROVED" as const,
    };
    const base = {
      caseId: "case-1",
      quote: overCeilingQuote,
      merchantCeilingNgn: 10_000,
      expectedProposalHash: "proposal-1",
      now: new Date("2026-10-12T00:00:00.000Z"),
    };

    expect(evaluateQuoteSpend({ ...base, approval: { ...approval, quoteId: "other-quote" } }))
      .toEqual({ decision: "REQUIRE_APPROVAL" });
    expect(
      evaluateQuoteSpend({
        ...base,
        approval: { ...approval, requestedCostNgn: 11_000 },
      }),
    ).toEqual({ decision: "REQUIRE_APPROVAL" });
    expect(
      evaluateQuoteSpend({
        ...base,
        expectedProposalHash: "new-proposal",
        approval,
      }),
    ).toEqual({ decision: "REQUIRE_APPROVAL" });
  });

  it("denies ineligible, expired, and non-NGN quotes", () => {
    const input = {
      caseId: "case-1",
      merchantCeilingNgn: 10_000,
      expectedProposalHash: "proposal-1",
      now: new Date("2026-10-12T00:00:00.000Z"),
    } as const;
    expect(
      evaluateQuoteSpend({
        ...input,
        quote: quoteOptionSchema.parse({ ...quote, eligible: false }),
      }),
    ).toEqual({ decision: "DENY", reason: "QUOTE_INELIGIBLE" });
    expect(
      evaluateQuoteSpend({
        ...input,
        quote: quoteOptionSchema.parse({
          ...quote,
          expiresAt: "2026-10-11T23:59:59.000Z",
        }),
      }),
    ).toEqual({ decision: "DENY", reason: "QUOTE_EXPIRED" });
    expect(
      evaluateQuoteSpend({
        ...input,
        quote: quoteOptionSchema.parse({ ...quote, currency: "USD" }),
      }),
    ).toEqual({ decision: "DENY", reason: "CURRENCY_UNSUPPORTED" });
  });
});
