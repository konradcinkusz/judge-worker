import type { Trace } from "../types/trace.js";
import type { JudgeProvider } from "./judgeProvider.js";

export interface CircuitBreakerOptions {
  /** Consecutive failures before the circuit opens and starts failing fast. */
  failureThreshold: number;
  /** How long the circuit stays open before letting one trial call through (half-open). */
  resetTimeoutMs: number;
}

export class CircuitOpenError extends Error {
  constructor(consecutiveFailures: number) {
    super(
      `circuit breaker open after ${consecutiveFailures} consecutive failures -- failing fast without calling the provider`,
    );
    this.name = "CircuitOpenError";
  }
}

/**
 * Wraps a judge provider so a batch of failing live-API calls trips a breaker instead of every
 * job independently burning through the Anthropic SDK's own per-call retries (see
 * ANTHROPIC_MAX_RETRIES) against a downed or rate-limited endpoint. Standard
 * closed -> open -> half-open state machine; BullMQ still retries the individual job per
 * JOB_ATTEMPTS regardless of this provider's state, so a CircuitOpenError still counts toward
 * that job's own attempts.
 */
export class CircuitBreakerJudgeProvider implements JudgeProvider {
  readonly name: string;
  readonly model: string;
  private readonly inner: JudgeProvider;
  private readonly options: CircuitBreakerOptions;
  private consecutiveFailures = 0;
  private state: "closed" | "open" | "half-open" = "closed";
  private openedAt = 0;

  constructor(inner: JudgeProvider, options: CircuitBreakerOptions) {
    this.inner = inner;
    this.options = options;
    this.name = `${inner.name}+circuit-breaker`;
    this.model = inner.model;
  }

  async grade(trace: Trace): ReturnType<JudgeProvider["grade"]> {
    if (this.state === "open") {
      if (Date.now() - this.openedAt < this.options.resetTimeoutMs) {
        throw new CircuitOpenError(this.consecutiveFailures);
      }
      this.state = "half-open";
    }

    try {
      const result = await this.inner.grade(trace);
      this.consecutiveFailures = 0;
      this.state = "closed";
      return result;
    } catch (err) {
      this.consecutiveFailures += 1;
      if (this.state === "half-open" || this.consecutiveFailures >= this.options.failureThreshold) {
        this.state = "open";
        this.openedAt = Date.now();
      }
      throw err;
    }
  }
}
