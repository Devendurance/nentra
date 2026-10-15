import { HttpError } from "@/server/api/errors";
import { mutationRateLimiter } from "@/server/api/rate-limit";
import { handleApiRoute, parseRequestBody } from "@/server/api/route-handler";
import { caseRouteParamsSchema, parseInput, refreshApprovalInputSchema } from "@/server/api/schemas";
import { requireOperator } from "@/server/auth/operator";
import { getDb } from "@/server/db/client";
import { DemoRepository } from "@/server/db/repository";
import { SandboxShippingAdapter } from "@/integrations/shipping";

type RouteContext = { params: Promise<{ caseId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApiRoute(async () => {
    requireOperator(request.headers);
    const params = parseInput(caseRouteParamsSchema, await context.params);
    if (!mutationRateLimiter.consume(`approval-refresh:${params.caseId}`).allowed) {
      throw new HttpError(429, "RATE_LIMITED", "Too many mutation requests. Try again shortly.");
    }
    const input = await parseRequestBody(request, refreshApprovalInputSchema);
    const repository = new DemoRepository(getDb());
    const snapshot = await repository.getCaseSnapshot(params.caseId);
    if (!snapshot) throw new HttpError(404, "CASE_NOT_FOUND", "Case was not found.");
    const adapter = new SandboxShippingAdapter(repository, { maxShippingNgn: snapshot.merchant.maxShippingNgn });
    const refreshed = await repository.refreshApprovalQuote(params.caseId, {
      expectedVersion: input.expectedVersion,
      requestQuote: (route) => adapter.getQuotes({
        caseId: params.caseId,
        orderId: snapshot.order.id,
        route,
        currency: "NGN",
        origin: { area: snapshot.order.originArea, state: "Lagos", countryCode: "NG" },
        destination: { area: snapshot.order.destinationArea, state: "Lagos", countryCode: "NG" },
        parcel: { description: "Fictional retail order", weightGrams: 1_500 },
      }).then((quote) => ({
        id: quote.id,
        providerCode: quote.providerCode,
        serviceCode: quote.serviceCode,
        amountNgn: quote.amountNgn,
        expiresAt: quote.expiresAt,
      })),
    });
    const events = await repository.listCaseEvents(params.caseId, 0);
    return Response.json({
      case: refreshed,
      caseId: refreshed.id,
      state: refreshed.status,
      version: refreshed.version,
      after: events.at(-1)?.seq ?? 0,
    });
  });
}
