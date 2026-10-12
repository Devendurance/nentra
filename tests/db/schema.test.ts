import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { caseEvents, cases, jobs, merchants, orders, runs } from "@/server/db/schema";
import { createTestDb, type TestDbInstance } from "@/server/db/test-client";

describe("database schema", () => {
  let testDb: TestDbInstance;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("applies the generated migration to an isolated PGlite database", async () => {
    await expect(testDb.db.select().from(merchants)).resolves.toEqual([]);
  });

  it("keeps event sequence numbers unique within each case", async () => {
    const { caseId, runId } = await createCase(testDb);
    const event = {
      caseId,
      runId,
      seq: 1,
      type: "CASE_STARTED" as const,
      actor: "system" as const,
      publicPayload: { title: "Case started", summary: "Recovery was queued." },
    };

    await testDb.db.insert(caseEvents).values(event);
    await expect(testDb.db.insert(caseEvents).values(event)).rejects.toThrow();
  });

  it("deduplicates runnable jobs and requires a lease for running jobs", async () => {
    const { caseId, runId } = await createCase(testDb);
    const job = {
      caseId,
      runId,
      step: "investigate",
      dedupeKey: "case:investigate:1",
    };

    await testDb.db.insert(jobs).values(job);
    await expect(testDb.db.insert(jobs).values(job)).rejects.toThrow();
    await expect(
      testDb.db.insert(jobs).values({
        ...job,
        step: "quote",
        dedupeKey: "case:quote:1",
      }),
    ).rejects.toThrow();

    await expect(
      testDb.db.insert(jobs).values({
        ...job,
        step: "running-without-lease",
        dedupeKey: "case:running-without-lease:1",
        state: "RUNNING",
      }),
    ).rejects.toThrow();
  });
});

async function createCase(testDb: TestDbInstance) {
  const [merchant] = await testDb.db
    .insert(merchants)
    .values({ name: "Demo Merchant", maxShippingNgn: 5000 })
    .returning({ id: merchants.id });
  const [order] = await testDb.db
    .insert(orders)
    .values({
      merchantId: merchant.id,
      orderNumber: "NG-2048",
      amountNgn: 65000,
      addressJson: { city: "Lagos", area: "Lekki" },
    })
    .returning({ id: orders.id });
  const [caseRecord] = await testDb.db
    .insert(cases)
    .values({ orderId: order.id })
    .returning({ id: cases.id });
  const [run] = await testDb.db
    .insert(runs)
    .values({ caseId: caseRecord.id, attempt: 1, engineVersion: "test" })
    .returning({ id: runs.id });

  return { caseId: caseRecord.id, runId: run.id };
}
