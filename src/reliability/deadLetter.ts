import { Queue } from "bullmq";
import type { Trace } from "../types/trace.js";
import { deadLetterQueueName } from "../queue/queueNames.js";
import { redisConnection } from "../queue/connection.js";

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
    return jobs.map((job) => ({
      batchId: job.data.batchId,
      traceId: job.data.trace.traceId,
      reason: job.data.reason,
    }));
  } finally {
    await queue.close();
  }
}
