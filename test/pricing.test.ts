import { describe, expect, it } from "vitest";
import {
  estimateCostUsd,
  monthsBetween,
  PRICING_LAST_VERIFIED,
  PRICING_STALENESS_LIMIT_MONTHS,
} from "../src/observability/pricing.js";

describe("observability/pricing.ts monthsBetween", () => {
  it("is 0 for the same month", () => {
    expect(monthsBetween(new Date("2026-08-01"), new Date("2026-08-31"))).toBe(0);
  });

  it("counts whole months, rounding down towards the earlier date", () => {
    // 2026-08-17 -> 2027-01-01: Aug->Sep->Oct->Nov->Dec->Jan is 5 months elapsed, not 4.46 --
    // the day-of-month (17th vs 1st) is ignored, only the month field is compared.
    expect(monthsBetween(new Date("2026-08-17"), new Date("2027-01-01"))).toBe(5);
  });

  it("crosses year boundaries correctly", () => {
    expect(monthsBetween(new Date("2025-11-01"), new Date("2026-02-01"))).toBe(3);
  });
});

describe("observability/pricing.ts staleness trip-wire", () => {
  it(`fails once more than ${PRICING_STALENESS_LIMIT_MONTHS} months have passed since PRICING_LAST_VERIFIED`, () => {
    const elapsed = monthsBetween(new Date(PRICING_LAST_VERIFIED), new Date());
    expect(
      elapsed,
      `PRICING_PER_MILLION_TOKENS (src/observability/pricing.ts) was last verified ` +
        `${PRICING_LAST_VERIFIED}, ${elapsed} months ago (limit ` +
        `${PRICING_STALENESS_LIMIT_MONTHS}). Re-check current rates at ` +
        `https://platform.claude.com/docs/en/pricing, update the table, and bump ` +
        `PRICING_LAST_VERIFIED.`,
    ).toBeLessThanOrEqual(PRICING_STALENESS_LIMIT_MONTHS);
  });
});

describe("observability/pricing.ts estimateCostUsd", () => {
  it("computes cost from input/output token counts at the model's per-million rate", () => {
    // claude-haiku-4-5: $1.00/million input, $5.00/million output.
    expect(estimateCostUsd("claude-haiku-4-5", 1_000_000, 0)).toBeCloseTo(1.0);
    expect(estimateCostUsd("claude-haiku-4-5", 0, 1_000_000)).toBeCloseTo(5.0);
    expect(estimateCostUsd("claude-haiku-4-5", 500_000, 200_000)).toBeCloseTo(0.5 + 1.0);
  });

  it("returns null for a model with no pricing entry rather than guessing", () => {
    expect(estimateCostUsd("mock-heuristic-v1", 1000, 1000)).toBeNull();
    expect(estimateCostUsd("some-future-model-not-yet-priced", 1, 1)).toBeNull();
  });

  it("returns 0 for zero tokens against a known model, not null", () => {
    expect(estimateCostUsd("claude-sonnet-5", 0, 0)).toBe(0);
  });
});
