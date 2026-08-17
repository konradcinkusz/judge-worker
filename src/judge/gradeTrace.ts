import type { Trace } from "../types/trace.js";
import type { JudgeResult } from "../types/judge.js";
import type { JudgeProvider } from "./judgeProvider.js";
import { estimateCostUsd } from "../observability/pricing.js";

/** Times a provider call and assembles the full JudgeResult (scores + provenance + cost). */
export async function gradeTrace(provider: JudgeProvider, trace: Trace): Promise<JudgeResult> {
  const startedAt = Date.now();
  const { output, inputTokens, outputTokens } = await provider.grade(trace);
  const durationMs = Date.now() - startedAt;
  return {
    traceId: trace.traceId,
    scenarioClass: trace.scenarioClass,
    output,
    model: provider.model,
    inputTokens,
    outputTokens,
    costUsd: estimateCostUsd(provider.model, inputTokens, outputTokens),
    durationMs,
  };
}
