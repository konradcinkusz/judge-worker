/**
 * List pricing, USD per million tokens, first-party Claude API rates as of PRICING_LAST_VERIFIED.
 * Source: Anthropic pricing docs (see docs/SPEC.md §6 for the citation and refresh policy —
 * these numbers drift with every model launch and are not re-verified automatically).
 * test/pricing.test.ts fails once PRICING_LAST_VERIFIED is more than
 * PRICING_STALENESS_LIMIT_MONTHS old, forcing a human to re-check rather than letting this
 * table drift silently forever.
 */
export const PRICING_LAST_VERIFIED = "2026-08-17";
export const PRICING_STALENESS_LIMIT_MONTHS = 6;

const PRICING_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-5": { input: 3.0, output: 15.0 },
  "claude-opus-5": { input: 5.0, output: 25.0 },
};

/** Whole calendar months between two dates, ignoring day-of-month (rounds down towards
 *  `from` -- e.g. 2026-08-17 to 2027-01-01 is 5 months, not 4.46). */
export function monthsBetween(from: Date, to: Date): number {
  return (
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth())
  );
}

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
