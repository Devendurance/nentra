import { HttpError } from "@/server/api/errors";
import { mutationRateLimiter } from "@/server/api/rate-limit";
import { handleApiRoute, parseRequestBody } from "@/server/api/route-handler";
import { cancelInputSchema, caseRouteParamsSchema, parseInput } from "@/server/api/schemas";
import { requireOperator } from "@/server/auth/operator";
import { getDb } from "@/server/db/client";
import { DemoRepository } from "@/server/db/repository";

type RouteContext = { params: Promise<{ caseId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApiRoute(async () => {
    requireOperator(request.headers);
    consumeMutationLimit(request);
    const params = parseInput(caseRouteParamsSchema, await context.params);
    const input = await parseRequestBody(request, cancelInputSchema);
    const snapshot = await new DemoRepository(getDb()).cancelCase(params.caseId, input);
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

function consumeMutationLimit(request: Request): void {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const client = forwardedFor || request.headers.get("x-real-ip") || "unknown";
  if (!mutationRateLimiter.consume(`cancel:${client}`).allowed) {
    throw new HttpError(429, "RATE_LIMITED", "Too many mutation requests. Try again shortly.");
  }
}
