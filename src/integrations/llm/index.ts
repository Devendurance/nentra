import OpenAI from "openai";
import { z } from "zod";

import type { createNeatlogsIntegration } from "@/integrations/neatlogs";

export type LlmEnvironment = {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_TIMEOUT_MS?: string;
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  GROQ_BASE_URL?: string;
  GROQ_TIMEOUT_MS?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_TIMEOUT_MS?: string;
};

export type LlmProvider = "openai-compatible" | "groq" | "deepseek";
export type SpecialistRole = "investigator" | "fulfillment" | "recovery";

export type LlmConfig = {
  apiKey: string;
  model: string;
  timeoutMs: number;
  provider: LlmProvider;
  structuredOutput: "json_schema" | "json_object";
  baseURL?: string;
};

const DEFAULT_OPENAI_TIMEOUT_MS = 8_000;
const DEFAULT_GROQ_TIMEOUT_MS = 10_000;
const DEFAULT_DEEPSEEK_TIMEOUT_MS = 20_000;
const MIN_PROVIDER_TIMEOUT_MS = 250;
const MAX_PROVIDER_TIMEOUT_MS = 120_000;
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-flash";
const MAX_OUTPUT_TOKENS = 512;

function resolveTimeout(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const timeout = Number(value);
  return Number.isSafeInteger(timeout)
    && timeout >= MIN_PROVIDER_TIMEOUT_MS
    && timeout <= MAX_PROVIDER_TIMEOUT_MS
    ? timeout
    : fallback;
}

export type NeatlogsIntegration = ReturnType<typeof createNeatlogsIntegration>;

export function resolveLlmConfig(env: LlmEnvironment): LlmConfig | undefined {
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_MODEL?.trim();
  if (!apiKey || !model) return undefined;
  const baseURL = env.OPENAI_BASE_URL?.trim();
  return {
    apiKey,
    model,
    timeoutMs: resolveTimeout(env.OPENAI_TIMEOUT_MS, DEFAULT_OPENAI_TIMEOUT_MS),
    provider: "openai-compatible",
    structuredOutput: "json_schema",
    ...(baseURL ? { baseURL } : {}),
  };
}

export function resolveAgentLlmConfig(role: SpecialistRole, env: LlmEnvironment): LlmConfig | undefined {
  if (role === "recovery") {
    const apiKey = env.DEEPSEEK_API_KEY?.trim();
    if (apiKey) {
      return {
        apiKey,
        model: env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL,
        timeoutMs: resolveTimeout(env.DEEPSEEK_TIMEOUT_MS, DEFAULT_DEEPSEEK_TIMEOUT_MS),
        provider: "deepseek",
        structuredOutput: "json_object",
        baseURL: env.DEEPSEEK_BASE_URL?.trim() || DEEPSEEK_BASE_URL,
      };
    }
  } else {
    const apiKey = env.GROQ_API_KEY?.trim();
    if (apiKey) {
      return {
        apiKey,
        model: env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL,
        timeoutMs: resolveTimeout(env.GROQ_TIMEOUT_MS, DEFAULT_GROQ_TIMEOUT_MS),
        provider: "groq",
        structuredOutput: "json_schema",
        baseURL: env.GROQ_BASE_URL?.trim() || GROQ_BASE_URL,
      };
    }
  }

  // Keep existing OPENAI_* deployments working as a role-independent fallback.
  return resolveLlmConfig(env);
}

export function createOpenAICompatibleClient(config: LlmConfig, telemetry: NeatlogsIntegration): OpenAI {
  const client = new OpenAI({
    apiKey: config.apiKey,
    timeout: config.timeoutMs,
    maxRetries: 0,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });
  return telemetry.wrapOpenAI(client);
}

type JsonSchema = Record<string, unknown>;

function closeObjectSchemas(schema: JsonSchema): JsonSchema {
  const closed: JsonSchema = { ...schema };
  if (closed.type === "object") {
    closed.additionalProperties = false;
    if (closed.properties && typeof closed.properties === "object" && !Array.isArray(closed.properties)) {
      closed.properties = Object.fromEntries(
        Object.entries(closed.properties as Record<string, JsonSchema>).map(([key, value]) => [key, closeObjectSchemas(value)]),
      );
    }
  }
  for (const key of ["items", "anyOf", "oneOf", "allOf"] as const) {
    const value = closed[key];
    if (Array.isArray(value)) closed[key] = value.map((entry) => closeObjectSchemas(entry as JsonSchema));
    else if (value && typeof value === "object") closed[key] = closeObjectSchemas(value as JsonSchema);
  }
  return closed;
}

export function toOpenAIStructuredSchema(schema: z.ZodType): JsonSchema {
  const jsonSchema = z.toJSONSchema(schema) as JsonSchema;
  delete jsonSchema.$schema;
  return closeObjectSchemas(jsonSchema);
}

export class StructuredResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StructuredResponseError";
  }
}

export async function requestStructuredOutput<TSchema extends z.ZodType>(input: {
  client: OpenAI;
  model: string;
  provider?: LlmProvider;
  schemaName: string;
  instructions: string;
  input: unknown;
  outputSchema: TSchema;
}): Promise<z.infer<TSchema>> {
  const provider = input.provider ?? "openai-compatible";
  const schema = toOpenAIStructuredSchema(input.outputSchema);
  const instructions = provider === "deepseek"
    ? [
      input.instructions,
      "Return exactly one valid JSON object and no Markdown or surrounding text.",
      "The JSON object must match this schema:",
      JSON.stringify(schema),
    ].join(" ")
    : input.instructions;
  const responseFormat = provider === "deepseek"
    ? { type: "json_object" as const }
    : {
      type: "json_schema" as const,
      json_schema: { name: input.schemaName, strict: true, schema },
    };
  const outputBound = provider === "deepseek"
    ? { max_tokens: MAX_OUTPUT_TOKENS }
    : { max_completion_tokens: MAX_OUTPUT_TOKENS };

  const response = await input.client.chat.completions.create({
    model: input.model,
    messages: [
      { role: "system", content: instructions },
      { role: "user", content: JSON.stringify(input.input) },
    ],
    ...outputBound,
    response_format: responseFormat,
    temperature: 0,
  });

  const message = response.choices[0]?.message;
  if (!message?.content || message.refusal) {
    throw new StructuredResponseError("The model did not return structured decision content.");
  }

  let value: unknown;
  try {
    value = JSON.parse(message.content);
  } catch {
    throw new StructuredResponseError("The model returned malformed structured decision content.");
  }

  try {
    return input.outputSchema.parse(value);
  } catch {
    throw new StructuredResponseError("The model response did not match the required decision schema.");
  }
}
