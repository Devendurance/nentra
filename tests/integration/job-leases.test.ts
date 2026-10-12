import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import type { NeatlogsIntegration } from "@/integrations/llm";
import {
  createOpenAICompatibleClient,
  resolveLlmConfig,
  type LlmConfig,
  type LlmEnvironment,
} from "@/integrations/llm";
import { agentTasks, jobs } from "@/server/db/schema";
import { createTestDb } from "@/server/db/test-client";
import { DemoRepository, type CommitJobStepInput } from "@/server/db/repository";
import { seedDemoScenario } from "../../scripts/seed-demo";
import { runWorkerOnce } from "@/worker/main";

const openServers: Server[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((failure) => failure ? reject(failure) : resolve());
  })));
});

describe("job lease fencing", () => {
  it("rejects a stale step commit after reclaim by the same worker id", async () => {
    const database = await createTestDb();
    try {
      const repository = new DemoRepository(database.db);
      const fixture = await seedDemoScenario(repository);
      await repository.startCase(fixture.caseId);

      const firstClaim = await repository.claimJob("reused-worker-id", 1_000);
      if (!firstClaim) throw new Error("Expected the first worker claim");
      const firstToken = (firstClaim as typeof firstClaim & { leaseToken?: string }).leaseToken;
      expect(firstToken).toEqual(expect.any(String));

      const [task] = await database.db.select().from(agentTasks).where(eq(agentTasks.runId, firstClaim.runId)).limit(1);
      if (!task) throw new Error("Expected the persisted controller task");
      await database.db.update(jobs).set({ leaseUntil: new Date(Date.now() - 1_000) }).where(eq(jobs.id, firstClaim.id));

      const reclaimed = await repository.claimJob("reused-worker-id", 1_000);
      if (!reclaimed) throw new Error("Expected the expired job to be reclaimed");
      const reclaimedToken = (reclaimed as typeof reclaimed & { leaseToken?: string }).leaseToken;
      expect(reclaimedToken).toEqual(expect.any(String));
      expect(reclaimedToken).not.toBe(firstToken);

      await expect(failWithToken(repository)(
        reclaimed.id,
        "reused-worker-id",
        firstToken as string,
        "STALE_WORKER_FAILURE",
      )).rejects.toMatchObject({ code: "JOB_LEASE_LOST" });
      const [stillRunning] = await database.db.select().from(jobs).where(eq(jobs.id, reclaimed.id));
      expect(stillRunning?.state).toBe("RUNNING");

      await expect(commitWithToken(repository, {
        jobId: firstClaim.id,
        workerId: "reused-worker-id",
        leaseToken: firstToken as string,
        taskId: task.id,
        outputJson: { summary: "stale" },
        summary: "The stale worker must not checkpoint.",
        actor: "controller",
      })).rejects.toMatchObject({ code: "JOB_LEASE_LOST" });
    } finally {
      await database.close();
    }
  });

  it("renews only an unexpired lease with its current token", async () => {
    const database = await createTestDb();
    try {
      const repository = new DemoRepository(database.db);
      const fixture = await seedDemoScenario(repository);
      await repository.startCase(fixture.caseId);
      const firstClaim = await repository.claimJob("lease-owner", 1_000);
      if (!firstClaim) throw new Error("Expected a worker claim");
      const token = (firstClaim as typeof firstClaim & { leaseToken?: string }).leaseToken as string;
      const heartbeat = heartbeatWithToken(repository);
      const priorLeaseUntil = firstClaim.leaseUntil?.getTime() ?? 0;

      await heartbeat(firstClaim.id, "lease-owner", token, 5_000);
      const [renewed] = await database.db.select().from(jobs).where(eq(jobs.id, firstClaim.id));
      expect(renewed?.leaseUntil?.getTime()).toBeGreaterThan(priorLeaseUntil);

      await database.db.update(jobs).set({ leaseUntil: new Date(Date.now() - 1_000) }).where(eq(jobs.id, firstClaim.id));
      await expect(heartbeat(firstClaim.id, "lease-owner", token, 5_000))
        .rejects.toMatchObject({ code: "JOB_LEASE_LOST" });

      const reclaimed = await repository.claimJob("next-worker", 1_000);
      if (!reclaimed) throw new Error("Expected the expired job to be reclaimed");
      await expect(heartbeat(reclaimed.id, "next-worker", token, 5_000))
        .rejects.toMatchObject({ code: "JOB_LEASE_LOST" });
    } finally {
      await database.close();
    }
  });

  it("renews the lease during a model request longer than one lease", async () => {
    const database = await createTestDb();
    try {
      const repository = new DemoRepository(database.db);
      const fixture = await seedDemoScenario(repository);
      await repository.startCase(fixture.caseId);
      await runWorkerOnce(repository, { workerId: "heartbeat-test", leaseMs: 1_000, agentEnv: {} });

      let heartbeatAtRequest: Date | undefined;
      const server = createServer(async (_request, response) => {
        const [running] = await database.db.select().from(jobs).where(eq(jobs.step, "investigate"));
        heartbeatAtRequest = running?.heartbeatAt ?? undefined;
        await new Promise((resolve) => setTimeout(resolve, 1_400));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 1,
          model: "test-model",
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({
                missingFields: ["landmark"],
                blockers: ["ADDRESS_INCOMPLETE"],
                nextAction: "REQUEST_CUSTOMER_INPUT",
                summary: "The landmark is missing.",
              }),
            },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      openServers.push(server);
      const address = server.address() as AddressInfo;

      const agentEnv = {
        OPENAI_API_KEY: "local-test-key",
        OPENAI_MODEL: "test-model",
        OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
        OPENAI_TIMEOUT_MS: "5_000",
      } as LlmEnvironment & { OPENAI_TIMEOUT_MS?: string };
      const result = await runWorkerOnce(repository, {
        workerId: "heartbeat-test",
        leaseMs: 1_000,
        agentEnv,
      });

      const [investigateJob] = await database.db.select().from(jobs).where(eq(jobs.step, "investigate"));
      expect(result).toBe("processed");
      expect(heartbeatAtRequest).toBeInstanceOf(Date);
      expect(investigateJob?.heartbeatAt?.getTime()).toBeGreaterThan(heartbeatAtRequest?.getTime() ?? Infinity);
      expect(investigateJob?.state).toBe("COMPLETED");
    } finally {
      await database.close();
    }
  });
});

describe("OpenAI timeout configuration", () => {
  it("uses a bounded configured timeout on the client and a shorter default", () => {
    const env = {
      OPENAI_API_KEY: "local-test-key",
      OPENAI_MODEL: "test-model",
      OPENAI_TIMEOUT_MS: "2500",
    } as LlmEnvironment & { OPENAI_TIMEOUT_MS?: string };
    const config = resolveLlmConfig(env) as (LlmConfig & { timeoutMs?: number }) | undefined;
    expect(config?.timeoutMs).toBe(2_500);
    if (!config) throw new Error("Expected an LLM configuration");

    const telemetry = { wrapOpenAI: <T extends object>(client: T) => client } as unknown as NeatlogsIntegration;
    expect(createOpenAICompatibleClient(config, telemetry).timeout).toBe(2_500);

    const defaultConfig = resolveLlmConfig({ OPENAI_API_KEY: "local-test-key", OPENAI_MODEL: "test-model" }) as (LlmConfig & { timeoutMs?: number }) | undefined;
    expect(defaultConfig?.timeoutMs).toBeGreaterThan(0);
    expect(defaultConfig?.timeoutMs).toBeLessThan(10_000);
  });
});

function commitWithToken(
  repository: DemoRepository,
  input: CommitJobStepInput & { leaseToken: string },
): Promise<void> {
  return (repository.commitJobStep as unknown as (value: CommitJobStepInput & { leaseToken: string }) => Promise<void>)(input);
}

function heartbeatWithToken(repository: DemoRepository) {
  const heartbeat = repository.heartbeatJob as unknown as (
    this: DemoRepository,
    jobId: string,
    workerId: string,
    leaseToken: string,
    leaseMs: number,
  ) => Promise<void>;
  return heartbeat.bind(repository);
}

function failWithToken(repository: DemoRepository) {
  return repository.failClaimedJob.bind(repository) as unknown as (
    jobId: string,
    workerId: string,
    leaseToken: string,
    resultCode: string,
  ) => Promise<void>;
}
