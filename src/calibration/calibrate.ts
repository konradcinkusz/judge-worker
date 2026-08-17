import { readFile } from "node:fs/promises";
import { z } from "zod";
import { RUBRIC_CRITERIA, type RubricCriterion } from "../types/judge.js";
import type { JudgeResult } from "../types/judge.js";
import { cohenKappa } from "./cohenKappa.js";

/**
 * Human label format, ported from agent-eval-bench's evals/calibration/labels.jsonl:
 * append-only JSONL, one label per line, `labeller` is a handle rather than a name because
 * this repo is public. Labels must be written without reading the judge's own scores first —
 * reading them first measures agreement with the judge, not calibration of it.
 */
const humanLabelSchema = z.object({
  traceId: z.string().min(1),
  rubric: z.enum(RUBRIC_CRITERIA),
  score: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  labeller: z.string().min(1),
  date: z.string().min(1),
});
export type HumanLabel = z.infer<typeof humanLabelSchema>;

export async function loadHumanLabels(path: string): Promise<HumanLabel[]> {
  const raw = await readFile(path, "utf-8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"))
    .map((line) => humanLabelSchema.parse(JSON.parse(line)));
}

/**
 * Gate constants. Cohen's kappa >= 0.6 ("substantial agreement") is the same bar
 * agent-eval-bench uses. The sample-size floor is deliberately smaller here (10, vs.
 * agent-eval-bench's 40-labels/8-scenarios convention) per this repo's own master spec,
 * which asks for a 10-20 trace human-labeled sample — a smaller, honestly-scoped demo bar,
 * not a claim that 10 labels is what production calibration should require.
 */
export const CALIBRATION_GATE = {
  minimumLabels: 10,
  minimumKappa: 0.6,
};

export interface CalibrationReport {
  labelCount: number;
  distinctTraces: number;
  overallKappa: number | null;
  perRubricKappa: Partial<Record<RubricCriterion, number | null>>;
  gating: boolean;
  reason: string;
}

/** Pairs human labels against the judge's own scores for the same (trace, rubric) and reports kappa. */
export function buildCalibrationReport(
  labels: readonly HumanLabel[],
  judgeResults: readonly JudgeResult[],
): CalibrationReport {
  const judgeScoreByKey = new Map<string, number>();
  for (const result of judgeResults) {
    for (const score of result.output.scores) {
      judgeScoreByKey.set(`${result.traceId}::${score.rubric}`, score.score);
    }
  }

  const overallPairs: { judge: number; human: number }[] = [];
  const perRubricPairs = new Map<RubricCriterion, { judge: number; human: number }[]>();
  const distinctTraces = new Set<string>();

  for (const label of labels) {
    distinctTraces.add(label.traceId);
    const judgeScore = judgeScoreByKey.get(`${label.traceId}::${label.rubric}`);
    if (judgeScore === undefined) continue; // no judge output for this pair — not comparable, not counted
    overallPairs.push({ judge: judgeScore, human: label.score });
    const existing = perRubricPairs.get(label.rubric) ?? [];
    existing.push({ judge: judgeScore, human: label.score });
    perRubricPairs.set(label.rubric, existing);
  }

  const overallKappa = cohenKappa(overallPairs);
  const perRubricKappa: Partial<Record<RubricCriterion, number | null>> = {};
  for (const [rubric, pairs] of perRubricPairs) {
    perRubricKappa[rubric] = cohenKappa(pairs);
  }

  const reasons: string[] = [];
  if (labels.length < CALIBRATION_GATE.minimumLabels) {
    reasons.push(`only ${labels.length} labels (need >= ${CALIBRATION_GATE.minimumLabels})`);
  }
  if (overallKappa === null) {
    reasons.push("kappa is undefined (labels show no discriminating spread)");
  } else if (overallKappa < CALIBRATION_GATE.minimumKappa) {
    reasons.push(
      `kappa ${overallKappa.toFixed(3)} is below the ${CALIBRATION_GATE.minimumKappa} bar`,
    );
  }

  const gating = reasons.length === 0;
  return {
    labelCount: labels.length,
    distinctTraces: distinctTraces.size,
    overallKappa,
    perRubricKappa,
    gating,
    reason: gating
      ? "Calibrated: Layer 2 scores may gate."
      : `NOT calibrated -- ${reasons.join("; ")}. Layer 2 scores are reported and gate nothing.`,
  };
}
