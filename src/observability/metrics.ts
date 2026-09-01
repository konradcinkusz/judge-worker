import type { JudgeResult } from "../types/judge.js";

/**
 * Per-batch accounting for throughput, latency, reliability and cost efficiency -- the four
 * numbers that decide whether this pipeline is worth running. One instance per batch; the worker feeds it as jobs complete and the
 * CLI prints/persists the summary — see cli/loadtest.ts for a real (not projected) run.
 */
export class BatchMetrics {
  readonly batchId: string;
  private readonly startedAt = Date.now();
  private finishedAt: number | undefined;
  private succeeded = 0;
  private failed = 0;
  private deadLettered = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCostUsd = 0;
  private hasCost = false;
  private readonly latenciesMs: number[] = [];

  constructor(batchId: string) {
    this.batchId = batchId;
  }

  recordSuccess(result: JudgeResult): void {
    this.succeeded += 1;
    this.totalInputTokens += result.inputTokens;
    this.totalOutputTokens += result.outputTokens;
    if (result.costUsd !== null) {
      this.totalCostUsd += result.costUsd;
      this.hasCost = true;
    }
    this.latenciesMs.push(result.durationMs);
  }

  recordFailure(): void {
    this.failed += 1;
  }

  recordDeadLetter(): void {
    this.deadLettered += 1;
  }

  finish(): void {
    this.finishedAt = Date.now();
  }

  summary(): BatchSummary {
    const end = this.finishedAt ?? Date.now();
    const durationMs = end - this.startedAt;
    const total = this.succeeded + this.failed;
    const sorted = [...this.latenciesMs].sort((a, b) => a - b);
    return {
      batchId: this.batchId,
      succeeded: this.succeeded,
      failed: this.failed,
      deadLettered: this.deadLettered,
      totalTraces: total,
      durationMs,
      throughputPerSec: durationMs > 0 ? (this.succeeded / durationMs) * 1000 : 0,
      latencyMsP50: percentile(sorted, 0.5),
      latencyMsP95: percentile(sorted, 0.95),
      latencyMsMax: sorted.length > 0 ? sorted[sorted.length - 1]! : 0,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalCostUsd: this.hasCost ? this.totalCostUsd : null,
    };
  }
}

export interface BatchSummary {
  batchId: string;
  succeeded: number;
  failed: number;
  deadLettered: number;
  totalTraces: number;
  durationMs: number;
  throughputPerSec: number;
  latencyMsP50: number;
  latencyMsP95: number;
  latencyMsMax: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number | null;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const index = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length));
  return sortedAsc[index]!;
}
