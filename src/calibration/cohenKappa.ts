/**
 * Unweighted Cohen's kappa, ported from agent-eval-bench's Calibration.CohenKappa. Unweighted
 * on purpose: a weighted kappa gives partial credit for being one anchor level out, and these
 * rubric anchors (src/judge/rubric.ts) are written so that one level out is a real
 * disagreement, not a rounding error.
 */
export interface RatingPair {
  judge: number;
  human: number;
}

/**
 * Returns null ("undefined"), never 1.0, when every pair falls in a single shared category —
 * two raters who both always say "3" have demonstrated nothing, and reporting perfect
 * agreement there would be the easiest way to fake a calibration result.
 */
export function cohenKappa(pairs: readonly RatingPair[]): number | null {
  if (pairs.length === 0) return null;

  const categories = new Set<number>();
  for (const pair of pairs) {
    categories.add(pair.judge);
    categories.add(pair.human);
  }

  const n = pairs.length;
  const judgeMarginal = new Map<number, number>();
  const humanMarginal = new Map<number, number>();
  let agreements = 0;

  for (const category of categories) {
    judgeMarginal.set(category, 0);
    humanMarginal.set(category, 0);
  }
  for (const pair of pairs) {
    judgeMarginal.set(pair.judge, (judgeMarginal.get(pair.judge) ?? 0) + 1);
    humanMarginal.set(pair.human, (humanMarginal.get(pair.human) ?? 0) + 1);
    if (pair.judge === pair.human) agreements += 1;
  }

  const observedAgreement = agreements / n;
  let expectedAgreement = 0;
  for (const category of categories) {
    expectedAgreement +=
      ((judgeMarginal.get(category) ?? 0) / n) * ((humanMarginal.get(category) ?? 0) / n);
  }

  if (Math.abs(1 - expectedAgreement) < 1e-9) return null;
  return (observedAgreement - expectedAgreement) / (1 - expectedAgreement);
}
