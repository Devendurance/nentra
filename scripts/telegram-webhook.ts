import "dotenv/config";

function requiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required in the environment.`);
  return value;
}

async function telegramCall(method: string, params: Record<string, unknown>): Promise<unknown> {
  const botToken = requiredEnv("TELEGRAM_BOT_TOKEN");
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const payload = (await response.json()) as { ok?: boolean; result?: unknown; description?: string };
  if (!payload.ok) {
    throw new Error(`Telegram API rejected ${method} with HTTP ${response.status}.`);
  }
  return payload.result;
}

function redactInfo(result: unknown): Record<string, unknown> {
  const info = (result ?? {}) as Record<string, unknown>;
  return {
    urlHost: (() => {
      try {
        return new URL(String(info.url ?? "")).hostname;
      } catch {
        return null;
      }
    })(),
    hasCustomCertificate: info.has_custom_certificate ?? null,
    pendingUpdateCount: info.pending_update_count ?? null,
    lastErrorDate: info.last_error_date ?? null,
    lastErrorPresent: info.last_error_message !== undefined && info.last_error_message !== null,
  };
}

async function main(): Promise<void> {
  const mode = (process.argv[2] ?? "").trim();
  if (mode === "set") {
    const webhookBase = requiredEnv("TELEGRAM_PUBLIC_BASE_URL").replace(/\/+$/, "");
    const secret = requiredEnv("TELEGRAM_WEBHOOK_SECRET");
    const url = `${webhookBase}/api/telegram/webhook`;
    await telegramCall("setWebhook", {
      url,
      secret_token: secret,
      allowed_updates: ["message"],
    });
    const info = await telegramCall("getWebhookInfo", {});
    process.stdout.write(`${JSON.stringify({ webhookSet: true, info: redactInfo(info) })}\n`);
    return;
  }
  if (mode === "info") {
    requiredEnv("TELEGRAM_BOT_TOKEN");
    const info = await telegramCall("getWebhookInfo", {});
    process.stdout.write(`${JSON.stringify({ info: redactInfo(info) })}\n`);
    return;
  }
  throw new Error("Usage: telegram-webhook.ts <set|info>");
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/telegram-webhook.ts")) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Telegram webhook step failed"}\n`);
    process.exitCode = 1;
  });
}
