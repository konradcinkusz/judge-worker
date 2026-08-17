import type { Trace } from "../types/trace.js";
import type { JudgeProvider } from "./judgeProvider.js";

/**
 * Wraps another provider with an artificial delay before returning. The mock judge does no
 * I/O, so a load test against it says nothing about what happens when jobs take real time to
 * process -- this exists so the load test CLI (--simulate-latency-ms) can make production
 * genuinely outpace consumption and actually exercise the queue-depth backpressure guard,
 * instead of only proving it in a unit test. See FINDINGS.md's "Backpressure" section for a
 * real run using this.
 */
export class LatencyInjectingJudgeProvider implements JudgeProvider {
  readonly name: string;
  readonly model: string;
  private readonly inner: JudgeProvider;
  private readonly delayMs: number;

  constructor(inner: JudgeProvider, delayMs: number) {
    this.inner = inner;
    this.delayMs = delayMs;
    this.name = `${inner.name}+${delayMs}ms-latency`;
    this.model = inner.model;
  }

  async grade(trace: Trace): ReturnType<JudgeProvider["grade"]> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return this.inner.grade(trace);
  }
}
