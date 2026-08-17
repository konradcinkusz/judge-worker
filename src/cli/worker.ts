#!/usr/bin/env node
import { startWorker } from "../queue/worker.js";
import { MockJudgeProvider } from "../judge/mockJudgeProvider.js";
import { LiveJudgeProvider } from "../judge/liveJudgeProvider.js";
import { loadEnv } from "../config/env.js";
import { logger } from "../observability/logger.js";
import { closeRedisConnection } from "../queue/connection.js";

function isLive(argv: string[]): boolean {
  return argv.includes("--live");
}

function main(): void {
  const env = loadEnv();
  const live = isLive(process.argv.slice(2));
  if (live && !env.ANTHROPIC_API_KEY) {
    throw new Error("--live requires ANTHROPIC_API_KEY to be set");
  }
  const provider = live
    ? new LiveJudgeProvider(env.JUDGE_MODEL, env.ANTHROPIC_API_KEY)
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

try {
  main();
} catch (err) {
  logger.error({ err }, "worker failed to start");
  process.exitCode = 1;
}
