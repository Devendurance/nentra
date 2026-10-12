import { randomBytes } from "node:crypto";

import { HttpError } from "@/server/api/errors";
import { mutationRateLimiter } from "@/server/api/rate-limit";
import { handleApiRoute, parseRequestBody } from "@/server/api/route-handler";
import { resetInputSchema } from "@/server/api/schemas";
import { requireOperator } from "@/server/auth/operator";
import { getDb } from "@/server/db/client";
import { DemoRepository } from "@/server/db/repository";

export async function POST(request: Request): Promise<Response> {
  return handleApiRoute(async () => {
    requireOperator(request.headers);
    const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const client = forwardedFor || request.headers.get("x-real-ip") || "unknown";
    if (!mutationRateLimiter.consume(`reset:${client}`).allowed) {
      throw new HttpError(429, "RATE_LIMITED", "Too many mutation requests. Try again shortly.");
    }
    await parseRequestBody(request, resetInputSchema);
    const repository = new DemoRepository(getDb());
    const correctionToken = randomBytes(32).toString("base64url");
    const fixture = await repository.resetAndSeed({ correctionToken });
    const snapshot = await repository.getCaseSnapshot(fixture.caseId);
    if (!snapshot) throw new HttpError(500, "CASE_SEED_FAILED", "The fictional demo case was not available after reset.");
    return Response.json({
      case: snapshot,
      caseId: snapshot.id,
      state: snapshot.status,
      version: snapshot.version,
      after: 0,
      correctionToken,
    });
  });
}
