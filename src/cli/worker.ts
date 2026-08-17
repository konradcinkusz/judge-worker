#!/usr/bin/env node
import { startWorker } from "../queue/worker.js";
import { MockJudgeProvider } from "../judge/mockJudgeProvider.js";
import { LiveJudgeProvider } from "../judge/liveJudgeProvider.js";
import { loadEnv } from "../config/env.js";
import { logger } from "../observability/logger.js";
import { closeRedisConnection } from "../queue/connection.js";
import { requireApiKeyForLive } from "./liveGuard.js";

export function isLive(argv: string[]): boolean {
  return argv.includes("--live");
}

function main(): void {
  const env = loadEnv();
  const live = isLive(process.argv.slice(2));
  requireApiKeyForLive(live, env.ANTHROPIC_API_KEY);
  const provider = live
    ? new LiveJudgeProvider(
        env.JUDGE_MODEL,
        env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {},
      )
    : new MockJudgeProvider();

  logger.info(
    { provider: provider.name, model: provider.model, concurrency: env.WORKER_CONCURRENCY },
    "starting worker",
  );

  const worker = startWorker(provider, {
    onSuccess: (result, batchId) => {
      logger.info(
        {
          batchId,
          traceId: result.traceId,
          verdict: result.output.verdict,
          durationMs: result.durationMs,
          costUsd: result.costUsd,
        },
        "trace graded",
      );
    },
    onDeadLetter: (batchId, traceId, reason) => {
      logger.error({ batchId, traceId, reason }, "trace dead-lettered");
    },
  });

  const shutdown = async (): Promise<void> => {
    logger.info("shutting down worker");
    await worker.close();
    await closeRedisConnection();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

// Only run when this file is the process entry point (`tsx src/cli/worker.ts`), not when
// it's imported for its exports (e.g. `isLive` from test/cli.test.ts) -- otherwise importing
// this module for testing would connect to Redis and register signal handlers as a side effect.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    logger.error({ err }, "worker failed to start");
    process.exitCode = 1;
  }
}
