import { describe, expect, it, vi } from "vitest";

import { createNeatlogsIntegration } from "@/integrations/neatlogs";
import type { NeatlogsSdkAdapter } from "@/integrations/neatlogs";
import type { TraceOptions } from "neatlogs";

function fakeSdk() {
  const spans: Array<{ options: Record<string, unknown>; callbackValue: unknown }> = [];
  const sdk: NeatlogsSdkAdapter = {
    init: vi.fn(async () => undefined),
    trace: vi.fn(async <T>(options: TraceOptions, callback: (span: { spanContext: () => { traceId: string } }) => T | Promise<T>) => {
      const value: T = await callback({ spanContext: () => ({ traceId: "0123456789abcdef0123456789abcdef" }) });
      spans.push({ options: options as unknown as Record<string, unknown>, callbackValue: value });
      return value;
    }) as unknown as NeatlogsSdkAdapter["trace"],
    flush: vi.fn(async () => true),
    wrapOpenAI: vi.fn(<T extends object>(client: T) => client),
  };
  return { sdk, spans };
}

describe("neatlogs integration", () => {
  it("is a real no-op and returns no trace reference when the key is absent", async () => {
    const { sdk } = fakeSdk();
    const integration = createNeatlogsIntegration({}, sdk);
    const execution = await integration.withWorkflow({ caseId: "case-1", runId: "run-1" }, async (traceRef) => ({ traceRef, result: "done" }));

    expect(execution).toEqual({ result: { traceRef: undefined, result: "done" }, traceRef: undefined });
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.trace).not.toHaveBeenCalled();
  });

  it("creates nested typed spans with safe identifiers and returns the SDK trace id", async () => {
    const { sdk, spans } = fakeSdk();
    const integration = createNeatlogsIntegration({ NEATLOGS_API_KEY: "neat-test-key" }, sdk);
    const execution = await integration.withWorkflow({ caseId: "case-2", runId: "run-2" }, async (traceRef) => {
      await integration.withAgent({ role: "investigator", caseId: "case-2", runId: "run-2", taskId: "task-2" }, async () => "agent result");
      await integration.withTool({ toolName: "read_order_context", caseId: "case-2", runId: "run-2", taskId: "task-2" }, async () => "tool result");
      return traceRef;
    });

    expect(execution.traceRef).toBe("0123456789abcdef0123456789abcdef");
    expect(execution.result).toBe(execution.traceRef);
    expect(sdk.init).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "neat-test-key",
      workflowName: "nentra-rescue",
      pii: "redact",
      captureLogs: false,
    }));
    expect(spans.map((entry) => entry.options.kind)).toEqual(["AGENT", "TOOL", "WORKFLOW"]);
    expect(spans.map((entry) => entry.options.name)).toEqual(["order_investigator", "read_order_context", "recover_pre_dispatch_order"]);
    expect(spans.every((entry) => entry.callbackValue === undefined)).toBe(true);
    const agentAttributes = spans[0]?.options.attributes as Record<string, unknown>;
    expect(agentAttributes).toEqual({ caseId: "case-2", runId: "run-2", taskId: "task-2" });
  });

  it("wraps the OpenAI client only when neatlogs is configured", async () => {
    const { sdk: disabledSdk } = fakeSdk();
    const disabled = createNeatlogsIntegration({}, disabledSdk);
    const client = {};
    expect(disabled.wrapOpenAI(client)).toBe(client);
    expect(disabledSdk.wrapOpenAI).not.toHaveBeenCalled();

    const { sdk } = fakeSdk();
    const enabled = createNeatlogsIntegration({ NEATLOGS_API_KEY: "neat-test-key" }, sdk);
    await enabled.initialize();
    expect(enabled.wrapOpenAI(client)).toBe(client);
    expect(sdk.wrapOpenAI).toHaveBeenCalledWith(client);
  });

  it("does not include invalid identifiers or untrusted labels in span metadata", async () => {
    const { sdk, spans } = fakeSdk();
    const integration = createNeatlogsIntegration({ NEATLOGS_API_KEY: "neat-test-key" }, sdk);
    await integration.withTool({
      toolName: "read_order_context\ncustomer phone 1234567890",
      caseId: "case-5",
      runId: "bad\nvalue",
      taskId: "task-5",
    }, async () => undefined);

    expect(spans[0]?.options.name).toBe("external_tool");
    expect(spans[0]?.options.attributes).toEqual({ caseId: "case-5", taskId: "task-5" });
  });
});
