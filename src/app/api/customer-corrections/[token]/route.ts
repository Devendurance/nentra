import { HttpError } from "@/server/api/errors";
import { mutationRateLimiter } from "@/server/api/rate-limit";
import { handleApiRoute, parseRequestBody } from "@/server/api/route-handler";
import { correctionInputSchema, correctionTokenSchema, parseInput } from "@/server/api/schemas";
import { getDb } from "@/server/db/client";
import { DemoRepository } from "@/server/db/repository";

type RouteContext = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApiRoute(async () => {
    const token = parseInput(correctionTokenSchema, (await context.params).token);
    const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const client = forwardedFor || request.headers.get("x-real-ip") || "unknown";
    if (!mutationRateLimiter.consume(`customer-correction:${client}`).allowed) {
      throw new HttpError(429, "RATE_LIMITED", "Too many correction requests. Try again shortly.");
    }
    const input = await parseRequestBody(request, correctionInputSchema);
    const snapshot = await new DemoRepository(getDb()).applyCustomerCorrection(token, input);
    const events = await new DemoRepository(getDb()).listCaseEvents(snapshot.id, 0);
    return Response.json({
      case: snapshot,
      caseId: snapshot.id,
      state: snapshot.status,
      version: snapshot.version,
      after: events.at(-1)?.seq ?? 0,
    });
  });
}
