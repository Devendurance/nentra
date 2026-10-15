import { handleApiRoute } from "@/server/api/route-handler";
import { getDb } from "@/server/db/client";
import { DemoRepository } from "@/server/db/repository";
import { processTelegramUpdate } from "@/server/telegram/inbound";

export async function POST(request: Request): Promise<Response> {
  return handleApiRoute(async () => {
    const rawBody = Buffer.from(await request.arrayBuffer());
    const secret = request.headers.get("x-telegram-bot-api-secret-token");
    await processTelegramUpdate({
      repository: new DemoRepository(getDb()),
      rawBody,
      secret,
      env: process.env,
    });
    return Response.json({ ok: true });
  });
}
