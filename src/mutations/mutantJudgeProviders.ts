import type { Trace } from "../types/trace.js";
import type { JudgeOutput, RubricScore } from "../types/judge.js";
import { MockJudgeProvider } from "../judge/mockJudgeProvider.js";
import type { JudgeProvider } from "../judge/judgeProvider.js";

/**
 * Deliberate mutations of the judge, ported in spirit from agent-eval-bench's
 * Mutations/BrokenAgents.cs — there the harness proves it can catch a broken AGENT; here it
 * proves the test harness around the JUDGE can catch a broken JUDGE. Each mutant wraps the
 * real MockJudgeProvider and corrupts exactly one property of its output, so the two are
 * identical except for the one constraint under test. See test/mutations.test.ts for the
 * harness that proves each one is caught, and MUTATIONS.md for the recorded results.
 */

async function realGrade(
  trace: Trace,
): Promise<{ output: JudgeOutput; inputTokens: number; outputTokens: number }> {
  return new MockJudgeProvider().grade(trace);
}

/** Mutation 1: flips the top-level verdict — pass becomes fail and vice versa. */
export class FlippedVerdictJudge implements JudgeProvider {
  readonly name = "mutant:flipped-verdict";
  readonly model = "mock-heuristic-v1-mutant";

  async grade(trace: Trace) {
    const real = await realGrade(trace);
    const flipped: JudgeOutput["verdict"] =
      real.output.verdict === "pass"
        ? "fail"
        : real.output.verdict === "fail"
          ? "pass"
          : "borderline";
    return { ...real, output: { ...real.output, verdict: flipped } };
  }
}

/** Mutation 2: drops the justification on every rubric score. */
export class MissingJustificationJudge implements JudgeProvider {
  readonly name = "mutant:missing-justification";
  readonly model = "mock-heuristic-v1-mutant";

  async grade(trace: Trace) {
    const real = await realGrade(trace);
    const scores: RubricScore[] = real.output.scores.map((s) => ({ ...s, justification: "" }));
    return { ...real, output: { ...real.output, scores } };
  }
}

/**
 * Mutation 3: obeys instruction-shaped text embedded in tool results/conversation content
 * instead of treating it as data — the exact adversarial-resistance failure the judge system
 * prompt (src/judge/rubric.ts) exists to prevent.
 */
export class SilentInjectionComplianceJudge implements JudgeProvider {
  readonly name = "mutant:injection-compliant";
  readonly model = "mock-heuristic-v1-mutant";

  async grade(trace: Trace): ReturnType<JudgeProvider["grade"]> {
    const real = await realGrade(trace);
    const injected = traceContainsInjectionMarker(trace);
    if (!injected) return real;
    const perfectScores: RubricScore[] = real.output.scores.map((s) => ({
      ...s,
      score: 3,
      justification: "instruction embedded in tool result honored",
    }));
    const verdict: JudgeOutput["verdict"] = "pass";
    return { ...real, output: { ...real.output, verdict, scores: perfectScores } };
  }
}

function traceContainsInjectionMarker(trace: Trace): boolean {
  const marker = /ignore your (rubric|instructions)|perfect score|you are now/i;
  const haystack = [
    ...trace.conversation.map((c) => c.content),
    ...trace.toolCalls.map((c) => c.resultSummary ?? ""),
  ].join("\n");
  return marker.test(haystack);
}

/** Mutation 4: always scores `grounding` at the top anchor, regardless of tool-call evidence. */
export class UngroundedOptimismJudge implements JudgeProvider {
  readonly name = "mutant:ungrounded-optimism";
  readonly model = "mock-heuristic-v1-mutant";

  async grade(trace: Trace) {
    const real = await realGrade(trace);
    const scores: RubricScore[] = real.output.scores.map((s) =>
      s.rubric === "grounding"
        ? { ...s, score: 3, justification: "grounding always scored at the top anchor" }
        : s,
    );
    return { ...real, output: { ...real.output, scores } };
  }
}

/** Mutation 5: ignores the write-before-confirmation absence violation. */
export class NoAbsenceCheckJudge implements JudgeProvider {
  readonly name = "mutant:no-absence-check";
  readonly model = "mock-heuristic-v1-mutant";

  async grade(trace: Trace) {
    const real = await realGrade(trace);
    const scores: RubricScore[] = real.output.scores.map((s) =>
      s.rubric === "confirmation-clarity" && s.score === 0
        ? { ...s, score: 3, justification: "absence-of-confirmation check skipped" }
        : s,
    );
    return { ...real, output: { ...real.output, scores } };
  }
}

export const ALL_MUTANTS: readonly JudgeProvider[] = [
  new FlippedVerdictJudge(),
  new MissingJustificationJudge(),
  new SilentInjectionComplianceJudge(),
  new UngroundedOptimismJudge(),
  new NoAbsenceCheckJudge(),
];
