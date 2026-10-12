import {
  flush as sdkFlush,
  init as sdkInit,
  trace as sdkTrace,
  wrapOpenAI as sdkWrapOpenAI,
  type InitOptions,
  type TraceOptions,
} from "neatlogs";

type Environment = { NEATLOGS_API_KEY?: string };
type SpanContextLike = { spanContext(): { traceId: string } };

export type TraceIdentifiers = {
  caseId?: string;
  runId?: string;
  taskId?: string;
};

export type AgentSpanContext = TraceIdentifiers & {
  role: "investigator" | "fulfillment" | "recovery";
};

export type ToolSpanContext = TraceIdentifiers & { toolName: string };

export type NeatlogsSdkAdapter = {
  init(options?: InitOptions): Promise<void>;
  trace<T>(options: TraceOptions, callback: (span: SpanContextLike) => T | Promise<T>): Promise<T>;
  flush(): Promise<boolean>;
  wrapOpenAI<T extends object>(client: T): T;
};

export type WorkflowExecution<T> = {
  result: T;
  traceRef?: string;
};

const neatlogsSdk: NeatlogsSdkAdapter = {
  init: sdkInit,
  trace: sdkTrace as NeatlogsSdkAdapter["trace"],
  flush: sdkFlush,
  wrapOpenAI: sdkWrapOpenAI,
};

const roleDetails = {
  investigator: {
    name: "order_investigator",
    goal: "Identify missing delivery details from the supplied order facts.",
  },
  fulfillment: {
    name: "fulfillment_quote_review",
    goal: "Rank only eligible shipping quotes within the supplied cost policy.",
  },
  recovery: {
    name: "shipping_failure_recovery",
    goal: "Recommend a bounded retry, eligible fallback, or escalation.",
  },
} as const;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function safeIdentifiers(context: TraceIdentifiers): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const key of ["caseId", "runId", "taskId"] as const) {
    const value = context[key];
    if (typeof value === "string" && identifierPattern.test(value)) safe[key] = value;
  }
  return safe;
}

function realTraceId(value: string | undefined): string | undefined {
  if (!value || !/^[0-9a-f]{32}$/i.test(value) || /^0+$/.test(value)) return undefined;
  return value;
}

export function createNeatlogsIntegration(
  env: Environment = process.env as unknown as Environment,
  sdk: NeatlogsSdkAdapter = neatlogsSdk,
) {
  const apiKey = env.NEATLOGS_API_KEY?.trim();
  let initialization: Promise<boolean> | undefined;

  const initialize = (): Promise<boolean> => {
    if (!apiKey) return Promise.resolve(false);
    initialization ??= sdk.init({
      apiKey,
      workflowName: "nentra-rescue",
      captureLogs: false,
      pii: "redact",
      piiEnabled: true,
    }).then(() => true).catch((error: unknown) => {
      initialization = undefined;
      throw error;
    });
    return initialization;
  };

  const withAgent = async <T>(context: AgentSpanContext, operation: () => Promise<T> | T): Promise<T> => {
    if (!(await initialize())) return operation();
    let result!: T;
    const identifiers = safeIdentifiers(context);
    await sdk.trace({
      name: roleDetails[context.role].name,
      kind: "AGENT",
      role: context.role,
      goal: roleDetails[context.role].goal,
      sessionId: identifiers.runId,
      attributes: identifiers,
    }, async () => {
      result = await operation();
      return undefined;
    });
    return result;
  };

  const withTool = async <T>(context: ToolSpanContext, operation: () => Promise<T> | T): Promise<T> => {
    if (!(await initialize())) return operation();
    const safeName = /^[A-Za-z0-9_.-]{1,64}$/.test(context.toolName) ? context.toolName : "external_tool";
    let result!: T;
    const identifiers = safeIdentifiers(context);
    await sdk.trace({
      name: safeName,
      kind: "TOOL",
      toolName: safeName,
      sessionId: identifiers.runId,
      attributes: identifiers,
    }, async () => {
      result = await operation();
      return undefined;
    });
    return result;
  };

  const withWorkflow = async <T>(
    context: TraceIdentifiers,
    operation: (traceRef?: string) => Promise<T> | T,
  ): Promise<WorkflowExecution<T>> => {
    if (!(await initialize())) return { result: await operation() };
    let result!: T;
    let traceRef: string | undefined;
    const identifiers = safeIdentifiers(context);
    await sdk.trace({
      name: "recover_pre_dispatch_order",
      kind: "WORKFLOW",
      sessionId: identifiers.runId,
      attributes: identifiers,
    }, async (activeSpan) => {
      traceRef = realTraceId(activeSpan.spanContext().traceId);
      result = await operation(traceRef);
      return undefined;
    });
    return { result, traceRef };
  };

  return {
    initialize,
    withAgent,
    withTool,
    withWorkflow,
    wrapOpenAI<T extends object>(client: T): T {
      return apiKey ? sdk.wrapOpenAI(client) : client;
    },
    flush(): Promise<boolean> {
      return apiKey ? sdk.flush() : Promise.resolve(true);
    },
  };
}

const defaultIntegration = createNeatlogsIntegration(process.env as unknown as Environment);

export const initializeNeatlogs = defaultIntegration.initialize;
export const withAgentSpan = defaultIntegration.withAgent;
export const withToolSpan = defaultIntegration.withTool;
export const withWorkflowSpan = defaultIntegration.withWorkflow;
export const wrapOpenAIWithNeatlogs = defaultIntegration.wrapOpenAI;
export const flushNeatlogs = defaultIntegration.flush;
