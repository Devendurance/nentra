import { DemoRepository } from "@/server/db/repository";
import { getDb } from "@/server/db/client";
import { getFictionalCase, handleApiRoute } from "@/server/api/route-handler";
import { caseRouteParamsSchema, parseInput } from "@/server/api/schemas";

type RouteContext = { params: Promise<{ caseId: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApiRoute(async () => {
    const params = parseInput(caseRouteParamsSchema, await context.params);
    await getFictionalCase(params.caseId);
    const evidence = await new DemoRepository(getDb()).listCaseEvidence(params.caseId);
    return Response.json({ caseId: params.caseId, evidence });
  });
}
