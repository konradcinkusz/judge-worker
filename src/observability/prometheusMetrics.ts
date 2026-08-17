import { Registry, Counter, Histogram, collectDefaultMetrics } from "prom-client";
import type { JudgeResult } from "../types/judge.js";

/**
 * Prometheus counterpart to BatchMetrics (metrics.ts): that class summarizes one bounded
 * CLI run (a load test, a calibration pass); this registers the same underlying per-job data
 * (JudgeResult fields) as live counters/histograms for a long-lived worker process to expose
 * over /metrics (see metricsServer.ts) rather than only printing a summary at the end.
 */
export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

const jobsGradedTotal = new Counter({
  name: "judge_worker_jobs_graded_total",
  help: "Total traces successfully graded, by verdict.",
  labelNames: ["verdict"],
  registers: [metricsRegistry],
});

const jobRetriesTotal = new Counter({
  name: "judge_worker_job_retries_total",
  help: "Total retryable job-attempt failures (attempts remained).",
  registers: [metricsRegistry],
});

const jobsDeadLetteredTotal = new Counter({
  name: "judge_worker_jobs_dead_lettered_total",
  help: "Total jobs moved to the dead-letter queue after exhausting retries.",
  registers: [metricsRegistry],
});

const jobDurationSeconds = new Histogram({
  name: "judge_worker_job_duration_seconds",
  help: "Wall-clock duration of a single grade call.",
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [metricsRegistry],
});

const costUsdTotal = new Counter({
  name: "judge_worker_cost_usd_total",
  help: "Cumulative estimated cost in USD. Only non-null JudgeResult.costUsd values count, so this never advances against the mock judge (no pricing entry -- see observability/pricing.ts).",
  registers: [metricsRegistry],
});

const tokensTotal = new Counter({
  name: "judge_worker_tokens_total",
  help: "Cumulative input/output tokens across all graded traces.",
  labelNames: ["direction"],
  registers: [metricsRegistry],
});

export function recordJobSuccess(result: JudgeResult): void {
  jobsGradedTotal.inc({ verdict: result.output.verdict });
  jobDurationSeconds.observe(result.durationMs / 1000);
  tokensTotal.inc({ direction: "input" }, result.inputTokens);
  tokensTotal.inc({ direction: "output" }, result.outputTokens);
  if (result.costUsd !== null) {
    costUsdTotal.inc(result.costUsd);
  }
}

export function recordJobRetry(): void {
  jobRetriesTotal.inc();
}

export function recordDeadLetter(): void {
  jobsDeadLetteredTotal.inc();
}
