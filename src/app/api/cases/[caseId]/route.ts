import { caseRouteParamsSchema, parseInput } from "@/server/api/schemas";
import { getFictionalCase, handleApiRoute } from "@/server/api/route-handler";

type RouteContext = { params: Promise<{ caseId: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApiRoute(async () => {
    const params = parseInput(caseRouteParamsSchema, await context.params);
    const snapshot = await getFictionalCase(params.caseId);
    return Response.json({
      case: snapshot,
      caseId: snapshot.id,
      state: snapshot.status,
      version: snapshot.version,
    });
  });
}
