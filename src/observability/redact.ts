import type { JudgeResult } from "../types/judge.js";

/**
 * Enforces the logging policy in docs/SPEC.md §8a (Logging and PII) in code, not just prose:
 * a JudgeResult's `output.rationale` and `output.scores[].justification` are LLM-generated
 * text that can quote or closely paraphrase the underlying conversation, so nothing that
 * reaches a log call site should destructure a JudgeResult by hand -- it should go through
 * this whitelist instead, so a field added to JudgeResult later doesn't silently become
 * loggable just because a call site spread the whole object in.
 */
export function safeResultFields(result: JudgeResult): {
  traceId: string;
  scenarioClass: JudgeResult["scenarioClass"];
  verdict: JudgeResult["output"]["verdict"];
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  durationMs: number;
} {
  return {
    traceId: result.traceId,
    scenarioClass: result.scenarioClass,
    verdict: result.output.verdict,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
    durationMs: result.durationMs,
  };
}

/**
 * Bounds a third-party error message before it reaches a log line. This repo's own thrown
 * errors never interpolate trace content (only IDs and short enum-like fields -- see the
 * policy doc), but an upstream dependency's error text (the Anthropic SDK, ioredis, BullMQ)
 * is not under this repo's control and is not guaranteed to make the same promise.
 */
export function truncateForLog(value: string, maxChars = 200): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}… (truncated)` : value;
}

/**
 * Bounds an Error's message *and* rebuilds its stack from the same bounded message -- Node's
 * default `Error.prototype.stack` starts with `${name}: ${message}` before the call frames,
 * so truncating only `.message` and logging the original `.stack` alongside it still leaks
 * the full text back in through the header line. Call frames themselves (`    at ...`) never
 * contain trace content, so they're kept as-is.
 */
export function redactError(
  err: Error,
  maxMessageChars = 200,
): { name: string; message: string; stack?: string } {
  const message = truncateForLog(err.message, maxMessageChars);
  if (err.stack === undefined) {
    return { name: err.name, message };
  }
  const frameLines = err.stack.split("\n").filter((line) => /^\s+at\s/.test(line));
  return { name: err.name, message, stack: [`${err.name}: ${message}`, ...frameLines].join("\n") };
}
