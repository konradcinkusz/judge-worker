import { describe, expect, it, afterAll } from "vitest";
import type { Trace } from "../src/types/trace.js";
import type { JudgeResult, JudgeOutput } from "../src/types/judge.js";
import type { JudgeProvider } from "../src/judge/judgeProvider.js";

// Each test file gets an isolated module registry under Vitest's default `isolate: true`, so
// setting process.env here (before any of our own modules are imported) determines what
// config/env.ts's memoized loadEnv() sees for this file only -- a unique queue name per run
// keeps this test independent of anything else touching the same Redis instance.
const suffix = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379";
process.env["JUDGE_QUEUE_NAME"] = `judge-grading-${suffix}`;
process.env["WORKER_CONCURRENCY"] = "3";
process.env["JOB_ATTEMPTS"] = "2";
process.env["JOB_BACKOFF_MS"] = "20";
process.env["QUEUE_DEPTH_LIMIT"] = "10";
process.env["MAX_RUN_COST_USD"] = "2";
process.env["LOG_LEVEL"] = "error";

const { enqueueBatch, closeQueue, QueueDepthExceededError } =
  await import("../src/queue/producer.js");
const { startWorker } = await import("../src/queue/worker.js");
const { trackActiveJobs, shutdownWithTimeout } = await import("../src/queue/shutdown.js");
const { closeRedisConnection } = await import("../src/queue/connection.js");
const { MockJudgeProvider } = await import("../src/judge/mockJudgeProvider.js");
const {
  deadLetterDepth,
  listDeadLetterEntries,
  requeueDeadLetterJob,
  requeueAllDeadLetterJobs,
  DeadLetterJobNotFoundError,
} = await import("../src/reliability/deadLetter.js");

function trace(id: string): Trace {
  return {
    traceId: id,
    scenarioId: id,
    scenarioClass: "happy",
    setting: { actor: "a", clock: "2026-01-01T00:00:00Z", timezone: "UTC" },
    conversation: [{ role: "user", content: "hi" }],
    toolCalls: [
      {
        position: 0,
        tool: "list_leave_types",
        kind: "read",
        outcome: "success",
        arguments: {},
        attempts: 1,
      },
    ],
    events: [],
    turns: [{ index: 0, outcome: "completed", terminationReason: "decision", reply: "Booked." }],
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition not met within timeout");
}

describe("queue: producer -> worker end to end", () => {
  const succeeded: JudgeResult[] = [];
  const dead: string[] = [];

  // A single worker per test, not per describe block: two Worker instances listening on the
  // same queue name would race for jobs, and "the failing provider never got the job because
  // the healthy one grabbed it first" is not a real dead-letter test.
  let worker = startWorker(new MockJudgeProvider(), {
    onSuccess: (result) => succeeded.push(result),
    onDeadLetter: (_batchId, traceId) => dead.push(traceId),
  });

  afterAll(async () => {
    await worker.close();
    await closeQueue();
    await closeRedisConnection();
  });

  it("processes every trace in an enqueued batch", async () => {
    const batch = { batchId: `b-${suffix}`, traces: [trace("q1"), trace("q2"), trace("q3")] };
    await enqueueBatch(batch);
    await waitUntil(() => succeeded.length >= 3, 10_000);

    const ids = succeeded.map((r) => r.traceId).sort();
    expect(ids).toEqual(["q1", "q2", "q3"]);
    for (const result of succeeded) {
      expect(result.output.verdict).toBe("pass");
    }
  });

  it("refuses to enqueue a batch that would exceed the queue depth limit", async () => {
    // QUEUE_DEPTH_LIMIT is 10 for this file; a batch of 20 must be rejected outright rather
    // than partially enqueued.
    const overflowBatch = {
      batchId: `overflow-${suffix}`,
      traces: Array.from({ length: 20 }, (_, i) => trace(`overflow-${i}`)),
    };
    await expect(enqueueBatch(overflowBatch)).rejects.toThrow(QueueDepthExceededError);
  });

  it("moves a permanently failing job to the dead-letter queue after exhausting retries", async () => {
    // Swap out the healthy worker for a permanently-failing one so there is exactly one
    // consumer on the queue for this test.
    await worker.close();
    const failingProvider: JudgeProvider = {
      name: "always-fails",
      model: "test",
      grade: () => Promise.reject(new Error("simulated permanent judge failure")),
    };
    worker = startWorker(failingProvider, {
      onDeadLetter: (_batchId, traceId) => dead.push(traceId),
    });

    await enqueueBatch({ batchId: `fail-${suffix}`, traces: [trace("will-fail")] });
    await waitUntil(() => dead.includes("will-fail"), 10_000);
    expect(await deadLetterDepth()).toBeGreaterThanOrEqual(1);
  });

  it("truncates an overlong failure reason before it reaches the dead-letter record", async () => {
    // Guards the logging policy in docs/SPEC.md §8a end to end: a third-party error message
    // (here simulated, since this repo's own errors never do this) must not reach a persisted
    // record, or any log downstream of it, unbounded.
    await worker.close();
    const longMessage = "z".repeat(500);
    const failingProvider: JudgeProvider = {
      name: "always-fails-verbose",
      model: "test",
      grade: () => Promise.reject(new Error(longMessage)),
    };
    worker = startWorker(failingProvider, {
      onDeadLetter: (_batchId, traceId) => dead.push(traceId),
    });

    await enqueueBatch({
      batchId: `verbose-fail-${suffix}`,
      traces: [trace("will-fail-verbose")],
    });
    await waitUntil(() => dead.includes("will-fail-verbose"), 10_000);

    const entries = await listDeadLetterEntries(100);
    const entry = entries.find((e) => e.traceId === "will-fail-verbose");
    expect(entry).toBeDefined();
    expect(entry?.reason.length).toBeLessThan(longMessage.length);
    expect(entry?.reason).toContain("truncated");
  });

  it("requeues a dead-lettered job onto the main queue, and it succeeds against a healthy provider", async () => {
    await worker.close();
    const failingProvider: JudgeProvider = {
      name: "always-fails-requeue-test",
      model: "test",
      grade: () => Promise.reject(new Error("will be requeued")),
    };
    worker = startWorker(failingProvider, {
      onDeadLetter: (_batchId, traceId) => dead.push(traceId),
    });
    await enqueueBatch({ batchId: `requeue-src-${suffix}`, traces: [trace("will-requeue")] });
    await waitUntil(() => dead.includes("will-requeue"), 10_000);

    const beforeEntries = await listDeadLetterEntries(100);
    const entry = beforeEntries.find((e) => e.traceId === "will-requeue");
    expect(entry).toBeDefined();

    // Swap to a healthy worker before requeuing, so the requeued job actually succeeds --
    // matches the real operator workflow of "fix the root cause, then requeue".
    await worker.close();
    worker = startWorker(new MockJudgeProvider(), {
      onSuccess: (result) => succeeded.push(result),
      onDeadLetter: (_batchId, traceId) => dead.push(traceId),
    });

    const requeued = await requeueDeadLetterJob(entry!.jobId);
    expect(requeued.traceId).toBe("will-requeue");
    expect(requeued.reason).toBe("will be requeued"); // original reason returned, not carried onto the new job

    await waitUntil(() => succeeded.some((r) => r.traceId === "will-requeue"), 10_000);

    const afterEntries = await listDeadLetterEntries(100);
    expect(afterEntries.find((e) => e.jobId === entry!.jobId)).toBeUndefined();
  });

  it("requeueDeadLetterJob throws DeadLetterJobNotFoundError for an unknown job id", async () => {
    await expect(requeueDeadLetterJob(`does-not-exist-${suffix}`)).rejects.toThrow(
      DeadLetterJobNotFoundError,
    );
  });

  it("requeueAllDeadLetterJobs requeues every current entry", async () => {
    const existingBefore = await deadLetterDepth();

    await worker.close();
    const failingProvider: JudgeProvider = {
      name: "always-fails-bulk-requeue-test",
      model: "test",
      grade: () => Promise.reject(new Error("bulk requeue source")),
    };
    worker = startWorker(failingProvider, {
      onDeadLetter: (_batchId, traceId) => dead.push(traceId),
    });
    await enqueueBatch({
      batchId: `bulk-requeue-src-${suffix}`,
      traces: [trace("bulk-1"), trace("bulk-2")],
    });
    await waitUntil(() => dead.includes("bulk-1") && dead.includes("bulk-2"), 10_000);
    expect(await deadLetterDepth()).toBe(existingBefore + 2);

    await worker.close();
    worker = startWorker(new MockJudgeProvider(), {
      onSuccess: (result) => succeeded.push(result),
      onDeadLetter: (_batchId, traceId) => dead.push(traceId),
    });

    const count = await requeueAllDeadLetterJobs();
    expect(count).toBe(existingBefore + 2);

    await waitUntil(
      () =>
        succeeded.some((r) => r.traceId === "bulk-1") &&
        succeeded.some((r) => r.traceId === "bulk-2"),
      10_000,
    );
    expect(await deadLetterDepth()).toBe(0);
  });

  it("trackActiveJobs adds a job while active and removes it once completed", async () => {
    // A brief but real delay, not MockJudgeProvider's instant grading -- an instant job can
    // move from "active" to "completed" faster than a 25ms poll ever observes it, which would
    // make this test pass even if trackActiveJobs never added the job in the first place.
    await worker.close();
    const briefOutput: JudgeOutput = {
      verdict: "pass",
      scores: [{ rubric: "grounding", score: 3, justification: "ok" }],
      confidence: "high",
      rationale: "ok",
    };
    const briefDelayProvider: JudgeProvider = {
      name: "brief-delay",
      model: "test",
      grade: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ output: briefOutput, inputTokens: 1, outputTokens: 1 }), 150),
        ),
    };
    worker = startWorker(briefDelayProvider, { onSuccess: (result) => succeeded.push(result) });
    const getActiveJobs = trackActiveJobs(worker);

    await enqueueBatch({ batchId: `track-${suffix}`, traces: [trace("track-me")] });
    await waitUntil(() => getActiveJobs().some((j) => j.traceId === "track-me"), 10_000);
    await waitUntil(() => !getActiveJobs().some((j) => j.traceId === "track-me"), 10_000);
    expect(succeeded.some((r) => r.traceId === "track-me")).toBe(true);
  });

  it("shutdownWithTimeout closes cleanly (not forced) when the active job finishes in time", async () => {
    await worker.close();
    worker = startWorker(new MockJudgeProvider(), {
      onSuccess: (result) => succeeded.push(result),
    });
    const getActiveJobs = trackActiveJobs(worker);

    await enqueueBatch({ batchId: `clean-shutdown-${suffix}`, traces: [trace("clean-shutdown")] });
    await waitUntil(() => succeeded.some((r) => r.traceId === "clean-shutdown"), 10_000);

    const result = await shutdownWithTimeout(worker, 10_000, getActiveJobs);
    expect(result.forced).toBe(false);
    expect(result.stillActive).toEqual([]);

    worker = startWorker(new MockJudgeProvider(), {
      onSuccess: (result) => succeeded.push(result),
      onDeadLetter: (_batchId, traceId) => dead.push(traceId),
    });
  });

  it("shutdownWithTimeout forces after the grace period and reports the still-active job", async () => {
    await worker.close();
    let resolveHungJob: (() => void) | undefined;
    const hungOutput: JudgeOutput = {
      verdict: "pass",
      scores: [{ rubric: "grounding", score: 3, justification: "ok" }],
      confidence: "high",
      rationale: "ok",
    };
    const hungProvider: JudgeProvider = {
      name: "hangs-until-released",
      model: "test",
      grade: () =>
        new Promise((resolve) => {
          resolveHungJob = () => resolve({ output: hungOutput, inputTokens: 1, outputTokens: 1 });
        }),
    };
    worker = startWorker(hungProvider);
    const getActiveJobs = trackActiveJobs(worker);

    await enqueueBatch({ batchId: `hung-${suffix}`, traces: [trace("will-hang")] });
    await waitUntil(() => getActiveJobs().some((j) => j.traceId === "will-hang"), 10_000);

    // Grace period (200ms) is deliberately much shorter than how long the job will actually
    // take to resolve (until resolveHungJob() below is called) -- this is what "a live judge
    // call that never resolves" looks like from the shutdown path's point of view.
    const result = await shutdownWithTimeout(worker, 200, getActiveJobs);
    expect(result.forced).toBe(true);
    expect(result.stillActive).toHaveLength(1);
    expect(result.stillActive[0]?.traceId).toBe("will-hang");
    expect(result.stillActive[0]?.batchId).toBe(`hung-${suffix}`);
    expect(typeof result.stillActive[0]?.jobId).toBe("string");

    // Release the hung job so it doesn't linger indefinitely in Redis, then replace `worker`
    // with a fresh instance for later tests -- the raced-away worker.close() call above is
    // still resolving in the background against the old instance, and BullMQ's close() stops
    // it from picking up further jobs immediately (not just once that promise settles), so a
    // new worker on the same queue name doesn't race it for work.
    resolveHungJob?.();
    await new Promise((resolve) => setTimeout(resolve, 50));
    worker = startWorker(new MockJudgeProvider(), {
      onSuccess: (result) => succeeded.push(result),
      onDeadLetter: (_batchId, traceId) => dead.push(traceId),
    });
  });

  it("pauses the worker once MAX_RUN_COST_USD is exceeded, and resuming lets it continue", async () => {
    await worker.close();
    const output: JudgeOutput = {
      verdict: "pass",
      scores: [{ rubric: "grounding", score: 3, justification: "ok" }],
      confidence: "high",
      rationale: "ok",
    };
    const pricedProvider: JudgeProvider = {
      name: "priced-fake",
      model: "claude-haiku-4-5", // priced at $1.00/million input tokens (observability/pricing.ts)
      grade: () => Promise.resolve({ output, inputTokens: 1_000_000, outputTokens: 0 }), // costUsd = $1.00 exactly
    };
    const priced: JudgeResult[] = [];
    worker = startWorker(pricedProvider, { onSuccess: (result) => priced.push(result) });

    // WORKER_CONCURRENCY is 3 for this file; enqueueing exactly 3 means all three are already
    // in flight by the time the second one's completion crosses MAX_RUN_COST_USD=2 -- no race
    // against a 4th job that may or may not start before the pause takes effect.
    await enqueueBatch({
      batchId: `cost-${suffix}`,
      traces: Array.from({ length: 3 }, (_, i) => trace(`cost-${i}`)),
    });
    await waitUntil(() => worker.isPaused(), 10_000);
    expect(priced.length).toBe(3); // all 3 already-in-flight jobs still finish -- a soft cap

    // A trace enqueued after the pause must not be picked up while paused.
    await enqueueBatch({ batchId: `cost-after-${suffix}`, traces: [trace("cost-after")] });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(priced.length).toBe(3);

    await worker.resume();
    await waitUntil(() => priced.length === 4, 10_000);
    expect(priced.map((r) => r.traceId)).toContain("cost-after");
  });
});
