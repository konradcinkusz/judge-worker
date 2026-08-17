import { Queue } from "bullmq";
import type { Trace } from "../types/trace.js";
import { deadLetterQueueName } from "../queue/queueNames.js";
import { redisConnection } from "../queue/connection.js";
import { enqueueBatch } from "../queue/producer.js";
import { logger } from "../observability/logger.js";

export interface DeadLetterJobData {
  batchId: string;
  trace: Trace;
  reason: string;
}

/** Read-side helpers for the dead-letter queue — used by CLI reporting, not the hot path. */
export async function deadLetterDepth(): Promise<number> {
  const queue = new Queue<DeadLetterJobData>(deadLetterQueueName(), {
    connection: redisConnection(),
  });
  try {
    return await queue.count();
  } finally {
    await queue.close();
  }
}

export interface DeadLetterEntry {
  jobId: string;
  batchId: string;
  traceId: string;
  reason: string;
}

export async function listDeadLetterEntries(limit = 50): Promise<DeadLetterEntry[]> {
  const queue = new Queue<DeadLetterJobData>(deadLetterQueueName(), {
    connection: redisConnection(),
  });
  try {
    const jobs = await queue.getJobs(["completed", "waiting", "active"], 0, limit - 1);
    return jobs
      .filter((job): job is typeof job & { id: string } => job.id !== undefined)
      .map((job) => ({
        jobId: job.id,
        batchId: job.data.batchId,
        traceId: job.data.trace.traceId,
        reason: job.data.reason,
      }));
  } finally {
    await queue.close();
  }
}

export class DeadLetterJobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`no dead-letter job found with id ${jobId}`);
    this.name = "DeadLetterJobNotFoundError";
  }
}

/**
 * Moves one dead-lettered job back onto the main judge queue as a fresh job, via the normal
 * enqueueBatch() path -- same JOB_ATTEMPTS/backoff options a first-time job gets (attempts
 * reset to zero; BullMQ's attemptsMade belongs to a job instance, and there's no cross-queue
 * way to resume a prior count), and the same QUEUE_DEPTH_LIMIT guard (a bulk replay should not
 * be able to flood the queue any more than normal ingestion can). Only removed from the
 * dead-letter queue once the requeue actually succeeds, so a QueueDepthExceededError leaves
 * the entry in place to retry later. The original failure reason is not carried onto the new
 * job -- it's logged here at requeue time instead, and a fresh failure produces its own
 * dead-letter entry through the normal worker flow if the retry doesn't hold.
 */
export async function requeueDeadLetterJob(jobId: string): Promise<DeadLetterEntry> {
  const queue = new Queue<DeadLetterJobData>(deadLetterQueueName(), {
    connection: redisConnection(),
  });
  try {
    const job = await queue.getJob(jobId);
    if (!job) {
      throw new DeadLetterJobNotFoundError(jobId);
    }
    const { batchId, trace, reason } = job.data;
    await enqueueBatch({ batchId, traces: [trace] });
    await job.remove();
    logger.info(
      { jobId, batchId, traceId: trace.traceId, originalReason: reason },
      "requeued dead-lettered job",
    );
    return { jobId, batchId, traceId: trace.traceId, reason };
  } finally {
    await queue.close();
  }
}

/** Requeues every current dead-letter entry; returns how many were requeued. Stops (without
 *  losing the remaining entries) on the first requeue failure, e.g. QueueDepthExceededError. */
export async function requeueAllDeadLetterJobs(): Promise<number> {
  const entries = await listDeadLetterEntries(Number.MAX_SAFE_INTEGER);
  let requeued = 0;
  for (const entry of entries) {
    await requeueDeadLetterJob(entry.jobId);
    requeued += 1;
  }
  return requeued;
}
