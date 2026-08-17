/**
 * List pricing, USD per million tokens, first-party Claude API rates as of 2026-08-17.
 * Source: Anthropic pricing docs (see docs/SPEC.md §6 for the citation and refresh policy —
 * these numbers drift with every model launch and are not re-verified automatically).
 */
const PRICING_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-5": { input: 3.0, output: 15.0 },
  "claude-opus-5": { input: 5.0, output: 25.0 },
};

/** Returns null for an unpriced/unknown model rather than guessing a number. */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const rate = PRICING_PER_MILLION_TOKENS[model];
  if (!rate) return null;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}
