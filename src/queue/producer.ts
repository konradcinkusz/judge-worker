import { Queue } from "bullmq";
import type { Trace, TraceBatch } from "../types/trace.js";
import { judgeQueueName } from "./queueNames.js";
import { redisConnection } from "./connection.js";
import { loadEnv } from "../config/env.js";
import { logger } from "../observability/logger.js";

export interface JudgeJobData {
  batchId: string;
  trace: Trace;
}

let sharedQueue: Queue<JudgeJobData> | undefined;

export function judgeQueue(): Queue<JudgeJobData> {
  sharedQueue ??= new Queue<JudgeJobData>(judgeQueueName(), { connection: redisConnection() });
  return sharedQueue;
}

export interface EnqueueBatchOptions {
  /**
   * Dedicated queue for the caller's own connection (e.g. the load test CLI proving out this
   * guard against a real backlog, see cli/loadtest.ts) instead of duplicating the depth-check
   * logic. Defaults to the shared singleton.
   */
  queue?: Queue<JudgeJobData>;
  /**
   * Explicit override, bypassing loadEnv()'s memoized QUEUE_DEPTH_LIMIT. Needed because
   * loadEnv() is cached on first call, and by the time a CLI's main() runs, other modules
   * evaluated at import time (e.g. observability/logger.ts reads LOG_LEVEL via loadEnv() at
   * module scope) have typically already forced that memoization with whatever was in
   * process.env before the CLI had a chance to parse its own flags -- setting
   * process.env.QUEUE_DEPTH_LIMIT from inside main() is too late to change what loadEnv()
   * already cached.
   */
  queueDepthLimit?: number;
}

/**
 * Enqueues one job per trace. Backpressure: refuses to push a batch that would put the queue
 * over the depth limit rather than silently piling up unbounded work — the caller decides
 * whether to wait and retry or shed the batch.
 */
export async function enqueueBatch(
  batch: TraceBatch,
  options: EnqueueBatchOptions = {},
): Promise<void> {
  const env = loadEnv();
  const queue = options.queue ?? judgeQueue();
  const queueDepthLimit = options.queueDepthLimit ?? env.QUEUE_DEPTH_LIMIT;
  const depth = await queue.count();
  if (depth + batch.traces.length > queueDepthLimit) {
    throw new QueueDepthExceededError(batch.batchId, depth, batch.traces.length, queueDepthLimit);
  }

  await queue.addBulk(
    batch.traces.map((trace) => ({
      name: "grade-trace",
      data: { batchId: batch.batchId, trace },
      opts: {
        attempts: env.JOB_ATTEMPTS,
        backoff: { type: "exponential" as const, delay: env.JOB_BACKOFF_MS },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: false,
      },
    })),
  );
  logger.info({ batchId: batch.batchId, traceCount: batch.traces.length }, "batch enqueued");
}

export class QueueDepthExceededError extends Error {
  constructor(batchId: string, currentDepth: number, incoming: number, limit: number) {
    super(
      `refusing to enqueue batch ${batchId}: queue depth ${currentDepth} + ${incoming} traces would exceed QUEUE_DEPTH_LIMIT=${limit}`,
    );
    this.name = "QueueDepthExceededError";
  }
}

export async function closeQueue(): Promise<void> {
  if (sharedQueue) {
    await sharedQueue.close();
    sharedQueue = undefined;
  }
}
