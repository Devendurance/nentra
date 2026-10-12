import { HttpError } from "@/server/api/errors";
import { cursorSchema, caseRouteParamsSchema, parseInput } from "@/server/api/schemas";
import { DemoRepository } from "@/server/db/repository";
import { getDb } from "@/server/db/client";
import { getFictionalCase, handleApiRoute } from "@/server/api/route-handler";

type RouteContext = { params: Promise<{ caseId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handleApiRoute(async () => {
    const params = parseInput(caseRouteParamsSchema, await context.params);
    const url = new URL(request.url);
    const rawAfter = url.searchParams.get("after") ?? "0";
    const after = cursorSchema.safeParse(rawAfter);
    if (!after.success) throw new HttpError(422, "INVALID_CURSOR", "The event cursor is invalid.");

    await getFictionalCase(params.caseId);
    const events = await new DemoRepository(getDb()).listCaseEvents(params.caseId, after.data);
    return Response.json({
      caseId: params.caseId,
      events,
      after: events.at(-1)?.seq ?? after.data,
    });
  });
}
