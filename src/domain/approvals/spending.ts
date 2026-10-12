import { z } from "zod";

export const quoteOptionSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    provider: z.string().trim().min(1).max(100),
    serviceCode: z.string().trim().min(1).max(100),
    amountNgn: z.number().int().positive().safe(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    eligible: z.boolean(),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const spendingApprovalSchema = z
  .object({
    caseId: z.string().trim().min(1).max(128),
    quoteId: z.string().trim().min(1).max(128),
    proposalHash: z.string().trim().min(1).max(128),
    requestedCostNgn: z.number().int().positive().safe(),
    status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
  })
  .strict();

export type QuoteOption = z.infer<typeof quoteOptionSchema>;
export type SpendingApproval = z.infer<typeof spendingApprovalSchema>;

export type QuoteSpendResult =
  | { decision: "ALLOW" }
  | { decision: "REQUIRE_APPROVAL" }
  | {
      decision: "DENY";
      reason:
        | "QUOTE_INVALID"
        | "QUOTE_INELIGIBLE"
        | "QUOTE_EXPIRED"
        | "CURRENCY_UNSUPPORTED"
        | "INVALID_SPEND_POLICY"
        | "APPROVAL_REJECTED";
    };

export type EvaluateQuoteSpendInput = {
  caseId: string;
  quote: unknown;
  merchantCeilingNgn: number;
  expectedProposalHash: string;
  approval?: SpendingApproval;
  now: Date;
};

export function evaluateQuoteSpend(
  input: EvaluateQuoteSpendInput,
): QuoteSpendResult {
  const parsedQuote = quoteOptionSchema.safeParse(input.quote);
  if (!parsedQuote.success) return { decision: "DENY", reason: "QUOTE_INVALID" };

  const quote = parsedQuote.data;
  if (
    !Number.isSafeInteger(input.merchantCeilingNgn) ||
    input.merchantCeilingNgn < 0 ||
    Number.isNaN(input.now.getTime()) ||
    input.caseId.trim().length === 0 ||
    input.expectedProposalHash.trim().length === 0
  ) {
    return { decision: "DENY", reason: "INVALID_SPEND_POLICY" };
  }
  if (!quote.eligible) return { decision: "DENY", reason: "QUOTE_INELIGIBLE" };
  if (quote.currency !== "NGN") {
    return { decision: "DENY", reason: "CURRENCY_UNSUPPORTED" };
  }
  if (new Date(quote.expiresAt).getTime() <= input.now.getTime()) {
    return { decision: "DENY", reason: "QUOTE_EXPIRED" };
  }
  if (quote.amountNgn <= input.merchantCeilingNgn) {
    return { decision: "ALLOW" };
  }

  const parsedApproval = spendingApprovalSchema.safeParse(input.approval);
  if (!parsedApproval.success) return { decision: "REQUIRE_APPROVAL" };

  const approval = parsedApproval.data;
  const matchesCurrentProposal =
    approval.caseId === input.caseId &&
    approval.quoteId === quote.id &&
    approval.proposalHash === input.expectedProposalHash &&
    approval.requestedCostNgn === quote.amountNgn;

  if (!matchesCurrentProposal || approval.status === "PENDING") {
    return { decision: "REQUIRE_APPROVAL" };
  }
  if (approval.status === "REJECTED") {
    return { decision: "DENY", reason: "APPROVAL_REJECTED" };
  }

  return { decision: "ALLOW" };
}
