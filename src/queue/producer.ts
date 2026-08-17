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

/**
 * Enqueues one job per trace. Backpressure: refuses to push a batch that would put the queue
 * over QUEUE_DEPTH_LIMIT rather than silently piling up unbounded work — the caller decides
 * whether to wait and retry or shed the batch.
 */
export async function enqueueBatch(batch: TraceBatch): Promise<void> {
  const queue = judgeQueue();
  const env = loadEnv();
  const depth = await queue.count();
  if (depth + batch.traces.length > env.QUEUE_DEPTH_LIMIT) {
    throw new QueueDepthExceededError(
      batch.batchId,
      depth,
      batch.traces.length,
      env.QUEUE_DEPTH_LIMIT,
    );
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
