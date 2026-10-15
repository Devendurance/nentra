export interface TelegramSendConfig {
  botToken: string;
  botUsername: string;
  timeoutMs: number;
}

export interface TelegramDisabledConfig {
  ok: false;
  reason:
    | "TELEGRAM_DISABLED"
    | "TELEGRAM_BOT_TOKEN_MISSING"
    | "TELEGRAM_BOT_USERNAME_MISSING";
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function telegramApiUrl(botToken: string, method: string): string {
  return `https://api.telegram.org/bot${botToken}/${method}`;
}

export function resolveTelegramConfig(
  env: NodeJS.ProcessEnv = process.env,
): { ok: true; config: TelegramSendConfig } | TelegramDisabledConfig {
  if ((env.TELEGRAM_ENABLED ?? "").trim().toLowerCase() !== "true") {
    return { ok: false, reason: "TELEGRAM_DISABLED" };
  }
  const botToken = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!botToken) {
    return { ok: false, reason: "TELEGRAM_BOT_TOKEN_MISSING" };
  }
  const botUsername = (env.TELEGRAM_BOT_USERNAME ?? "").trim().replace(/^@/, "");
  if (!botUsername) {
    return { ok: false, reason: "TELEGRAM_BOT_USERNAME_MISSING" };
  }
  const timeoutRaw = Number.parseInt((env.TELEGRAM_TIMEOUT_MS ?? "").trim(), 10);
  const timeoutMs = Number.isSafeInteger(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_TIMEOUT_MS;
  return { ok: true, config: { botToken, botUsername, timeoutMs } };
}

export function buildTelegramCorrectionBody(orderNumber: string): string {
  return (
    `Nentra: Order ${orderNumber} needs a delivery landmark. ` +
    `Reply LANDMARK: followed by your landmark.`
  );
}

export type TelegramMessageSender = (input: {
  chatId: string;
  text: string;
}) => Promise<{ messageId: number }>;

export type TelegramSendResult =
  | { outcome: "SENT"; messageId: number }
  | { outcome: "TRANSIENT_SEND"; errorCode: string; statusCode?: number }
  | { outcome: "PERMANENT_SEND"; errorCode: string; statusCode?: number }
  | { outcome: "UNKNOWN_SEND"; errorCode: string };

function telegramErrorCode(statusCode: number | undefined, telegramCode: unknown): string {
  if (typeof telegramCode === "number" || typeof telegramCode === "string") {
    return `TELEGRAM_${String(telegramCode)}`;
  }
  if (statusCode !== undefined) return `TELEGRAM_HTTP_${statusCode}`;
  return "TELEGRAM_TRANSPORT_ERROR";
}

export function createTelegramMessageSender(config: TelegramSendConfig): TelegramMessageSender {
  return async (input) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(telegramApiUrl(config.botToken, "sendMessage"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: input.chatId, text: input.text }),
        signal: controller.signal,
      });
      let payload: { ok?: boolean; result?: { message_id?: unknown }; error_code?: unknown } = {};
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        return { messageId: NaN };
      }
      if (!payload.ok || typeof payload.result?.message_id !== "number") {
        const statusCode = response.status;
        const errorCode = telegramErrorCode(statusCode, payload.error_code);
        if (statusCode === 429 || statusCode >= 500) {
          throw Object.assign(new Error("Telegram send transiently failed."), { transient: true, errorCode, statusCode });
        }
        throw Object.assign(new Error("Telegram send rejected."), { transient: false, errorCode, statusCode });
      }
      return { messageId: payload.result.message_id };
    } catch (error) {
      if (error instanceof Error && "transient" in error) throw error;
      throw Object.assign(new Error("Telegram send transport failed."), { transport: true });
    } finally {
      clearTimeout(timer);
    }
  };
}

export async function sendTelegramCorrectionMessage(
  config: TelegramSendConfig,
  request: { chatId: string; orderNumber: string },
  sender: TelegramMessageSender = createTelegramMessageSender(config),
): Promise<TelegramSendResult> {
  if (!/^-?\d{1,20}$/.test(request.chatId)) {
    return { outcome: "PERMANENT_SEND", errorCode: "INVALID_RECIPIENT" };
  }
  try {
    const { messageId } = await sender({ chatId: request.chatId, text: buildTelegramCorrectionBody(request.orderNumber) });
    if (!Number.isSafeInteger(messageId)) {
      return { outcome: "UNKNOWN_SEND", errorCode: "SEND_RESPONSE_UNREADABLE" };
    }
    return { outcome: "SENT", messageId };
  } catch (error) {
    if (typeof error === "object" && error !== null && "transport" in error) {
      return { outcome: "UNKNOWN_SEND", errorCode: "TRANSPORT_ERROR" };
    }
    if (typeof error === "object" && error !== null && "transient" in error) {
      const typed = error as { transient?: boolean; errorCode?: string; statusCode?: number };
      return {
        outcome: typed.transient ? "TRANSIENT_SEND" : "PERMANENT_SEND",
        errorCode: typeof typed.errorCode === "string" ? typed.errorCode : "TELEGRAM_UNKNOWN_ERROR",
        statusCode: typed.statusCode,
      };
    }
    return { outcome: "UNKNOWN_SEND", errorCode: "TRANSPORT_ERROR" };
  }
}
