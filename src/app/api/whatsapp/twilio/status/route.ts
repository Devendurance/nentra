import { handleApiRoute } from "@/server/api/route-handler";
import { getDb } from "@/server/db/client";
import { DemoRepository } from "@/server/db/repository";
import { processTwilioStatus } from "@/server/whatsapp/twilio-inbound";

export async function POST(request: Request): Promise<Response> {
  return handleApiRoute(async () => {
    const rawFormBody = await request.text();
    const signature = request.headers.get("x-twilio-signature");
    await processTwilioStatus({
      repository: new DemoRepository(getDb()),
      rawFormBody,
      signature,
      env: process.env,
    });
    return new Response("<Response/>", {
      status: 200,
      headers: { "content-type": "text/xml; charset=utf-8" },
    });
  });
}
