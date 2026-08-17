/**
 * Tracks cumulative spend for a single worker run against an optional ceiling
 * (MAX_RUN_COST_USD), so a stuck or misconfigured live judge can be stopped from burning an
 * unbounded budget rather than only being caught after the fact in a bill. See
 * queue/worker.ts for where this pauses the BullMQ worker once tripped.
 */
export class RunCostTracker {
  private totalUsd = 0;

  constructor(private readonly maxUsd: number | undefined) {}

  get total(): number {
    return this.totalUsd;
  }

  /** Records a job's cost (null is a no-cost provider, e.g. the mock judge) and returns whether the ceiling is now exceeded. */
  record(costUsd: number | null): boolean {
    if (costUsd !== null) {
      this.totalUsd += costUsd;
    }
    return this.isExceeded();
  }

  isExceeded(): boolean {
    return this.maxUsd !== undefined && this.totalUsd >= this.maxUsd;
  }
}
