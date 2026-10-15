import { HttpError } from "@/server/api/errors";
import { mutationRateLimiter } from "@/server/api/rate-limit";
import { handleApiRoute, parseRequestBody } from "@/server/api/route-handler";
import { smokeCaseInputSchema } from "@/server/api/schemas";
import { requireOperator } from "@/server/auth/operator";
import { getDb } from "@/server/db/client";
import { DemoRepository } from "@/server/db/repository";

/**
 * Operator-only append-only smoke-case creation. Never resets, deletes,
 * or modifies existing cases. Restricted to the NG-2049 fixture.
 */
export async function POST(request: Request): Promise<Response> {
  return handleApiRoute(async () => {
    requireOperator(request.headers);
    if (!mutationRateLimiter.consume("smoke-case:operator").allowed) {
      throw new HttpError(429, "RATE_LIMITED", "Too many mutation requests. Try again shortly.");
    }
    const input = await parseRequestBody(request, smokeCaseInputSchema);
    const repository = new DemoRepository(getDb());
    const fixture = await repository.createSmokeCase(input);
    const snapshot = await repository.getCaseSnapshot(fixture.caseId);
    if (!snapshot) throw new HttpError(500, "SMOKE_CASE_FAILED", "The smoke case was not available after creation.");
    return Response.json({
      case: snapshot,
      caseId: snapshot.id,
      state: snapshot.status,
      version: snapshot.version,
      created: fixture.created,
    });
  });
}
