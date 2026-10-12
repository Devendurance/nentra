import "dotenv/config";

import { closeDb, getDb } from "@/server/db/client";
import { DemoRepository } from "@/server/db/repository";
import { runWorkerOnce } from "@/worker/main";

async function main(): Promise<void> {
  const repository = new DemoRepository(getDb());
  const caseId = process.argv[2];
  try {
    const candidates = caseId
      ? [await repository.getCaseSnapshot(caseId)]
      : await repository.listCases();
    const snapshot = candidates.find((candidate) => candidate !== null);
    if (!snapshot) throw new Error("No fictional NG-2048 case was found. Run npm run db:seed first.");
    if (snapshot.status === "NEW") await repository.startCase(snapshot.id, snapshot.version);

    let processed = 0;
    for (; processed < 30; processed += 1) {
      const result = await runWorkerOnce(repository);
      if (result === "idle") break;
    }
    const latest = await repository.getCaseSnapshot(snapshot.id);
    process.stdout.write(`${JSON.stringify({ processed, case: latest }, null, 2)}\n`);
  } finally {
    await closeDb();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/run-demo.ts")) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Demo worker failed"}\n`);
    process.exitCode = 1;
  });
}
