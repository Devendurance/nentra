import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import {
  agentRoleDefinitions,
  runFulfillmentAgent,
  runInvestigatorAgent,
  runRecoveryAgent,
} from "@/agents";

type CompletionBody = {
  model: string;
  messages: Array<{ role: string; content: string }>;
  response_format: {
    type: string;
    json_schema: { name: string; strict: boolean; schema: Record<string, unknown> };
  };
};

const openServers: Server[] = [];

async function mockOpenAI(contents: string[], status = 200) {
  const requests: CompletionBody[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as CompletionBody);
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
    expect(server.requests[0]?.response_format.json_schema.strict).toBe(true);
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
});
