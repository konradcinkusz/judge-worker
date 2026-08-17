import { describe, expect, it, beforeEach } from "vitest";
import type { JudgeResult } from "../src/types/judge.js";
import {
  metricsRegistry,
  recordJobSuccess,
  recordJobRetry,
  recordDeadLetter,
} from "../src/observability/prometheusMetrics.js";

function result(overrides: Partial<JudgeResult> = {}): JudgeResult {
  return {
    traceId: "t1",
    scenarioClass: "happy",
    output: {
      verdict: "pass",
      scores: [{ rubric: "grounding", score: 3, justification: "ok" }],
      confidence: "high",
      rationale: "ok",
    },
    model: "claude-haiku-4-5",
    inputTokens: 100,
    outputTokens: 20,
    costUsd: 0.001,
    durationMs: 250,
    ...overrides,
  };
}

describe("observability/prometheusMetrics.ts", () => {
  // metricsRegistry is a module-level singleton (so /metrics reflects the whole process);
  // reset between tests so counters don't accumulate across cases in this file.
  beforeEach(() => {
    metricsRegistry.resetMetrics();
  });

  it("recordJobSuccess increments the graded-total counter labeled by verdict", async () => {
    recordJobSuccess(result({ output: { ...result().output, verdict: "pass" } }));
    recordJobSuccess(result({ output: { ...result().output, verdict: "fail" } }));

    const body = await metricsRegistry.metrics();
    expect(body).toContain('judge_worker_jobs_graded_total{verdict="pass"} 1');
    expect(body).toContain('judge_worker_jobs_graded_total{verdict="fail"} 1');
  });

  it("recordJobSuccess observes duration in seconds, not milliseconds", async () => {
    recordJobSuccess(result({ durationMs: 2000 }));
    const body = await metricsRegistry.metrics();
    // A 2000ms job must land in the >= 2.5s bucket, not the smallest one.
    expect(body).toContain('judge_worker_job_duration_seconds_bucket{le="2.5"} 1');
    expect(body).toContain('judge_worker_job_duration_seconds_bucket{le="0.05"} 0');
  });

  it("recordJobSuccess accumulates token and cost totals across calls", async () => {
    recordJobSuccess(result({ inputTokens: 100, outputTokens: 20, costUsd: 0.001 }));
    recordJobSuccess(result({ inputTokens: 50, outputTokens: 10, costUsd: 0.0005 }));

    const body = await metricsRegistry.metrics();
    expect(body).toContain('judge_worker_tokens_total{direction="input"} 150');
    expect(body).toContain('judge_worker_tokens_total{direction="output"} 30');
    expect(body).toContain("judge_worker_cost_usd_total 0.0015");
  });

  it("a null costUsd (the mock judge) does not advance the cost counter", async () => {
    recordJobSuccess(result({ costUsd: null }));
    const body = await metricsRegistry.metrics();
    expect(body).toContain("judge_worker_cost_usd_total 0");
  });

  it("recordJobRetry and recordDeadLetter increment their own counters", async () => {
    recordJobRetry();
    recordJobRetry();
    recordDeadLetter();

    const body = await metricsRegistry.metrics();
    expect(body).toContain("judge_worker_job_retries_total 2");
    expect(body).toContain("judge_worker_jobs_dead_lettered_total 1");
  });
});
