import { HttpError } from "@/server/api/errors";
import { mutationRateLimiter } from "@/server/api/rate-limit";
import { handleApiRoute, parseRequestBody } from "@/server/api/route-handler";
import { startInputSchema, caseRouteParamsSchema, parseInput } from "@/server/api/schemas";
import { requireOperator } from "@/server/auth/operator";
import { getDb } from "@/server/db/client";
import { DemoRepository } from "@/server/db/repository";

type RouteContext = { params: Promise<{ caseId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApiRoute(async () => {
    requireOperator(request.headers);
    consumeMutationLimit(request, "start");
    const params = parseInput(caseRouteParamsSchema, await context.params);
    const input = await parseRequestBody(request, startInputSchema);
    const repository = new DemoRepository(getDb());
    let started;
    try {
      started = await repository.startCase(params.caseId, input.expectedVersion);
    } catch (error) {
      if (!(error instanceof HttpError) || error.code !== "CASE_VERSION_CONFLICT" || input.expectedVersion === undefined) {
        throw error;
      }
      const current = await repository.getCaseSnapshot(params.caseId);
      if (!current?.run || ["NEW", "CANCELLED", "RESOLVED", "ESCALATED"].includes(current.status)) {
        throw error;
      }
      started = await repository.startCase(params.caseId);
    }
    const events = await repository.listCaseEvents(params.caseId, 0);
    const body = {
      case: started.snapshot,
      caseId: started.snapshot.id,
      state: started.snapshot.status,
      version: started.snapshot.version,
      runId: started.runId,
      accepted: started.accepted,
      after: events.at(-1)?.seq ?? 0,
    };
    return Response.json(body, { status: started.accepted ? 202 : 200 });
  });
}

function consumeMutationLimit(request: Request, action: string): void {
  const key = mutationKey(request, action);
  const result = mutationRateLimiter.consume(key);
  if (!result.allowed) {
    throw new HttpError(429, "RATE_LIMITED", "Too many mutation requests. Try again shortly.");
  }
}

function mutationKey(request: Request, action: string): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const client = forwardedFor || request.headers.get("x-real-ip") || "unknown";
  return `${action}:${client}`;
}
