import type { Trace } from "../types/trace.js";
import type { JudgeOutput } from "../types/judge.js";

/**
 * Layer 2 grading contract (interface + registration extensibility, per
 * architecture-standards P10 — a new judge is one class implementing this, no base class).
 */
export interface JudgeProvider {
  readonly name: string;
  readonly model: string;
  grade(trace: Trace): Promise<{
    output: JudgeOutput;
    inputTokens: number;
    outputTokens: number;
  }>;
}
