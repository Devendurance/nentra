import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";

import {
  runFulfillmentAgent,
  runInvestigatorAgent,
  runRecoveryAgent,
  type AgentEnvironment,
  type RecoveryMode,
} from "@/agents";
import { classifyShippingFailure } from "@/domain/recovery/policy";
import { SandboxShippingAdapter, ShippingProviderError, type QuoteRequest } from "@/integrations/shipping";
import type { NeatlogsIntegration } from "@/integrations/llm";
import { approvals, quoteOptions } from "@/server/db/schema";
import {
  DemoRepository,
  type CaseTransition,
  type CommitJobStepInput,
} from "@/server/db/repository";
import type { ClaimedJob } from "@/server/db/schema";
import { requestCorrectionViaWhatsapp } from "@/server/whatsapp/outbound";

export type CoordinatorOptions = {
  repository: DemoRepository;
  job: ClaimedJob;
  workerId: string;
  leaseToken: string;
  assertLease: () => void;
  agentEnv: AgentEnvironment;
  telemetry: NeatlogsIntegration;
};

type CaseContext = NonNullable<Awaited<ReturnType<DemoRepository["getCaseWorkflowContext"]>>>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function errorCode(error: unknown): string {
  if (error instanceof ShippingProviderError) return error.code;
  return "STEP_EXECUTION_FAILED";
}

function publicErrorCode(code: string): string {
  return /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : "STEP_EXECUTION_FAILED";
}

function recoveryMode(env: AgentEnvironment): RecoveryMode {
  const mode = env.NENTRA_RECOVERY_MODE;
  if (mode === undefined || mode === "RECOVERED") return "RECOVERED";
  if (mode === "BASELINE") return "BASELINE";
  throw new Error("NENTRA_RECOVERY_MODE must be BASELINE or RECOVERED.");
}

function inferenceMetadata(execution: { mode: "deterministic" | "llm"; provider?: string; model?: string }) {
  return {
    mode: execution.mode,
    ...(execution.provider ? { provider: execution.provider } : {}),
    ...(execution.model ? { model: execution.model } : {}),
  };
}

function addressCompleteness(context: CaseContext) {
  const address = record(context.order.addressJson);
  return {
    street: typeof address.addressLine1 === "string" && address.addressLine1.trim().length > 0,
    area: typeof address.area === "string" && address.area.trim().length > 0,
    landmark: typeof address.landmark === "string" && address.landmark.trim().length > 0,
    city: typeof address.city === "string" && address.city.trim().length > 0,
    state: typeof address.state === "string" && address.state.trim().length > 0,
  };
}

function quoteRequest(context: CaseContext, route: QuoteRequest["route"]): QuoteRequest {
  const address = record(context.order.addressJson);
  return {
    caseId: context.caseRecord.id,
    orderId: context.order.id,
    route,
    currency: "NGN",
    origin: { area: "Ikeja", state: "Lagos", countryCode: "NG" },
    destination: {
      area: text(address.area, "Lekki"),
      state: text(address.state, "Lagos"),
      countryCode: "NG",
    },
    parcel: { description: "Fictional retail order", weightGrams: 1_500 },
  };
}

function createAdapter(context: CaseContext, repository: DemoRepository): SandboxShippingAdapter {
  return new SandboxShippingAdapter(repository, { maxShippingNgn: context.merchant.maxShippingNgn });
}

function taskInput(
  options: CoordinatorOptions,
  context: CaseContext,
  role: "controller" | "investigator" | "liaison" | "fulfillment" | "recovery" | "verifier",
  goal: string,
  inputJson: Record<string, unknown>,
) {
  options.assertLease();
  return options.repository.beginTask(options.job, options.workerId, options.leaseToken, {
    runId: context.run.id,
    role,
    goal,
    inputJson,
  });
}

async function commit(
  options: CoordinatorOptions,
  taskId: string,
  input: Omit<CommitJobStepInput, "jobId" | "workerId" | "leaseToken" | "taskId">,
): Promise<void> {
  options.assertLease();
  await options.repository.commitJobStep({
    jobId: options.job.id,
    workerId: options.workerId,
    leaseToken: options.leaseToken,
    taskId,
    ...input,
  });
}

export async function executeCoordinatorStep(options: CoordinatorOptions): Promise<void> {
  const context = await options.repository.getCaseWorkflowContext(options.job.caseId);
  if (!context) throw new Error("The workflow job no longer has a case and run.");

  switch (options.job.step) {
    case "controller_plan":
      await controllerPlan(options, context);
      return;
    case "investigate":
      await investigate(options, context);
      return;
    case "liaison":
      await liaison(options, context);
      return;
    case "fulfillment_primary":
      await primaryQuote(options, context);
      return;
    case "recover_fallback":
      await recoverWithAlternative(options, context);
      return;
    case "evaluate_quote":
      await evaluateQuote(options, context);
      return;
    case "booking_prepare":
      await prepareBooking(options, context);
      return;
    case "booking_submit":
      await submitBooking(options, context);
      return;
    case "verify_booking":
      await verifyBooking(options, context);
      return;
    default:
      throw new Error("The workflow contains an unsupported persisted step.");
  }
}

async function controllerPlan(options: CoordinatorOptions, context: CaseContext): Promise<void> {
  const task = await taskInput(options, context, "controller", "Create a bounded plan for the seeded pre-dispatch exception.", {
    orderNumber: context.order.orderNumber,
    nextRole: "investigator",
  });
  await commit(options, task.id, {
    outputJson: { mode: "deterministic", delegatedRole: "investigator", summary: "Review delivery address completeness before requesting a quote." },
    summary: "The controller recorded an address review as the next bounded step.",
    actor: "controller",
    events: [{
      type: "PLAN_CREATED",
      actor: "controller",
      payload: { title: "Recovery plan recorded", summary: "The workflow will inspect the address, request missing customer input, compare quotes, then verify any booking.", station: "controller" },
    }],
    nextStep: "investigate",
  });
}

async function investigate(options: CoordinatorOptions, context: CaseContext): Promise<void> {
  const task = await taskInput(options, context, "investigator", "Check the required delivery fields for the seeded order.", {
    orderId: context.order.id,
    addressCompleteness: addressCompleteness(context),
  });
  const execution = await runInvestigatorAgent({
    caseId: context.caseRecord.id,
    runId: context.run.id,
    taskId: task.id,
    orderId: context.order.id,
    addressCompleteness: addressCompleteness(context),
  }, { env: options.agentEnv, telemetry: options.telemetry });
  const missing = execution.output.missingFields;
  const transitions: CaseTransition[] = missing.length === 0 ? [{
    to: "QUOTING",
    actor: "controller",
    type: "PLAN_CREATED",
    payload: { title: "Address review passed", summary: "Required delivery details are present, quote evaluation can begin.", station: "controller", nextAction: "Request the preferred quote" },
  }] : [];
  await commit(options, task.id, {
    outputJson: { ...inferenceMetadata(execution), missingFields: missing, nextAction: execution.output.nextAction, summary: execution.output.summary },
    summary: execution.output.summary,
    actor: "investigator",
    events: [{
      type: "TASK_DELEGATED",
      actor: "controller",
      payload: missing.length
        ? { title: "Customer liaison assigned", summary: "The investigator found a missing delivery landmark and requested customer follow-up.", station: "liaison", nextAction: "Wait for scoped customer input" }
        : { title: "Fulfillment review assigned", summary: "The order has the required delivery fields for quote evaluation.", station: "fulfillment", nextAction: "Request the preferred quote" },
    }],
    transitions,
    nextStep: missing.length ? "liaison" : "fulfillment_primary",
  });
}

async function liaison(options: CoordinatorOptions, context: CaseContext): Promise<void> {
  const request = await options.repository.getCorrectionRequestForCase(context.caseRecord.id);
  if (!request) throw new Error("The seeded correction request is unavailable.");
  const task = await taskInput(options, context, "liaison", "Wait for the scoped customer form to provide the missing landmark.", {
    requestedFields: ["landmark"],
    channel: "scoped-correction-form",
  });
  await commit(options, task.id, {
    taskStatus: "WAITING",
    outputJson: { mode: "deterministic", status: "WAITING_CUSTOMER", requestedFields: ["landmark"] },
    summary: "A scoped correction form is ready for the missing fictional landmark.",
    actor: "liaison",
    transitions: [{
      to: "WAITING_CUSTOMER",
      actor: "liaison",
      type: "CUSTOMER_INPUT_REQUIRED",
      payload: { title: "Customer detail needed", summary: "The delivery address needs a landmark before shipping quotes can be checked.", station: "liaison", nextAction: "Submit the missing landmark with the scoped correction token" },
    }],
    runStatus: "WAITING",
  });
  try {
    if ((process.env.WHATSAPP_ENABLED ?? "").trim().toLowerCase() === "true") {
      await requestCorrectionViaWhatsapp({
        repository: options.repository,
        caseId: context.caseRecord.id,
        env: process.env,
      });
    }
  } catch {
    // The scoped correction form remains the fallback; a WhatsApp failure
    // must never stall the waiting-customer state.
  }
}

async function primaryQuote(options: CoordinatorOptions, context: CaseContext): Promise<void> {
  const task = await taskInput(options, context, "fulfillment", "Request the preferred sandbox shipping quote.", {
    route: "PREFERRED",
    orderId: context.order.id,
    merchantCeilingNgn: context.merchant.maxShippingNgn,
  });
  const adapter = createAdapter(context, options.repository);
  const attempt = Math.max(1, options.job.attempt);
  const startedAt = Date.now();
  await options.repository.recordQuoteAttempt({
    caseId: context.caseRecord.id,
    runId: context.run.id,
    taskId: task.id,
    route: "PREFERRED",
    attempt,
    status: "STARTED",
  });
  await options.repository.recordToolAttempt({ taskId: task.id, tool: "shipping_quotes", attempt, status: "STARTED" });

  try {
    const quote = await options.telemetry.withTool({
      toolName: "shipping_quotes",
      caseId: context.caseRecord.id,
      runId: context.run.id,
      taskId: task.id,
    }, () => adapter.getQuotes(quoteRequest(context, "PREFERRED")));
    await options.repository.recordQuoteAttempt({
      caseId: context.caseRecord.id,
      runId: context.run.id,
      taskId: task.id,
      route: "PREFERRED",
      attempt,
      status: "SUCCEEDED",
      latencyMs: Date.now() - startedAt,
      safeResultJson: { quoteId: quote.id, amountNgn: quote.amountNgn, providerCode: quote.providerCode },
    });
    await options.repository.recordToolAttempt({
      taskId: task.id,
      tool: "shipping_quotes",
      attempt,
      status: "SUCCEEDED",
      latencyMs: Date.now() - startedAt,
      safeResultJson: { quoteId: quote.id, amountNgn: quote.amountNgn, providerCode: quote.providerCode },
    });
    const agent = await runFulfillmentAgent({
      caseId: context.caseRecord.id,
      runId: context.run.id,
      taskId: task.id,
      orderId: context.order.id,
      maxShippingNgn: context.merchant.maxShippingNgn,
      quotes: [{ quoteOptionId: quote.id, courier: quote.providerCode, service: quote.serviceCode, amountNgn: quote.amountNgn, eligible: quote.eligible }],
    }, { env: options.agentEnv, telemetry: options.telemetry });
    const transitions: CaseTransition[] = [{
      to: quote.amountNgn > context.merchant.maxShippingNgn ? "WAITING_APPROVAL" : "BOOKING",
      actor: "controller",
      type: quote.amountNgn > context.merchant.maxShippingNgn ? "APPROVAL_REQUIRED" : "PLAN_CREATED",
      payload: quote.amountNgn > context.merchant.maxShippingNgn
        ? { title: "Merchant approval required", summary: "The preferred quote is above the configured shipping ceiling.", station: "controller", nextAction: "Approve or decline the exact quote" }
        : { title: "Quote is within policy", summary: "The preferred sandbox quote is eligible and within the merchant ceiling.", station: "controller", nextAction: "Prepare an idempotent booking" },
    }];
    await commit(options, task.id, {
      outputJson: { ...inferenceMetadata(agent), quoteId: quote.id, selectedQuoteOptionId: agent.output.selectedQuoteOptionId, summary: agent.output.summary },
      summary: agent.output.summary,
      actor: "fulfillment",
      transitions,
      events: [{ type: "TOOL_CALLED", actor: "fulfillment", payload: { title: "Preferred quote received", summary: "The sandbox provider returned and persisted the preferred route quote.", station: "fulfillment", resultCode: "QUOTE_RECEIVED" } }],
      nextStep: quote.amountNgn > context.merchant.maxShippingNgn ? undefined : "booking_prepare",
      nextPayload: { quoteId: quote.id },
      runStatus: quote.amountNgn > context.merchant.maxShippingNgn ? "WAITING" : "RUNNING",
      ...(quote.amountNgn > context.merchant.maxShippingNgn ? {
        pendingApproval: {
          quoteOptionId: quote.id,
          proposalHash: proposalHash(context.caseRecord.id, quote.id, quote.providerCode, quote.serviceCode, quote.amountNgn),
          requestedCostNgn: quote.amountNgn,
        },
      } : {}),
    });
  } catch (failure) {
    const code = errorCode(failure);
    await options.repository.recordQuoteAttempt({
      caseId: context.caseRecord.id,
      runId: context.run.id,
      taskId: task.id,
      route: "PREFERRED",
      attempt,
      status: "FAILED",
      resultCode: code,
      latencyMs: Date.now() - startedAt,
      safeResultJson: { classification: "TRANSIENT_READ", resultCode: code },
    });
    await options.repository.recordToolAttempt({
      taskId: task.id,
      tool: "shipping_quotes",
      attempt,
      status: "FAILED",
      resultCode: code,
      latencyMs: Date.now() - startedAt,
      safeResultJson: { resultCode: code, statusCode: failure instanceof ShippingProviderError ? failure.statusCode : undefined },
    });
    if (recoveryMode(options.agentEnv) === "BASELINE") {
      await commit(options, task.id, {
        taskStatus: "FAILED",
        outputJson: { mode: "baseline", recoveryMode: "BASELINE", result: "FAILED", resultCode: publicErrorCode(code) },
        summary: "The baseline stopped after the preferred quote failed. Recovery was not run, so the order remains blocked.",
        actor: "fulfillment",
        transitions: [{
          to: "ESCALATED",
          actor: "controller",
          type: "TOOL_FAILED",
          payload: { title: "Preferred route failed", summary: "The preferred shipping quote returned a transient 503 and the baseline has no recovery step.", station: "fulfillment", resultCode: publicErrorCode(code), nextAction: "Review the provider failure or rerun with recovery enabled" },
        }],
        events: [{
          type: "CASE_ESCALATED",
          actor: "controller",
          payload: { title: "Baseline stopped for review", summary: "The persisted quote failure was left unresolved because recovery mode is disabled.", station: "controller", resultCode: "BASELINE_UNRECOVERED", nextAction: "Enable recovered mode to inspect a permitted alternative" },
        }],
        runStatus: "FAILED",
        orderFulfillmentStatus: "BLOCKED",
      });
      return;
    }
    const agent = await runFulfillmentAgent({
      caseId: context.caseRecord.id,
      runId: context.run.id,
      taskId: task.id,
      orderId: context.order.id,
      maxShippingNgn: context.merchant.maxShippingNgn,
      quotes: [],
    }, { env: options.agentEnv, telemetry: options.telemetry });
    await commit(options, task.id, {
      outputJson: { ...inferenceMetadata(agent), result: "FAILED", resultCode: code, summary: agent.output.summary },
      summary: "The preferred quote request failed and was handed to recovery.",
      actor: "fulfillment",
      transitions: [{
        to: "RECOVERING",
        actor: "controller",
        type: "TOOL_FAILED",
        payload: { title: "Preferred route failed", summary: "The seeded sandbox provider returned a real transient quote failure.", station: "fulfillment", resultCode: publicErrorCode(code), nextAction: "Classify the error and inspect a permitted fallback" },
      }],
      events: [{ type: "TASK_DELEGATED", actor: "controller", payload: { title: "Recovery review assigned", summary: "The recovery agent will classify the recorded quote failure and inspect the alternative route.", station: "recovery" } }],
      nextStep: "recover_fallback",
    });
  }
}

async function recoverWithAlternative(options: CoordinatorOptions, context: CaseContext): Promise<void> {
  const task = await taskInput(options, context, "recovery", "Classify the preferred quote failure and select an eligible fallback route.", {
    failedTool: "shipping_quotes",
    errorCode: "PROVIDER_503",
    allowedAction: "FALLBACK",
  });
  const failedAttempt = await options.repository.getLatestFailedQuoteAttempt(context.caseRecord.id, context.run.id);
  if (!failedAttempt) throw new Error("The failed preferred quote attempt was not persisted.");
  const classification = classifyShippingFailure({
    code: failedAttempt.resultCode ?? "PROVIDER_503",
    operation: "READ",
    statusCode: 503,
  });
  const adapter = createAdapter(context, options.repository);
  const attempt = Math.max(1, options.job.attempt);
  const startedAt = Date.now();
  await options.repository.recordQuoteAttempt({
    caseId: context.caseRecord.id,
    runId: context.run.id,
    taskId: task.id,
    route: "ALTERNATIVE",
    attempt,
    status: "STARTED",
  });
  await options.repository.recordToolAttempt({ taskId: task.id, tool: "shipping_quotes", attempt, status: "STARTED" });
  const quote = await options.telemetry.withTool({
    toolName: "shipping_quotes",
    caseId: context.caseRecord.id,
    runId: context.run.id,
    taskId: task.id,
  }, () => adapter.getQuotes(quoteRequest(context, "ALTERNATIVE")));
  await options.repository.recordQuoteAttempt({
    caseId: context.caseRecord.id,
    runId: context.run.id,
    taskId: task.id,
    route: "ALTERNATIVE",
    attempt,
    status: "SUCCEEDED",
    latencyMs: Date.now() - startedAt,
    safeResultJson: { quoteId: quote.id, amountNgn: quote.amountNgn, providerCode: quote.providerCode },
  });
  await options.repository.recordToolAttempt({
    taskId: task.id,
    tool: "shipping_quotes",
    attempt,
    status: "SUCCEEDED",
    latencyMs: Date.now() - startedAt,
    safeResultJson: { quoteId: quote.id, amountNgn: quote.amountNgn, providerCode: quote.providerCode },
  });
  const agent = await runRecoveryAgent({
    caseId: context.caseRecord.id,
    runId: context.run.id,
    taskId: task.id,
    failedTool: "shipping_quotes",
    errorCode: "UPSTREAM_UNAVAILABLE",
    isTransient: classification === "TRANSIENT_READ",
    remainingAdditionalAttempts: 0,
    eligibleFallbackQuoteOptionIds: [quote.id],
  }, { env: options.agentEnv, telemetry: options.telemetry });
  if (agent.output.action !== "FALLBACK" || agent.output.quoteOptionId !== quote.id) {
    throw new Error("The recovery decision did not select the persisted eligible fallback quote.");
  }
  await commit(options, task.id, {
    outputJson: { ...inferenceMetadata(agent), classification, action: agent.output.action, quoteId: quote.id, reason: agent.output.reason },
    summary: "Recovery classified the 503 as transient and selected the persisted alternative quote.",
    actor: "recovery",
    transitions: [{
      to: "QUOTING",
      actor: "recovery",
      type: "FALLBACK_SELECTED",
      payload: { title: "Alternative route selected", summary: "The recovery agent selected the eligible sandbox alternative after the preferred route failed.", station: "recovery", resultCode: "FALLBACK_SELECTED", nextAction: "Check the quote against the merchant ceiling" },
    }],
    events: [{ type: "TOOL_CALLED", actor: "recovery", payload: { title: "Alternative quote persisted", summary: "The sandbox alternative route returned a quote for policy review.", station: "recovery", resultCode: "QUOTE_RECEIVED" } }],
    nextStep: "evaluate_quote",
    nextPayload: { quoteId: quote.id },
  });
}

async function evaluateQuote(options: CoordinatorOptions, context: CaseContext): Promise<void> {
  const payload = record(options.job.payloadJson);
  const quoteId = text(payload.quoteId);
  const quoteRow = await options.repository.getQuoteRow(quoteId);
  if (!quoteRow || quoteRow.caseId !== context.caseRecord.id) throw new Error("The recovery quote is not persisted for this case.");
  const task = await taskInput(options, context, "fulfillment", "Evaluate the persisted alternative quote against the merchant shipping ceiling.", {
    quoteId,
    maxShippingNgn: context.merchant.maxShippingNgn,
  });
  const agent = await runFulfillmentAgent({
    caseId: context.caseRecord.id,
    runId: context.run.id,
    taskId: task.id,
    orderId: context.order.id,
    maxShippingNgn: context.merchant.maxShippingNgn,
    quotes: [{
      quoteOptionId: quoteRow.id,
      courier: quoteRow.provider,
      service: quoteRow.service,
      amountNgn: quoteRow.amountNgn,
      eligible: quoteRow.eligible,
    }],
  }, { env: options.agentEnv, telemetry: options.telemetry });

  if (quoteRow.amountNgn > context.merchant.maxShippingNgn) {
    const proposal = proposalHash(context.caseRecord.id, quoteRow.id, quoteRow.provider, quoteRow.service, quoteRow.amountNgn);
    await commit(options, task.id, {
      outputJson: { ...inferenceMetadata(agent), quoteId, decision: "REQUIRE_APPROVAL", summary: agent.output.summary },
      summary: "The eligible alternative exceeds the configured ceiling and now requires explicit approval.",
      actor: "fulfillment",
      transitions: [{
        to: "WAITING_APPROVAL",
        actor: "controller",
        type: "APPROVAL_REQUIRED",
        payload: { title: "Merchant approval required", summary: `The alternative quote is ${quoteRow.amountNgn.toLocaleString("en-NG")} NGN, above the ${context.merchant.maxShippingNgn.toLocaleString("en-NG")} NGN ceiling.`, station: "controller", resultCode: "COST_LIMIT", nextAction: "Approve or decline this exact quote" },
      }],
      pendingApproval: { quoteOptionId: quoteRow.id, proposalHash: proposal, requestedCostNgn: quoteRow.amountNgn },
      runStatus: "WAITING",
    });
    return;
  }
  if (agent.output.selectedQuoteOptionId !== quoteRow.id) {
    throw new Error("The fulfillment agent did not select the eligible quote within the configured ceiling.");
  }
  await commit(options, task.id, {
    outputJson: { ...inferenceMetadata(agent), quoteId, decision: "ALLOW", summary: agent.output.summary },
    summary: agent.output.summary,
    actor: "fulfillment",
    transitions: [{
      to: "BOOKING",
      actor: "controller",
      type: "PLAN_CREATED",
      payload: { title: "Quote is within policy", summary: "The eligible quote is within the merchant's configured shipping ceiling.", station: "controller", nextAction: "Prepare an idempotent booking" },
    }],
    nextStep: "booking_prepare",
    nextPayload: { quoteId },
  });
}

async function prepareBooking(options: CoordinatorOptions, context: CaseContext): Promise<void> {
  const payload = record(options.job.payloadJson);
  let quoteId = text(payload.quoteId);
  const approvalId = text(payload.approvalId) || undefined;
  if (approvalId) {
    const [row] = await options.repository.db.select({ approval: approvals, quote: quoteOptions })
      .from(approvals)
      .innerJoin(quoteOptions, eq(approvals.quoteOptionId, quoteOptions.id))
      .where(and(eq(approvals.id, approvalId), eq(approvals.caseId, context.caseRecord.id))).limit(1);
    if (!row || row.approval.status !== "APPROVED") throw new Error("The exact quote approval is not approved.");
    quoteId = row.quote.id;
  }
  if (!quoteId) throw new Error("No selected quote was included in the booking step.");
  const quote = await options.repository.getQuote(quoteId);
  if (!quote || quote.caseId !== context.caseRecord.id || quote.orderId !== context.order.id || !quote.eligible) {
    throw new Error("The selected quote is no longer eligible for this order.");
  }
  if (quote.amountNgn > context.merchant.maxShippingNgn) {
    if (!approvalId) throw new Error("The above-ceiling quote has no approval reference.");
    const [approved] = await options.repository.db.select().from(approvals).where(and(
      eq(approvals.id, approvalId),
      eq(approvals.caseId, context.caseRecord.id),
      eq(approvals.quoteOptionId, quote.id),
      eq(approvals.status, "APPROVED"),
      eq(approvals.proposalHash, proposalHash(context.caseRecord.id, quote.id, quote.providerCode, quote.serviceCode, quote.amountNgn)),
    )).limit(1);
    if (!approved || approved.requestedCostNgn !== quote.amountNgn) throw new Error("The approved quote does not match the current booking proposal.");
  }
  const task = await taskInput(options, context, "fulfillment", "Persist one idempotent booking intent before the sandbox write.", {
    quoteId,
    approvalId,
    amountNgn: quote.amountNgn,
  });
  const idempotencyKey = `nentra:${context.caseRecord.id}:${context.run.id}:${quote.id}`;
  const intent = await options.repository.prepareBooking({
    caseId: context.caseRecord.id,
    orderId: context.order.id,
    quoteId: quote.id,
    idempotencyKey,
    approvalId,
  });
  await commit(options, task.id, {
    outputJson: { mode: "deterministic", intentIdempotencyKey: intent.idempotencyKey, status: "PREPARED" },
    summary: "The booking intent and idempotency key were persisted before the provider write.",
    actor: "fulfillment",
    events: [{ type: "TOOL_CALLED", actor: "fulfillment", payload: { title: "Booking intent persisted", summary: "The sandbox booking has a durable intent and idempotency key before submission.", station: "fulfillment", resultCode: "BOOKING_INTENT_PREPARED" } }],
    nextStep: "booking_submit",
    nextPayload: { quoteId: quote.id, approvalId, idempotencyKey },
  });
}

async function submitBooking(options: CoordinatorOptions, context: CaseContext): Promise<void> {
  const payload = record(options.job.payloadJson);
  const idempotencyKey = text(payload.idempotencyKey);
  if (!idempotencyKey) throw new Error("The booking idempotency key is missing.");
  const stored = await options.repository.getBookingIntent(idempotencyKey);
  if (!stored) throw new Error("The persisted booking intent is missing.");
  const task = await taskInput(options, context, "fulfillment", "Submit the prepared sandbox booking once and reconcile by idempotency key.", {
    idempotencyKey,
    quoteId: stored.intent.quoteOptionId,
  });
  const adapter = createAdapter(context, options.repository);
  let booking;

  if (options.job.attempt > 1 || stored.intent.status !== "PREPARED") {
    booking = await options.telemetry.withTool({
      toolName: "read_booking_by_idempotency_key",
      caseId: context.caseRecord.id,
      runId: context.run.id,
      taskId: task.id,
    }, () => options.repository.getBookingByIdempotencyKey(idempotencyKey));
    if (!booking) {
      await options.repository.updateBookingOutcome({
        bookingIntentId: stored.intent.id,
        bookingId: stored.booking.id,
        status: "UNKNOWN",
      });
      await commit(options, task.id, {
        taskStatus: "FAILED",
        outputJson: { resultCode: "BOOKING_OUTCOME_UNKNOWN", idempotencyKey },
        summary: "A previous booking submission could not be reconciled, so no write was repeated.",
        actor: "fulfillment",
        transitions: [{
          to: "ESCALATED",
          actor: "controller",
          type: "CASE_ESCALATED",
          payload: { title: "Booking outcome unconfirmed", summary: "No booking was found by the persisted idempotency key after a previous submission attempt. The system stopped without another write.", station: "controller", resultCode: "BOOKING_OUTCOME_UNKNOWN", nextAction: "Review the provider state before retrying" },
        }],
        runStatus: "FAILED",
      });
      return;
    }
  } else {
    await options.repository.markBookingSubmitted(idempotencyKey);
    const attempt = Math.max(1, options.job.attempt);
    await options.repository.recordToolAttempt({ taskId: task.id, tool: "shipping_booking", attempt, status: "STARTED" });
    const startedAt = Date.now();
    try {
      booking = await options.telemetry.withTool({
        toolName: "shipping_booking",
        caseId: context.caseRecord.id,
        runId: context.run.id,
        taskId: task.id,
      }, () => adapter.bookShipment({
        caseId: context.caseRecord.id,
        orderId: context.order.id,
        quoteId: stored.intent.quoteOptionId,
        idempotencyKey,
      }));
      await options.repository.recordToolAttempt({
        taskId: task.id,
        tool: "shipping_booking",
        attempt,
        status: "SUCCEEDED",
        latencyMs: Date.now() - startedAt,
        safeResultJson: { providerBookingId: booking.providerBookingId, status: booking.status },
      });
    } catch (failure) {
      const code = errorCode(failure);
      const reconciled = await options.repository.getBookingByIdempotencyKey(idempotencyKey);
      if (reconciled) {
        booking = reconciled;
        await options.repository.recordToolAttempt({
          taskId: task.id,
          tool: "shipping_booking",
          attempt,
          status: "SUCCEEDED",
          resultCode: "RECONCILED",
          latencyMs: Date.now() - startedAt,
          safeResultJson: { providerBookingId: reconciled.providerBookingId, status: reconciled.status },
        });
      } else {
        await options.repository.updateBookingOutcome({
          bookingIntentId: stored.intent.id,
          bookingId: stored.booking.id,
          status: failure instanceof ShippingProviderError && failure.classification === "AMBIGUOUS_WRITE" ? "UNKNOWN" : "FAILED",
        });
        await options.repository.recordToolAttempt({
          taskId: task.id,
          tool: "shipping_booking",
          attempt,
          status: failure instanceof ShippingProviderError && failure.classification === "AMBIGUOUS_WRITE" ? "UNKNOWN" : "FAILED",
          resultCode: code,
          latencyMs: Date.now() - startedAt,
          safeResultJson: { resultCode: code },
        });
        await commit(options, task.id, {
          taskStatus: "FAILED",
          outputJson: { resultCode: code, outcome: failure instanceof ShippingProviderError ? failure.classification : "UNKNOWN" },
          summary: "The booking write did not return a confirmed result. The workflow stopped for safe review.",
          actor: "fulfillment",
          transitions: [{
            to: "ESCALATED",
            actor: "controller",
            type: "CASE_ESCALATED",
            payload: { title: "Booking needs reconciliation", summary: "The booking result could not be confirmed, so the workflow stopped without a blind retry.", station: "controller", resultCode: publicErrorCode(code), nextAction: "Review the persisted provider reference" },
          }],
          runStatus: "FAILED",
        });
        return;
      }
    }
  }

  if (!booking) throw new Error("The booking write returned no reconcilable booking.");
  await options.repository.updateBookingOutcome({
    bookingIntentId: stored.intent.id,
    bookingId: stored.booking.id,
    status: "CONFIRMED",
    providerBookingId: booking.providerBookingId,
  });
  await commit(options, task.id, {
    outputJson: { mode: "DEMO_SANDBOX", providerBookingId: booking.providerBookingId, result: "BOOKED" },
    summary: "The sandbox booking was written once with its persisted idempotency key.",
    actor: "fulfillment",
    transitions: [{
      to: "VERIFYING",
      actor: "controller",
      type: "BOOKING_CREATED",
      payload: { title: "Sandbox booking created", summary: "A booking reference was saved and sent to independent verification.", station: "fulfillment", nextAction: "Read the booking back independently" },
    }],
    events: [{ type: "TOOL_CALLED", actor: "fulfillment", payload: { title: "Booking write confirmed", summary: "The sandbox adapter returned a booking linked to the persisted intent.", station: "fulfillment", resultCode: "BOOKED" } }],
    nextStep: "verify_booking",
  });
}

async function verifyBooking(options: CoordinatorOptions, context: CaseContext): Promise<void> {
  const stored = await options.repository.getBookingForReadback(context.caseRecord.id);
  if (!stored?.booking.providerBookingId) throw new Error("The persisted booking is missing its provider identity.");
  const task = await taskInput(options, context, "verifier", "Read the saved sandbox booking independently and compare it with the persisted order intent.", {
    bookingId: stored.booking.id,
    providerBookingId: stored.booking.providerBookingId,
  });
  const adapter = createAdapter(context, options.repository);
  const readback = await options.telemetry.withTool({
    toolName: "shipping_booking_readback",
    caseId: context.caseRecord.id,
    runId: context.run.id,
    taskId: task.id,
  }, () => adapter.getBooking(stored.booking.providerBookingId!));
  const activeCount = await options.repository.countActiveBookings(context.caseRecord.id);
  const providerIdCount = await options.repository.countProviderBookingId(stored.booking.providerBookingId);
  const idempotencyCount = await options.repository.countBookingsByIdempotencyKey(stored.intent.idempotencyKey);
  const checks = {
    bookingIdentity: readback?.providerBookingId === stored.booking.providerBookingId,
    order: readback?.caseId === context.caseRecord.id && readback?.orderId === context.order.id,
    status: readback?.status === "BOOKED" && stored.booking.state === "BOOKED",
    courier: readback?.providerCode === stored.quote.provider && readback?.serviceCode === stored.quote.service,
    price: readback?.amountNgn === stored.quote.amountNgn && stored.booking.costNgn === stored.quote.amountNgn,
    uniqueness: activeCount === 1 && providerIdCount === 1 && idempotencyCount === 1,
  };
  const result = Object.values(checks).every(Boolean) ? "PASS" : "FAIL";
  const verificationJson = {
    result,
    adapterMode: "DEMO_SANDBOX",
    provider: stored.quote.provider,
    service: stored.quote.service,
    providerBookingId: stored.booking.providerBookingId,
    amountNgn: stored.booking.costNgn,
    currency: "NGN",
    checks,
  };
  await commit(options, task.id, {
    outputJson: { mode: "deterministic", result, checks },
    summary: result === "PASS"
      ? "A fresh sandbox readback matched booking identity, order, state, courier, price, and uniqueness."
      : "A fresh sandbox readback did not match every saved booking field.",
    actor: "verifier",
    transitions: [{
      to: result === "PASS" ? "RESOLVED" : "ESCALATED",
      verificationResult: result,
      actor: "verifier",
      type: result === "PASS" ? "VERIFICATION_PASSED" : "VERIFICATION_FAILED",
      payload: result === "PASS"
        ? { title: "Booking independently verified", summary: "A fresh sandbox readback matched the saved booking intent and approved order details.", station: "verifier", resultCode: "PASS", nextAction: "Review the verification receipt" }
        : { title: "Booking verification failed", summary: "A fresh provider readback did not match the saved booking intent.", station: "verifier", resultCode: "VERIFICATION_MISMATCH", nextAction: "Review the mismatch before any further booking action" },
    }],
    events: [{
      type: result === "PASS" ? "CASE_RESOLVED" : "CASE_ESCALATED",
      actor: "controller",
      payload: result === "PASS"
        ? { title: "Case resolved", summary: "The booking was verified and recorded. Delivery is not claimed.", station: "controller", resultCode: "VERIFIED_BOOKING" }
        : { title: "Case needs review", summary: "The booking remains unverified and requires manual review.", station: "controller" },
    }],
    evidenceReceipt: { bookingId: stored.booking.id, result, verificationJson },
    orderFulfillmentStatus: result === "PASS" ? "BOOKED" : "BLOCKED",
    runStatus: result === "PASS" ? "COMPLETED" : "FAILED",
  });
}

function proposalHash(caseId: string, quoteId: string, provider: string, service: string, amountNgn: number): string {
  return createHash("sha256").update(`${caseId}|${quoteId}|${provider}|${service}|${amountNgn}|NGN`).digest("hex");
}

export async function recordWorkerStepFailure(options: CoordinatorOptions, failure: unknown): Promise<void> {
  const code = failure instanceof Error && "code" in failure
    ? publicErrorCode(String(failure.code))
    : publicErrorCode(errorCode(failure));
  await options.repository.failClaimedJob(options.job.id, options.workerId, options.leaseToken, code);
}

export async function getCaseRunIds(repository: DemoRepository, caseId: string): Promise<{ caseId: string; runId: string }> {
  const context = await repository.getCaseWorkflowContext(caseId);
  if (!context) throw new Error("The workflow job no longer has a case and run.");
  return { caseId, runId: context.run.id };
}
