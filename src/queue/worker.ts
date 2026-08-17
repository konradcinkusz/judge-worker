import { Worker, Queue, type Job } from "bullmq";
import { judgeQueueName, deadLetterQueueName } from "./queueNames.js";
import { redisConnection } from "./connection.js";
import { loadEnv } from "../config/env.js";
import { logger } from "../observability/logger.js";
import { gradeTrace } from "../judge/gradeTrace.js";
import type { JudgeProvider } from "../judge/judgeProvider.js";
import type { JudgeJobData } from "./producer.js";
import { traceSchema } from "../types/trace.js";
import type { JudgeResult } from "../types/judge.js";
import type { DeadLetterJobData } from "../reliability/deadLetter.js";

export interface WorkerHooks {
  onSuccess?: (result: JudgeResult, batchId: string) => void;
  /** Fired on a retryable failure (attempts remain). */
  onRetryableFailure?: (error: Error, batchId: string, traceId: string) => void;
  /** Fired once retries are exhausted and the job has moved to the dead-letter queue. */
  onDeadLetter?: (batchId: string, traceId: string, reason: string) => void;
}

/**
 * Consumes jobs at configurable concurrency (backpressure's other half, alongside the
 * producer's queue-depth check). A job that keeps failing is retried with exponential
 * backoff up to JOB_ATTEMPTS; once exhausted it is moved to a dead-letter queue instead of
 * being silently dropped or retried forever.
 */
export function startWorker(
  provider: JudgeProvider,
  hooks: WorkerHooks = {},
): Worker<JudgeJobData> {
  const env = loadEnv();
  const deadLetterQueue = new Queue<DeadLetterJobData>(deadLetterQueueName(), {
    connection: redisConnection(),
  });

  const worker = new Worker<JudgeJobData>(
    judgeQueueName(),
    async (job: Job<JudgeJobData>) => {
      // Anti-corruption boundary: re-validate at the point of consumption, not just at
      // ingestion — the queue is a trust boundary regardless of what pushed the job.
      const trace = traceSchema.parse(job.data.trace);
      const result = await gradeTrace(provider, trace);
      hooks.onSuccess?.(result, job.data.batchId);
      return result;
    },
    { connection: redisConnection(), concurrency: env.WORKER_CONCURRENCY },
  );

  worker.on("failed", (job, err) => {
    if (!job) return;
    const attemptsExhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
    if (attemptsExhausted) {
      void deadLetterQueue
        .add("dead-letter", {
          batchId: job.data.batchId,
          trace: job.data.trace,
          reason: err.message,
        })
        .then(() => hooks.onDeadLetter?.(job.data.batchId, job.data.trace.traceId, err.message));
      logger.error(
        { traceId: job.data.trace.traceId, batchId: job.data.batchId, err },
        "job dead-lettered after exhausting retries",
      );
    } else {
      hooks.onRetryableFailure?.(err, job.data.batchId, job.data.trace.traceId);
      logger.warn(
        { traceId: job.data.trace.traceId, attempt: job.attemptsMade, err },
        "job attempt failed, will retry",
      );
    }
  });

  return worker;
}
