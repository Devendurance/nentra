import { handleApiRoute } from "@/server/api/route-handler";
import { HttpError } from "@/server/api/errors";
import { getDb } from "@/server/db/client";
import { DemoRepository } from "@/server/db/repository";
import { processWhatsappWebhook } from "@/server/whatsapp/inbound";
import { verifyWebhookChallenge } from "@/integrations/whatsapp/webhook";

export async function GET(request: Request): Promise<Response> {
  return handleApiRoute(async () => {
    const url = new URL(request.url);
    const verifyToken = (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "").trim();
    const challenge = verifyWebhookChallenge(url, verifyToken);
    if (!challenge.ok) {
      throw new HttpError(403, "WEBHOOK_VERIFY_FAILED", "Webhook verification failed.");
    }
    return new Response(challenge.challenge, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleApiRoute(async () => {
    const rawBody = Buffer.from(await request.arrayBuffer());
    const signature = request.headers.get("x-hub-signature-256");
    const result = await processWhatsappWebhook({
      repository: new DemoRepository(getDb()),
      rawBody,
      signature,
      env: process.env,
    });
    return Response.json({ received: result.acknowledged });
  });
}
