import { z } from "zod";
import type { ScenarioClass } from "./trace.js";

/**
 * Layer 2 grading contract, ported from agent-eval-bench's RubricJudge.cs (JudgeVerdict /
 * RubricScore). Two deliberate departures, both noted here so they read as decisions, not
 * drift:
 *  - agent-eval-bench has no `confidence` field (it substitutes calibration-against-humans
 *    for self-reported confidence). This repo's master spec asks for verdict/score/
 *    confidence/rationale explicitly, so `confidence` is included — treat it as the judge's
 *    own signal, and treat calibration (src/calibration) as the independent check on whether
 *    that signal, and the scores themselves, can be trusted.
 *  - a top-level `verdict` is added (pass/borderline/fail) since agent-eval-bench's per-trace
 *    output is a bag of per-rubric scores with no single verdict; this repo's async
 *    post-processing use case wants one triage signal per trace to route on.
 */

export const RUBRIC_CRITERIA = [
  "grounding",
  "confirmation-clarity",
  "refusal-clarity",
  "degradation-honesty",
  "tone",
] as const;
export type RubricCriterion = (typeof RUBRIC_CRITERIA)[number];

/** Which criteria apply to which scenario class — mirrors judge.yaml's `applies_to`. */
export const RUBRICS_BY_CLASS: Record<ScenarioClass, readonly RubricCriterion[]> = {
  happy: ["grounding", "tone"],
  ambiguity: ["grounding", "confirmation-clarity"],
  denied: ["refusal-clarity", "tone"],
  adversarial: ["refusal-clarity", "grounding"],
  degradation: ["degradation-honesty", "grounding"],
};

/** 0-3 ordinal scale, anchored per criterion — never a 1-10 rating (agent-eval-bench's rule). */
export const SCORE_SCALE = [0, 1, 2, 3] as const;

export const rubricScoreSchema = z.object({
  rubric: z.enum(RUBRIC_CRITERIA),
  score: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  justification: z.string().min(1, "a score without a justification cannot be reviewed"),
});
export type RubricScore = z.infer<typeof rubricScoreSchema>;

export const judgeVerdictSchema = z.enum(["pass", "borderline", "fail"]);
export type JudgeVerdict = z.infer<typeof judgeVerdictSchema>;

export const confidenceSchema = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof confidenceSchema>;

/** The judge's structured output — what a grader call returns, ported per RubricJudge.cs. */
export const judgeOutputSchema = z.object({
  verdict: judgeVerdictSchema,
  scores: z.array(rubricScoreSchema).min(1),
  confidence: confidenceSchema,
  rationale: z.string().min(1, "an unjustified verdict cannot be reviewed"),
});
export type JudgeOutput = z.infer<typeof judgeOutputSchema>;

/** Full per-trace grading result: judge output plus provenance and cost accounting. */
export interface JudgeResult {
  traceId: string;
  scenarioClass: ScenarioClass;
  output: JudgeOutput;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  durationMs: number;
}

export const JUDGE_VERSION = "1.0.0";
