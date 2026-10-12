import { DemoRepository } from "@/server/db/repository";
import { getDb } from "@/server/db/client";
import { handleApiRoute } from "@/server/api/route-handler";

export function GET(): Promise<Response> {
  return handleApiRoute(async () => {
    const cases = await new DemoRepository(getDb()).listCases();
    return Response.json({ cases });
  });
}
