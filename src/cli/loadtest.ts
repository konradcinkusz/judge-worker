#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { generateSyntheticTraces } from "../ingestion/syntheticTraces.js";
import { chunkIntoBatches } from "../ingestion/batchLoader.js";
import {
  enqueueBatch,
  judgeQueue,
  closeQueue,
  QueueDepthExceededError,
  type JudgeJobData,
} from "../queue/producer.js";
import { judgeQueueName } from "../queue/queueNames.js";
import { startWorker } from "../queue/worker.js";
import { MockJudgeProvider } from "../judge/mockJudgeProvider.js";
import { LiveJudgeProvider } from "../judge/liveJudgeProvider.js";
import { LatencyInjectingJudgeProvider } from "../judge/latencyInjectingJudgeProvider.js";
import type { JudgeProvider } from "../judge/judgeProvider.js";
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
 *
 * --simulate-latency-ms and --queue-depth-limit exist so this CLI can exercise the
 * QUEUE_DEPTH_LIMIT backpressure guard end-to-end. Getting real shedding requires two things
 * neither of which is the obvious one:
 *  - the producer enqueues through its own dedicated Redis connection (`producerConnection`
 *    below), not the worker's, so the worker's job-fetch traffic can't interleave with and
 *    throttle the producer's count()/addBulk() calls;
 *  - the --queue-depth-limit override is passed to enqueueBatch() as an explicit argument
 *    (EnqueueBatchOptions.queueDepthLimit), not via process.env + loadEnv(): loadEnv() is
 *    memoized on first call, and observability/logger.ts already calls it at module scope
 *    (to read LOG_LEVEL) before main() below ever runs, so setting process.env from inside
 *    main() is always too late to affect it.
 * See FINDINGS.md's "Backpressure" section for what running this looked like before both
 * were fixed (spoiler: nothing ever got shed).
 */

export function parseArgs(argv: string[]): {
  count: number;
  live: boolean;
  batchSize: number;
  simulateLatencyMs: number;
  queueDepthLimit: number | undefined;
} {
  const countIdx = argv.indexOf("--count");
  const batchIdx = argv.indexOf("--batch-size");
  const latencyIdx = argv.indexOf("--simulate-latency-ms");
  const depthLimitIdx = argv.indexOf("--queue-depth-limit");
  return {
    count: countIdx >= 0 ? Number(argv[countIdx + 1]) : 500,
    live: argv.includes("--live"),
    batchSize: batchIdx >= 0 ? Number(argv[batchIdx + 1]) : 50,
    simulateLatencyMs: latencyIdx >= 0 ? Number(argv[latencyIdx + 1]) : 0,
    queueDepthLimit: depthLimitIdx >= 0 ? Number(argv[depthLimitIdx + 1]) : undefined,
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
  const { count, live, batchSize, simulateLatencyMs, queueDepthLimit } = parseArgs(
    process.argv.slice(2),
  );
  const env = loadEnv();
  const effectiveQueueDepthLimit = queueDepthLimit ?? env.QUEUE_DEPTH_LIMIT;
  requireApiKeyForLive(live, env.ANTHROPIC_API_KEY);
  const baseProvider: JudgeProvider = live
    ? new LiveJudgeProvider(
        env.JUDGE_MODEL,
        env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {},
      )
    : new MockJudgeProvider();
  const provider =
    simulateLatencyMs > 0
      ? new LatencyInjectingJudgeProvider(baseProvider, simulateLatencyMs)
      : baseProvider;
  const runId = `loadtest-${Date.now()}`;
  const metrics = new BatchMetrics(runId);

  // Dedicated connection/queue for the producer side only -- see the file-level comment above
  // for why this can't share the worker's connection without silently pacing production down
  // to consumption speed.
  const producerConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const producerQueue = new Queue<JudgeJobData>(judgeQueueName(), {
    connection: producerConnection,
  });

  logger.info(
    {
      runId,
      count,
      batchSize,
      provider: provider.name,
      model: provider.model,
      concurrency: env.WORKER_CONCURRENCY,
      queueDepthLimit: effectiveQueueDepthLimit,
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
  let shedBatches = 0;
  let shedTraces = 0;
  for (const batch of batches) {
    try {
      await enqueueBatch(batch, {
        queue: producerQueue,
        queueDepthLimit: effectiveQueueDepthLimit,
      });
    } catch (err) {
      if (err instanceof QueueDepthExceededError) {
        shedBatches += 1;
        shedTraces += batch.traces.length;
        logger.warn(
          { batchId: batch.batchId, err: err.message },
          "batch shed by backpressure guard",
        );
        continue;
      }
      throw err;
    }
  }

  await waitForDrain(10 * 60 * 1000);
  metrics.finish();

  const summary = metrics.summary();
  const dlqDepth = await deadLetterDepth();
  const backpressure = { shedBatches, shedTraces };

  await worker.close();
  await producerQueue.close();
  await producerConnection.quit();
  await closeQueue();

  await mkdir("reports", { recursive: true });
  const reportPath = `reports/loadtest-${runId}.json`;
  await writeFile(
    reportPath,
    JSON.stringify({ ...summary, deadLetterQueueDepth: dlqDepth, backpressure }, null, 2),
  );

  logger.info(
    { summary, deadLetterQueueDepth: dlqDepth, backpressure, reportPath },
    "load test complete",
  );
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
