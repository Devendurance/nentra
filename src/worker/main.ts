import "dotenv/config";

import { randomUUID } from "node:crypto";

import { createNeatlogsIntegration } from "@/integrations/neatlogs";
import type { AgentEnvironment } from "@/agents";
import { closeDb, getDb } from "@/server/db/client";
import { DemoRepository } from "@/server/db/repository";
import type { ClaimedJob } from "@/server/db/schema";
import { executeCoordinatorStep, recordWorkerStepFailure } from "@/worker/coordinator";

export type WorkerOnceResult = "processed" | "idle";

export type WorkerOptions = {
  workerId?: string;
  leaseMs?: number;
  agentEnv?: AgentEnvironment;
};

export class FencedWorkerExecutionError extends Error {
  readonly code = "JOB_LEASE_LOST";

  constructor(cause?: unknown) {
    super("Worker execution stopped because its job lease is no longer current.", { cause });
    this.name = "FencedWorkerExecutionError";
  }
}

function isLeaseLost(failure: unknown): boolean {
  return failure instanceof Error && "code" in failure && failure.code === "JOB_LEASE_LOST";
}

function asFencedFailure(failure: unknown): FencedWorkerExecutionError {
  return failure instanceof FencedWorkerExecutionError
    ? failure
    : new FencedWorkerExecutionError(failure);
}

function startLeaseHeartbeat(
  repository: DemoRepository,
  job: ClaimedJob,
  workerId: string,
  leaseMs: number,
): { assertCurrent: () => void; getFailure: () => unknown; stop: () => Promise<void> } {
  let failure: unknown;
  let inFlight: Promise<void> | undefined;
  const intervalMs = Math.max(100, Math.floor(leaseMs / 3));
  const timer = setInterval(() => {
    if (inFlight || failure !== undefined) return;
    inFlight = repository.heartbeatJob(job.id, workerId, job.leaseToken, leaseMs)
      .catch((heartbeatFailure: unknown) => {
        failure = heartbeatFailure;
      })
      .finally(() => {
        inFlight = undefined;
      });
  }, intervalMs);
  timer.unref();

  return {
    assertCurrent() {
      if (failure !== undefined) throw asFencedFailure(failure);
    },
    getFailure() {
      return failure;
    },
    async stop() {
      clearInterval(timer);
      await inFlight;
    },
  };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function workerEnvironment(): AgentEnvironment {
  return process.env as AgentEnvironment;
}

/** Claims and executes exactly one persisted workflow job step. */
export async function runWorkerOnce(
  repository: DemoRepository,
  options: WorkerOptions = {},
): Promise<WorkerOnceResult> {
  const workerId = options.workerId ?? process.env.NENTRA_WORKER_ID ?? `worker-${randomUUID()}`;
  const leaseMs = options.leaseMs ?? positiveInteger(process.env.NENTRA_JOB_LEASE_MS, 30_000);
  const job = await repository.claimJob(workerId, leaseMs);
  if (!job) return "idle";

  const context = await repository.getCaseWorkflowContext(job.caseId);
  if (!context) {
    await repository.failClaimedJob(job.id, workerId, job.leaseToken, "WORKFLOW_CONTEXT_MISSING");
    return "processed";
  }

  const env = options.agentEnv ?? workerEnvironment();
  let telemetry = createNeatlogsIntegration(env);
  const heartbeat = startLeaseHeartbeat(repository, job, workerId, leaseMs);
  let stepCommitted = false;
  let executionFailed = false;
  let executionFailure: unknown;
  try {
    try {
      await telemetry.initialize();
    } catch {
      // Trace ingestion is optional. A real job keeps running without a trace claim.
      telemetry = createNeatlogsIntegration({ ...env, NEATLOGS_API_KEY: "" });
    }

    try {
      const execution = await telemetry.withWorkflow(
        { caseId: context.caseRecord.id, runId: context.run.id },
        async (traceRef) => {
          heartbeat.assertCurrent();
          await executeCoordinatorStep({
            repository,
            job,
            workerId,
            leaseToken: job.leaseToken,
            assertLease: heartbeat.assertCurrent,
            agentEnv: env,
            telemetry,
          });
          stepCommitted = true;
          heartbeat.assertCurrent();
          await repository.setRunTraceRef(context.run.id, traceRef);
          return "step-completed" as const;
        },
      );
      await repository.setRunTraceRef(context.run.id, execution.traceRef);
    } catch (failure) {
      executionFailed = true;
      executionFailure = failure;
    }
  } finally {
    await heartbeat.stop();
  }

  if (!stepCommitted && (executionFailed || heartbeat.getFailure() !== undefined)) {
    const failure = heartbeat.getFailure() ?? executionFailure;
    if (isLeaseLost(failure)) throw asFencedFailure(failure);
    try {
      await recordWorkerStepFailure({
        repository,
        job,
        workerId,
        leaseToken: job.leaseToken,
        assertLease: heartbeat.assertCurrent,
        agentEnv: env,
        telemetry,
      }, failure);
    } catch (failureToRecord) {
      if (isLeaseLost(failureToRecord)) throw asFencedFailure(failureToRecord);
      throw failureToRecord;
    }
  }

  try {
    await telemetry.flush();
  } catch {
    // An unavailable observability endpoint never changes the booking outcome.
  }
  return "processed";
}

/** Test/CLI helper that drains ready jobs until the queue is idle or its budget ends. */
export async function drainWorker(
  repository: DemoRepository,
  options: WorkerOptions & { maxSteps?: number } = {},
): Promise<{ processed: number; stopped: "idle" | "budget" }> {
  const maxSteps = options.maxSteps ?? 50;
  let processed = 0;
  while (processed < maxSteps) {
    const result = await runWorkerOnce(repository, options);
    if (result === "idle") return { processed, stopped: "idle" };
    processed += 1;
  }
  return { processed, stopped: "budget" };
}

export async function startWorkerLoop(
  repository: DemoRepository,
  options: WorkerOptions & { pollMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const pollMs = options.pollMs ?? positiveInteger(process.env.NENTRA_WORKER_POLL_MS, 500);
  while (!options.signal?.aborted) {
    const result = await runWorkerOnce(repository, options);
    if (result === "idle") await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

async function main(): Promise<void> {
  const repository = new DemoRepository(getDb());
  if (process.argv.includes("--once")) {
    try {
      const result = await runWorkerOnce(repository);
      process.stdout.write(`${result}\n`);
    } finally {
      await closeDb();
    }
    return;
  }

  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await startWorkerLoop(repository, { signal: controller.signal });
  } finally {
    await closeDb();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/src/worker/main.ts")) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Worker stopped"}\n`);
    process.exitCode = 1;
  });
}
