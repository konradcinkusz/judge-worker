import { describe, expect, it, afterAll } from "vitest";
import type { Trace } from "../src/types/trace.js";
import type { JudgeResult } from "../src/types/judge.js";
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
process.env["LOG_LEVEL"] = "error";

const { enqueueBatch, closeQueue, QueueDepthExceededError } =
  await import("../src/queue/producer.js");
const { startWorker } = await import("../src/queue/worker.js");
const { closeRedisConnection } = await import("../src/queue/connection.js");
const { MockJudgeProvider } = await import("../src/judge/mockJudgeProvider.js");
const { deadLetterDepth } = await import("../src/reliability/deadLetter.js");

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
});
