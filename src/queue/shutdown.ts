import type { Worker } from "bullmq";
import type { JudgeJobData } from "./producer.js";

export interface ActiveJobInfo {
  jobId: string;
  batchId: string;
  traceId: string;
}

/**
 * Tracks jobs this Worker instance currently has active, purely from its own events -- no
 * extra Queue connection or Redis round-trip needed, and (unlike Queue.getActive()) it can
 * never include another worker process's active jobs. Returns a getter rather than a live
 * collection so callers can't mutate the internal map.
 */
export function trackActiveJobs(worker: Worker<JudgeJobData>): () => ActiveJobInfo[] {
  const active = new Map<string, ActiveJobInfo>();
  worker.on("active", (job) => {
    if (job.id !== undefined) {
      active.set(job.id, {
        jobId: job.id,
        batchId: job.data.batchId,
        traceId: job.data.trace.traceId,
      });
    }
  });
  worker.on("completed", (job) => {
    if (job.id !== undefined) active.delete(job.id);
  });
  worker.on("failed", (job) => {
    if (job?.id !== undefined) active.delete(job.id);
  });
  return () => [...active.values()];
}

export interface ShutdownResult {
  /** True if the grace period elapsed before worker.close() resolved -- process.exit() is
   *  still required after this to actually terminate a process stuck on a hung job, since
   *  the abandoned close() call keeps running in the background otherwise. */
  forced: boolean;
  stillActive: ActiveJobInfo[];
}

/**
 * Races worker.close() (which BullMQ documents as waiting for active jobs to finish) against
 * a grace period, so a single hung job (e.g. a live judge call that never resolves) can't
 * block shutdown forever. Does not itself kill anything -- it only reports whether the grace
 * period was exceeded and what was still active at that point, so the caller can decide how
 * to exit and what to log.
 */
export async function shutdownWithTimeout(
  worker: Worker<JudgeJobData>,
  gracePeriodMs: number,
  getActiveJobs: () => ActiveJobInfo[],
): Promise<ShutdownResult> {
  let timedOut = false;
  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      timedOut = true;
      resolve();
    }, gracePeriodMs).unref();
  });

  await Promise.race([worker.close(), timeout]);

  return timedOut
    ? { forced: true, stillActive: getActiveJobs() }
    : { forced: false, stillActive: [] };
}
