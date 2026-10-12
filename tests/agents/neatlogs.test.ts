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
    // Successful spans must carry an accurate output value so the trace callback
    // does not leave output.value empty. The real SDK only marks ERROR on throw.
    expect(spans.every((entry) => entry.callbackValue !== undefined)).toBe(true);
    expect(spans[0]?.callbackValue).toBe("agent result");
    expect(spans[1]?.callbackValue).toBe("tool result");
    const agentAttributes = spans[0]?.options.attributes as Record<string, unknown>;
    expect(agentAttributes).toEqual({ caseId: "case-2", runId: "run-2", taskId: "task-2" });
  });

  it("records a redacted safe summary for object results without sensitive fields", async () => {
    const { sdk, spans } = fakeSdk();
    const integration = createNeatlogsIntegration({ NEATLOGS_API_KEY: "neat-test-key" }, sdk);
    const bookingLike = {
      providerBookingId: "sbx-booking-abc123",
      amountNgn: 7200,
      providerCode: "REDSTAR_EXPRESS",
      serviceCode: "ALTERNATIVE_STANDARD",
      status: "BOOKED",
      addressLine1: "12 Allen Avenue",
      customerPhone: "+2348012345678",
      landmark: "opposite pharmacy",
    };
    const result = await integration.withTool(
      { toolName: "shipping_booking", caseId: "case-6", runId: "run-6", taskId: "task-6" },
      async () => bookingLike,
    );

    expect(result).toEqual(bookingLike);
    // The caller still receives the full operation result; only the span
    // output captured by the SDK is redacted.
    const output = spans[0]?.callbackValue as Record<string, unknown>;
    expect(output).toMatchObject({
      status: "BOOKED",
      providerBookingId: "sbx-booking-abc123",
      amountNgn: 7200,
      providerCode: "REDSTAR_EXPRESS",
    });
    expect(output).not.toHaveProperty("addressLine1");
    expect(output).not.toHaveProperty("customerPhone");
    expect(output).not.toHaveProperty("landmark");
  });

  it("keeps agent execution summaries without leaking full records", async () => {
    const { sdk, spans } = fakeSdk();
    const integration = createNeatlogsIntegration({ NEATLOGS_API_KEY: "neat-test-key" }, sdk);
    const execution = {
      output: {
        summary: "Found 1 eligible quote within the merchant ceiling.",
        selectedQuoteOptionId: "quote-123",
        addressLine1: "12 Allen Avenue",
      },
      mode: "deterministic",
      provider: "groq",
      model: "openai/gpt-oss-20b",
    };
    await integration.withAgent(
      { role: "fulfillment", caseId: "case-7", runId: "run-7", taskId: "task-7" },
      async () => execution,
    );

    const output = spans[0]?.callbackValue as Record<string, unknown>;
    expect(output).toMatchObject({
      status: "OK",
      mode: "deterministic",
      summary: "Found 1 eligible quote within the merchant ceiling.",
    });
    expect(output).not.toHaveProperty("addressLine1");
  });

  it("lets a real tool failure throw so the SDK marks that span ERROR", async () => {
    const { sdk, spans } = fakeSdk();
    const integration = createNeatlogsIntegration({ NEATLOGS_API_KEY: "neat-test-key" }, sdk);
    const failure = Object.assign(new Error("The preferred shipping route is temporarily unavailable"), {
      code: "PROVIDER_503",
    });

    await expect(integration.withTool(
      { toolName: "shipping_quotes", caseId: "case-8", runId: "run-8", taskId: "task-8" },
      async () => { throw failure; },
    )).rejects.toBe(failure);
    // The fake SDK only records completed callbacks, mirroring the real SDK:
    // a thrown callback produces an ERROR span and no success output.
    expect(spans).toHaveLength(0);
  });

  it("lets a workflow failure throw so only the failing span is marked ERROR", async () => {
    const { sdk, spans } = fakeSdk();
    const integration = createNeatlogsIntegration({ NEATLOGS_API_KEY: "neat-test-key" }, sdk);
    const failure = new Error("booking step failed");

    await expect(integration.withWorkflow(
      { caseId: "case-9", runId: "run-9" },
      async () => { throw failure; },
    )).rejects.toBe(failure);
    expect(spans).toHaveLength(0);
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
    // An undefined operation result still produces a minimal OK summary so the
    // span has an explicit output instead of an empty value.
    expect(spans[0]?.callbackValue).toEqual({ status: "OK" });
  });
});
