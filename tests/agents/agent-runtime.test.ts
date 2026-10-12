import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import {
  agentRoleDefinitions,
  runFulfillmentAgent,
  runInvestigatorAgent,
  runRecoveryAgent,
} from "@/agents";
import { resolveAgentLlmConfig } from "@/integrations/llm";

type CompletionBody = {
  model: string;
  messages: Array<{ role: string; content: string }>;
  response_format: {
    type: string;
    json_schema?: { name: string; strict: boolean; schema: Record<string, unknown> };
  };
  max_tokens?: number;
  max_completion_tokens?: number;
};

const openServers: Server[] = [];

async function mockOpenAI(contents: string[], status = 200) {
  const requests: CompletionBody[] = [];
  const authorizations: Array<string | undefined> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as CompletionBody);
    authorizations.push(request.headers.authorization);
    response.writeHead(status, { "content-type": "application/json" });
    if (status >= 400) {
      response.end(JSON.stringify({ error: { message: "controlled upstream error" } }));
      return;
    }
    response.end(JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 1,
      model: requests.at(-1)?.model,
      choices: [{
        index: 0,
        message: { role: "assistant", content: contents.shift() ?? "{}" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  openServers.push(server);
  const address = server.address() as AddressInfo;
  return {
    requests,
    authorizations,
    env: {
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "test-model",
      OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      NEATLOGS_API_KEY: "",
    },
  };
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("specialist agents", () => {
  it("uses distinct role instructions and capability allowlists", () => {
    const investigator = agentRoleDefinitions.investigator;
    const fulfillment = agentRoleDefinitions.fulfillment;
    const recovery = agentRoleDefinitions.recovery;

    expect(new Set([investigator.instructions, fulfillment.instructions, recovery.instructions]).size).toBe(3);
    expect(investigator.allowedTools).toEqual(["read_order_context", "read_address_requirements"]);
    expect(fulfillment.allowedTools).toEqual(["read_shipping_quotes", "read_shipping_policy"]);
    expect(recovery.allowedTools).toEqual(["read_tool_failure", "read_eligible_fallbacks"]);
    expect([investigator, fulfillment, recovery].every((role) => role.instructions.includes("chain-of-thought"))).toBe(true);
  });

  it("runs deterministic decisions only when model credentials are absent", async () => {
    const investigation = await runInvestigatorAgent({
      caseId: "case-1",
      runId: "run-1",
      taskId: "task-1",
      orderId: "order-1",
      addressCompleteness: { street: true, area: true, landmark: false, city: true, state: true },
    }, { env: {} });

    expect(investigation).toEqual({
      mode: "deterministic",
      output: {
        missingFields: ["landmark"],
        blockers: ["ADDRESS_INCOMPLETE"],
        nextAction: "REQUEST_CUSTOMER_INPUT",
        summary: "Required delivery details are missing: landmark.",
      },
    });

    const fulfillment = await runFulfillmentAgent({
      caseId: "case-1",
      runId: "run-1",
      taskId: "task-2",
      orderId: "order-1",
      maxShippingNgn: 4000,
      quotes: [
        { quoteOptionId: "quote-slow", courier: "Courier A", service: "standard", amountNgn: 3500, eligible: true },
        { quoteOptionId: "quote-fast", courier: "Courier B", service: "express", amountNgn: 5000, eligible: true },
      ],
    }, { env: { OPENAI_API_KEY: "", OPENAI_MODEL: "test-model" } });

    expect(fulfillment.mode).toBe("deterministic");
    expect(fulfillment.output.selectedQuoteOptionId).toBe("quote-slow");

    const recovery = await runRecoveryAgent({
      caseId: "case-1",
      runId: "run-1",
      taskId: "task-3",
      failedTool: "shipping_quotes",
      errorCode: "UPSTREAM_UNAVAILABLE",
      isTransient: true,
      remainingAdditionalAttempts: 2,
      eligibleFallbackQuoteOptionIds: ["quote-backup"],
    }, { env: { OPENAI_API_KEY: "test-key" } });

    expect(recovery.mode).toBe("deterministic");
    expect(recovery.output.action).toBe("RETRY");
  });

  it("uses the OpenAI-compatible structured-output API and validates its response", async () => {
    const server = await mockOpenAI([JSON.stringify({
      missingFields: [],
      blockers: ["NONE"],
      nextAction: "EVALUATE_QUOTES",
      summary: "Required delivery details are present.",
    })]);
    const result = await runInvestigatorAgent({
      caseId: "case-2",
      runId: "run-2",
      taskId: "task-4",
      orderId: "order-2",
      addressCompleteness: { street: true, area: true, landmark: true, city: true, state: true },
    }, { env: server.env });

    expect(result.mode).toBe("llm");
    expect(result.model).toBe("test-model");
    expect(result.output.nextAction).toBe("EVALUATE_QUOTES");
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.model).toBe("test-model");
    expect(server.requests[0]?.response_format.type).toBe("json_schema");
    expect(server.requests[0]?.response_format.json_schema?.strict).toBe(true);
    expect(server.requests[0]?.max_completion_tokens).toBeLessThanOrEqual(512);
    expect(server.requests[0]?.messages[0]?.content.toLowerCase()).toContain("investigator");
    expect(server.requests[0]?.messages[0]?.content).toContain("read_address_requirements");
  });

  it("does not switch to deterministic behavior after an LLM request fails", async () => {
    const server = await mockOpenAI([], 503);

    await expect(runInvestigatorAgent({
      caseId: "case-3",
      runId: "run-3",
      taskId: "task-5",
      orderId: "order-3",
      addressCompleteness: { street: true, area: true, landmark: false, city: true, state: true },
    }, { env: server.env })).rejects.toThrow();
    expect(server.requests.length).toBeGreaterThan(0);
  });

  it("rejects LLM recommendations outside the provided policy facts", async () => {
    const server = await mockOpenAI([JSON.stringify({
      rankedQuoteOptionIds: ["invented-quote"],
      selectedQuoteOptionId: "invented-quote",
      nextAction: "SELECT_QUOTE",
      summary: "Selected a quote.",
    })]);

    await expect(runFulfillmentAgent({
      caseId: "case-4",
      runId: "run-4",
      taskId: "task-6",
      orderId: "order-4",
      maxShippingNgn: 4000,
      quotes: [{ quoteOptionId: "quote-valid", courier: "Courier A", service: "standard", amountNgn: 3000, eligible: true }],
    }, { env: server.env })).rejects.toThrow(/quote/i);
  });

  it("routes specialist roles to Groq and DeepSeek and uses provider-specific structured output", async () => {
    const server = await mockOpenAI([
      JSON.stringify({
        missingFields: [],
        blockers: ["NONE"],
        nextAction: "EVALUATE_QUOTES",
        summary: "The required delivery fields are present.",
      }),
      JSON.stringify({
        rankedQuoteOptionIds: ["quote-a"],
        selectedQuoteOptionId: "quote-a",
        nextAction: "SELECT_QUOTE",
        summary: "The supplied quote is within the ceiling.",
      }),
      JSON.stringify({
        action: "FALLBACK",
        maxAdditionalAttempts: null,
        quoteOptionId: "quote-backup",
        reason: "The persisted eligible fallback is available.",
      }),
    ]);
    const env = {
      GROQ_API_KEY: "groq-secret-test-value",
      GROQ_MODEL: "groq-model-test",
      GROQ_BASE_URL: server.env.OPENAI_BASE_URL,
      DEEPSEEK_API_KEY: "deepseek-secret-test-value",
      DEEPSEEK_MODEL: "deepseek-model-test",
      DEEPSEEK_BASE_URL: server.env.OPENAI_BASE_URL,
      OPENAI_API_KEY: "legacy-secret-test-value",
      OPENAI_MODEL: "legacy-model-test",
      NEATLOGS_API_KEY: "",
    };

    const investigator = await runInvestigatorAgent({
      caseId: "case-provider",
      runId: "run-provider",
      taskId: "task-investigator",
      orderId: "order-provider",
      addressCompleteness: { street: true, area: true, landmark: true, city: true, state: true },
    }, { env });
    const fulfillment = await runFulfillmentAgent({
      caseId: "case-provider",
      runId: "run-provider",
      taskId: "task-fulfillment",
      orderId: "order-provider",
      maxShippingNgn: 4_000,
      quotes: [{ quoteOptionId: "quote-a", courier: "Courier A", service: "standard", amountNgn: 3_500, eligible: true }],
    }, { env });
    const recovery = await runRecoveryAgent({
      caseId: "case-provider",
      runId: "run-provider",
      taskId: "task-recovery",
      failedTool: "shipping_quotes",
      errorCode: "UPSTREAM_UNAVAILABLE",
      isTransient: true,
      remainingAdditionalAttempts: 0,
      eligibleFallbackQuoteOptionIds: ["quote-backup"],
    }, { env });

    expect([investigator.provider, fulfillment.provider, recovery.provider]).toEqual(["groq", "groq", "deepseek"]);
    expect([investigator.model, fulfillment.model, recovery.model]).toEqual([
      "groq-model-test",
      "groq-model-test",
      "deepseek-model-test",
    ]);
    expect(server.requests).toHaveLength(3);
    expect(server.requests[0]?.response_format.type).toBe("json_schema");
    expect(server.requests[0]?.response_format.json_schema?.strict).toBe(true);
    expect(server.requests[1]?.response_format.type).toBe("json_schema");
    expect(server.requests[2]?.response_format).toEqual({ type: "json_object" });
    expect(server.requests[2]?.max_tokens).toBe(512);
    expect(server.requests[2]?.messages[0]?.content).toContain("Return exactly one valid JSON object");
    expect(server.requests[2]?.messages[0]?.content).toContain('"properties"');
    const requestBodies = JSON.stringify(server.requests);
    expect(requestBodies).not.toContain("groq-secret-test-value");
    expect(requestBodies).not.toContain("deepseek-secret-test-value");
    expect(requestBodies).not.toContain("legacy-secret-test-value");
    expect(server.authorizations).toEqual([
      "Bearer groq-secret-test-value",
      "Bearer groq-secret-test-value",
      "Bearer deepseek-secret-test-value",
    ]);
  });

  it("uses documented defaults, provider timeouts, and the OPENAI_* compatibility fallback", () => {
    expect(resolveAgentLlmConfig("investigator", { GROQ_API_KEY: "groq-test" })).toMatchObject({
      provider: "groq",
      model: "openai/gpt-oss-20b",
      baseURL: "https://api.groq.com/openai/v1",
      structuredOutput: "json_schema",
      timeoutMs: 10_000,
    });
    expect(resolveAgentLlmConfig("fulfillment", { GROQ_API_KEY: "groq-test" })?.provider).toBe("groq");
    expect(resolveAgentLlmConfig("recovery", { DEEPSEEK_API_KEY: "deepseek-test" })).toMatchObject({
      provider: "deepseek",
      model: "deepseek-flash",
      baseURL: "https://api.deepseek.com",
      structuredOutput: "json_object",
      timeoutMs: 20_000,
    });
    expect(resolveAgentLlmConfig("recovery", {
      OPENAI_API_KEY: "legacy-test",
      OPENAI_MODEL: "legacy-model",
      OPENAI_BASE_URL: "https://compat.example/v1",
    })).toMatchObject({
      provider: "openai-compatible",
      model: "legacy-model",
      baseURL: "https://compat.example/v1",
    });
  });

  it("rejects malformed or out-of-policy DeepSeek JSON instead of falling back", async () => {
    const server = await mockOpenAI([JSON.stringify({
      action: "FALLBACK",
      maxAdditionalAttempts: null,
      quoteOptionId: "invented-quote",
      reason: "Attempt a non-existent provider quote.",
    })]);
    const env = {
      DEEPSEEK_API_KEY: "deepseek-test",
      DEEPSEEK_BASE_URL: server.env.OPENAI_BASE_URL,
      NEATLOGS_API_KEY: "",
    };

    await expect(runRecoveryAgent({
      caseId: "case-deepseek-policy",
      runId: "run-deepseek-policy",
      taskId: "task-deepseek-policy",
      failedTool: "shipping_quotes",
      errorCode: "UPSTREAM_UNAVAILABLE",
      isTransient: true,
      remainingAdditionalAttempts: 0,
      eligibleFallbackQuoteOptionIds: ["quote-real"],
    }, { env })).rejects.toThrow(/fallback/i);
  });

  it("rejects malformed JSON and Zod-invalid DeepSeek output", async () => {
    const server = await mockOpenAI(["not-json", JSON.stringify({ action: "UNKNOWN" })]);
    const env = {
      DEEPSEEK_API_KEY: "deepseek-test",
      DEEPSEEK_BASE_URL: server.env.OPENAI_BASE_URL,
      NEATLOGS_API_KEY: "",
    };
    const input = {
      caseId: "case-deepseek-parse",
      runId: "run-deepseek-parse",
      taskId: "task-deepseek-parse",
      failedTool: "shipping_quotes" as const,
      errorCode: "UPSTREAM_UNAVAILABLE" as const,
      isTransient: true,
      remainingAdditionalAttempts: 0,
      eligibleFallbackQuoteOptionIds: ["quote-real"],
    };

    await expect(runRecoveryAgent(input, { env })).rejects.toThrow(/malformed structured decision content/i);
    await expect(runRecoveryAgent(input, { env })).rejects.toThrow(/required decision schema/i);
  });
});
