import { describe, expect, it } from "vitest";
import {
  buildCalibrationReport,
  CALIBRATION_GATE,
  type HumanLabel,
} from "../src/calibration/calibrate.js";
import type { JudgeResult } from "../src/types/judge.js";

function judgeResult(traceId: string, rubric: "grounding", score: 0 | 1 | 2 | 3): JudgeResult {
  return {
    traceId,
    scenarioClass: "happy",
    output: {
      verdict: "pass",
      scores: [{ rubric, score, justification: "because" }],
      confidence: "high",
      rationale: "r",
    },
    model: "mock-heuristic-v1",
    inputTokens: 10,
    outputTokens: 10,
    costUsd: null,
    durationMs: 1,
  };
}

function label(traceId: string, rubric: "grounding", score: 0 | 1 | 2 | 3): HumanLabel {
  return { traceId, rubric, score, labeller: "kc", date: "2026-08-17" };
}

describe("buildCalibrationReport", () => {
  it("reports NOT calibrated below the minimum label count, even with perfect agreement", () => {
    const labels = [label("t1", "grounding", 3)];
    const results = [judgeResult("t1", "grounding", 3)];
    const report = buildCalibrationReport(labels, results);
    expect(report.gating).toBe(false);
    expect(report.reason).toContain("NOT calibrated");
    expect(report.reason).toContain(`>= ${CALIBRATION_GATE.minimumLabels}`);
  });

  it("gates when there are enough labels and kappa clears the bar", () => {
    const traceIds = Array.from({ length: CALIBRATION_GATE.minimumLabels }, (_, i) => `t${i}`);
    const scores: (0 | 1 | 2 | 3)[] = [0, 1, 2, 3];
    const labels = traceIds.map((id, i) => label(id, "grounding", scores[i % 4]!));
    const results = traceIds.map((id, i) => judgeResult(id, "grounding", scores[i % 4]!));
    const report = buildCalibrationReport(labels, results);
    expect(report.overallKappa).toBeCloseTo(1.0, 6);
    expect(report.gating).toBe(true);
    expect(report.reason).toBe("Calibrated: Layer 2 scores may gate.");
  });

  it("does not gate when kappa is below the 0.6 bar, and says so honestly", () => {
    const traceIds = Array.from({ length: CALIBRATION_GATE.minimumLabels }, (_, i) => `t${i}`);
    // Judge and human disagree on roughly half the pairs -- not chance level, but well
    // under the substantial-agreement bar.
    const labels = traceIds.map((id, i) => label(id, "grounding", (i % 4) as 0 | 1 | 2 | 3));
    const results = traceIds.map((id, i) =>
      judgeResult(id, "grounding", ((i + 2) % 4) as 0 | 1 | 2 | 3),
    );
    const report = buildCalibrationReport(labels, results);
    expect(report.gating).toBe(false);
    expect(report.reason).toContain("gate nothing");
  });

  it("ignores labels for a (traceId, rubric) the judge never scored", () => {
    const labels = [label("unknown-trace", "grounding", 3)];
    const results: JudgeResult[] = [];
    const report = buildCalibrationReport(labels, results);
    expect(report.overallKappa).toBeNull();
    expect(report.labelCount).toBe(1);
  });
});
