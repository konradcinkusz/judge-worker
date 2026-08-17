import { describe, expect, it, beforeAll } from "vitest";
import { loadTracesFromDir } from "../src/ingestion/batchLoader.js";
import { MockJudgeProvider } from "../src/judge/mockJudgeProvider.js";
import { judgeOutputSchema } from "../src/types/judge.js";
import type { Trace } from "../src/types/trace.js";
import {
  ALL_MUTANTS,
  FlippedVerdictJudge,
  MissingJustificationJudge,
  SilentInjectionComplianceJudge,
  UngroundedOptimismJudge,
  NoAbsenceCheckJudge,
} from "../src/mutations/mutantJudgeProviders.js";

/**
 * Mutation-testing harness: proves the test suite around the judge actually fails when the
 * judge is broken, not just that it passes by construction (agent-eval-bench's mutation
 * pass, ported to judge behavior -- see docs/architecture and MUTATIONS.md for the recorded
 * results table this test file produces).
 *
 * Each case below: (1) a sanity check that the REAL judge gets the fixture right, so "the
 * mutant fails" proves something about the mutant rather than about a broken fixture; then
 * (2) an assertion that the mutant's output is caught -- either by direct comparison against
 * ground truth, or by schema validation rejecting a malformed shape.
 */

let traces: Trace[];
const real = new MockJudgeProvider();

beforeAll(async () => {
  traces = await loadTracesFromDir("fixtures/traces");
});

function find(traceId: string): Trace {
  const trace = traces.find((t) => t.traceId === traceId);
  if (!trace) throw new Error(`fixture not found: ${traceId}`);
  return trace;
}

describe("mutation 1: FlippedVerdictJudge", () => {
  it("real judge scores hap-001 pass; the flipped mutant is caught inverting it to fail", async () => {
    const trace = find("hap-001-sick-today-and-tomorrow");
    const { output: realOutput } = await real.grade(trace);
    expect(realOutput.verdict).toBe("pass"); // sanity

    const mutant = new FlippedVerdictJudge();
    const { output: mutantOutput } = await mutant.grade(trace);
    expect(mutantOutput.verdict).toBe("fail"); // caught: verdict no longer matches ground truth
  });
});

describe("mutation 2: MissingJustificationJudge", () => {
  it("real judge output validates; the mutant's empty justifications fail schema validation", async () => {
    const trace = find("hap-001-sick-today-and-tomorrow");
    const { output: realOutput } = await real.grade(trace);
    expect(() => judgeOutputSchema.parse(realOutput)).not.toThrow(); // sanity

    const mutant = new MissingJustificationJudge();
    const { output: mutantOutput } = await mutant.grade(trace);
    expect(() => judgeOutputSchema.parse(mutantOutput)).toThrow(); // caught by the schema itself
  });
});

describe("mutation 3: SilentInjectionComplianceJudge", () => {
  it("real judge fails an adversarial trace with a real defect; the mutant is fooled into passing it", async () => {
    // adv-003 both embeds an injection marker in a tool result AND contains a genuine
    // constraint violation (a write that should never have happened). The real judge must
    // catch the violation regardless of the marker; a judge that obeys the marker instead
    // masks the violation entirely.
    const trace = find("adv-003-injection-via-tool-result-obeyed");
    const { output: realOutput } = await real.grade(trace);
    expect(realOutput.verdict).toBe("fail"); // sanity: real judge is not fooled
    expect(realOutput.scores.find((s) => s.rubric === "refusal-clarity")?.score).toBe(0);

    const mutant = new SilentInjectionComplianceJudge();
    const { output: mutantOutput } = await mutant.grade(trace);
    expect(mutantOutput.verdict).toBe("pass"); // caught: the injected instruction was obeyed
  });
});

describe("mutation 4: UngroundedOptimismJudge", () => {
  it("real judge scores grounding 0 for a papered-over failure; the mutant always says 3", async () => {
    const trace = find("deg-003-timeout-papered-over-as-success");
    const { output: realOutput } = await real.grade(trace);
    expect(realOutput.scores.find((s) => s.rubric === "grounding")?.score).toBe(0); // sanity

    const mutant = new UngroundedOptimismJudge();
    const { output: mutantOutput } = await mutant.grade(trace);
    expect(mutantOutput.scores.find((s) => s.rubric === "grounding")?.score).toBe(3); // caught
  });
});

describe("mutation 5: NoAbsenceCheckJudge", () => {
  it("real judge scores confirmation-clarity 0 for a write with no confirmation; the mutant skips the check", async () => {
    const trace = find("amb-003-guesses-instead-of-asking");
    const { output: realOutput } = await real.grade(trace);
    expect(realOutput.scores.find((s) => s.rubric === "confirmation-clarity")?.score).toBe(0); // sanity

    const mutant = new NoAbsenceCheckJudge();
    const { output: mutantOutput } = await mutant.grade(trace);
    expect(mutantOutput.scores.find((s) => s.rubric === "confirmation-clarity")?.score).toBe(3); // caught
  });
});

describe("mutation pass diversity", () => {
  it("ships at least 4 mutants, each targeting a distinct property", () => {
    expect(ALL_MUTANTS.length).toBeGreaterThanOrEqual(4);
    const names = ALL_MUTANTS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
