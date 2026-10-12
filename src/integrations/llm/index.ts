import OpenAI from "openai";
import { z } from "zod";

import type { createNeatlogsIntegration } from "@/integrations/neatlogs";

export type LlmEnvironment = {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_TIMEOUT_MS?: string;
};

export type LlmConfig = {
  apiKey: string;
  model: string;
  timeoutMs: number;
  baseURL?: string;
};

const DEFAULT_OPENAI_TIMEOUT_MS = 8_000;
const MIN_OPENAI_TIMEOUT_MS = 250;
const MAX_OPENAI_TIMEOUT_MS = 120_000;

function resolveOpenAITimeout(value: string | undefined): number {
  if (!value?.trim()) return DEFAULT_OPENAI_TIMEOUT_MS;
  const timeout = Number(value);
  return Number.isSafeInteger(timeout)
    && timeout >= MIN_OPENAI_TIMEOUT_MS
    && timeout <= MAX_OPENAI_TIMEOUT_MS
    ? timeout
    : DEFAULT_OPENAI_TIMEOUT_MS;
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
    timeoutMs: resolveOpenAITimeout(env.OPENAI_TIMEOUT_MS),
    ...(baseURL ? { baseURL } : {}),
  };
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
  schemaName: string;
  instructions: string;
  input: unknown;
  outputSchema: TSchema;
}): Promise<z.infer<TSchema>> {
  const response = await input.client.chat.completions.create({
    model: input.model,
    messages: [
      { role: "system", content: input.instructions },
      { role: "user", content: JSON.stringify(input.input) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: input.schemaName,
        strict: true,
        schema: toOpenAIStructuredSchema(input.outputSchema),
      },
    },
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
