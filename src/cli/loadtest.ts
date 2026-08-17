#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { generateSyntheticTraces } from "../ingestion/syntheticTraces.js";
import { chunkIntoBatches } from "../ingestion/batchLoader.js";
import { enqueueBatch, judgeQueue, closeQueue } from "../queue/producer.js";
import { startWorker } from "../queue/worker.js";
import { MockJudgeProvider } from "../judge/mockJudgeProvider.js";
import { LiveJudgeProvider } from "../judge/liveJudgeProvider.js";
import { deadLetterDepth } from "../reliability/deadLetter.js";
import { BatchMetrics } from "../observability/metrics.js";
import { loadEnv } from "../config/env.js";
import { logger } from "../observability/logger.js";
import { closeRedisConnection } from "../queue/connection.js";
import { requireApiKeyForLive } from "./liveGuard.js";

/**
 * Local load test against a synthetic fixture set (hundreds-to-low-thousands of traces).
 * This proves batching, concurrency, and backpressure behave correctly at small scale — it
 * is NOT a claim of real production-scale throughput. See README's "what this is not" and
 * FINDINGS.md for that caveat stated next to the actual numbers this run produces.
 */

export function parseArgs(argv: string[]): { count: number; live: boolean; batchSize: number } {
  const countIdx = argv.indexOf("--count");
  const batchIdx = argv.indexOf("--batch-size");
  return {
    count: countIdx >= 0 ? Number(argv[countIdx + 1]) : 500,
    live: argv.includes("--live"),
    batchSize: batchIdx >= 0 ? Number(argv[batchIdx + 1]) : 50,
  };
}

async function waitForDrain(timeoutMs: number): Promise<void> {
  const queue = judgeQueue();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const counts = await queue.getJobCounts("waiting", "active", "delayed", "paused");
    const pending =
      (counts["waiting"] ?? 0) +
      (counts["active"] ?? 0) +
      (counts["delayed"] ?? 0) +
      (counts["paused"] ?? 0);
    if (pending === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`load test did not drain within ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  const env = loadEnv();
  const { count, live, batchSize } = parseArgs(process.argv.slice(2));
  requireApiKeyForLive(live, env.ANTHROPIC_API_KEY);
  const provider = live
    ? new LiveJudgeProvider(
        env.JUDGE_MODEL,
        env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {},
      )
    : new MockJudgeProvider();
  const runId = `loadtest-${Date.now()}`;
  const metrics = new BatchMetrics(runId);

  logger.info(
    {
      runId,
      count,
      batchSize,
      provider: provider.name,
      model: provider.model,
      concurrency: env.WORKER_CONCURRENCY,
    },
    "starting load test",
  );

  const worker = startWorker(provider, {
    onSuccess: (result) => metrics.recordSuccess(result),
    onRetryableFailure: () => metrics.recordFailure(),
    onDeadLetter: () => metrics.recordDeadLetter(),
  });

  const traces = generateSyntheticTraces(count);
  const batches = chunkIntoBatches(traces, batchSize, runId);
  for (const batch of batches) {
    await enqueueBatch(batch);
  }

  await waitForDrain(10 * 60 * 1000);
  metrics.finish();

  const summary = metrics.summary();
  const dlqDepth = await deadLetterDepth();

  await worker.close();
  await closeQueue();

  await mkdir("reports", { recursive: true });
  const reportPath = `reports/loadtest-${runId}.json`;
  await writeFile(
    reportPath,
    JSON.stringify({ ...summary, deadLetterQueueDepth: dlqDepth }, null, 2),
  );

  logger.info({ summary, deadLetterQueueDepth: dlqDepth, reportPath }, "load test complete");
  await closeRedisConnection();
}

// Only run when this file is the process entry point, not when imported for `parseArgs`
// (see test/cli.test.ts) -- otherwise importing it for testing would run a real load test.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    logger.error({ err }, "load test failed");
    process.exitCode = 1;
  });
}
