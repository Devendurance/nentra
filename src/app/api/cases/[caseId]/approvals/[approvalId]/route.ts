import { HttpError } from "@/server/api/errors";
import { mutationRateLimiter } from "@/server/api/rate-limit";
import { handleApiRoute, parseRequestBody } from "@/server/api/route-handler";
import { approvalInputSchema, approvalRouteParamsSchema, parseInput } from "@/server/api/schemas";
import { requireOperator } from "@/server/auth/operator";
import { getDb } from "@/server/db/client";
import { DemoRepository } from "@/server/db/repository";

type RouteContext = { params: Promise<{ caseId: string; approvalId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApiRoute(async () => {
    requireOperator(request.headers);
    const params = parseInput(approvalRouteParamsSchema, await context.params);
    if (!mutationRateLimiter.consume(`approval:${params.caseId}`).allowed) {
      throw new HttpError(429, "RATE_LIMITED", "Too many mutation requests. Try again shortly.");
    }
    const input = await parseRequestBody(request, approvalInputSchema);
    const snapshot = await new DemoRepository(getDb()).decideApproval(
      params.caseId,
      params.approvalId,
      input,
    );
    const events = await new DemoRepository(getDb()).listCaseEvents(params.caseId, 0);
    return Response.json({
      case: snapshot,
      caseId: snapshot.id,
      state: snapshot.status,
      version: snapshot.version,
      after: events.at(-1)?.seq ?? 0,
    });
  });
}
