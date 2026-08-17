# Findings

What this repo proves, what it doesn't, and the actual numbers from actual runs — not
projections. Every number below was produced by running the command shown, on
2026-08-17, against this repo's own commit — reproduce with the commands as written.

## What this proves

- A TypeScript worker can pull batched trace-grading jobs off a Redis/BullMQ queue, grade
  them against a pinned rubric, and handle concurrency, retries, and dead-lettering correctly
  at small scale, with zero external dependencies by default (`pnpm run ingest && pnpm run
worker`, no API key required).
- A judge's grading contract can be ported from a different language and a different
  application (`agent-eval-bench`, .NET, an HR-agent eval harness) into fresh TypeScript code
  without reusing a line of the original — same contract shape (verdict, per-rubric score,
  justification), same calibration protocol (Cohen's kappa, unweighted, `null` not `1.0` on a
  degenerate sample), same mutation-testing discipline (deliberately break the thing under
  test, prove the harness notices).
- The mutation-testing harness works: 5 hand-written judge mutants, each targeting a distinct
  constraint, all 5 caught by the test suite (`MUTATIONS.md`).
- The calibration machinery works: it correctly computes Cohen's kappa per rubric, and
  correctly reports `null` rather than a fake `1.0` when a rubric's labels show no variance
  (see the `tone` result below).

## What this doesn't prove

- **Not production-scale throughput.** The load test below ran 1,000 synthetic traces
  against the mock judge in well under a second — that is a statement about Redis/BullMQ
  overhead on a laptop-sized workload, not about how this pipeline behaves under the
  terabytes-per-day volume the job posting describes. See "Scale" below.
- **Not evidence that a real LLM judge agrees with a human.** The calibration run below used
  the mock heuristic judge, whose scoring logic and the human labels it's compared against
  were both written by the same person in the same sitting. See "Calibration" below for why
  that number is honest but limited, and what running it for real would require.
- **Not TypeScript seniority.** See the README's "what this is not" section — this repo is
  evidence of building correct, tested, production-shaped async infrastructure in a language
  that isn't the author's primary one, not a claim of TypeScript mastery.

## Test suite

```
$ pnpm run test
 Test Files  7 passed (7)
      Tests  30 passed (30)
```

`pnpm run lint`, `pnpm run typecheck`, and `pnpm run format:check` all pass clean on this
commit. 30 tests across schema validation, the mock judge's scoring logic (checked against
every fixture's human-labeled ground truth, not just spot-checked), Cohen's kappa, the
calibration gate, the mutation-testing harness (5/5 caught), batch chunking, and a real
Redis-backed integration test of the producer → worker → dead-letter path.

## Mutation testing

Full results and the one worth reading in detail (a judge that would rubber-stamp an
adversarial trace) in `MUTATIONS.md`. Summary: 5 mutants, 5 caught, 0 survivors.

| #   | Mutant                           | Result |
| --- | -------------------------------- | ------ |
| 1   | `FlippedVerdictJudge`            | Caught |
| 2   | `MissingJustificationJudge`      | Caught |
| 3   | `SilentInjectionComplianceJudge` | Caught |
| 4   | `UngroundedOptimismJudge`        | Caught |
| 5   | `NoAbsenceCheckJudge`            | Caught |

No survivors is a real outcome, not a suspicious one, here — the mutants are small and
deliberately narrow, and the fixtures they're checked against were built specifically to
trigger each constraint (`docs/architecture/DECISIONS.md` and `MUTATIONS.md` both note this
directly rather than presenting a clean sweep as more impressive than it is).

## Calibration

```
$ pnpm run calibrate
{
  "provider": "mock",
  "model": "mock-heuristic-v1",
  "labelCount": 30,
  "distinctTraces": 15,
  "overallKappa": 1,
  "perRubricKappa": {
    "grounding": 1,
    "tone": null,
    "confirmation-clarity": 1,
    "refusal-clarity": 1,
    "degradation-honesty": 1
  },
  "gating": true,
  "reason": "Calibrated: Layer 2 scores may gate."
}
```

Reported exactly as computed, including the part that undercuts the headline number:
**`tone` is `null`, not a score.** Every fixture's `tone` label happens to be `2` (the mock
judge's tone heuristic never returns `3` — see `src/judge/mockJudgeProvider.ts`'s
`scoreTone`), so there is no variance in that rubric's labels and `cohenKappa` correctly
refuses to report a number for it, per its own design (`test/cohenKappa.test.ts` proves this
is the intended behavior, not a bug). A less careful implementation would report `1.0` for
`tone` too and look better for it; this one reports `null` because that's what's actually
knowable from this sample.

The kappa of `1.0` on the other four rubrics is real but limited, for the reason stated at
the top of this file: I wrote both `MockJudgeProvider`'s heuristics and the 15 fixture traces'
human labels (`data/calibration/human-labels.jsonl`) in the same sitting, so this measures
"does the calibration machinery correctly detect that a heuristic agrees with its own design
intent" — a legitimate thing to prove, but not the same claim as "an LLM judge agrees with an
independent human on traces neither party designed." `pnpm run calibrate -- --live` would run
the same labels against `LiveJudgeProvider` (real Anthropic API calls, `ANTHROPIC_API_KEY`
required) and produce that more meaningful number; this repo's build environment has no API
credentials to run it, so that number is not in this file. Anyone with a key can reproduce it
in about a minute against 15 fixture traces.

## Scale

```
$ pnpm run loadtest -- --count 1000 --batch-size 50
{
  "succeeded": 1000,
  "failed": 0,
  "deadLettered": 0,
  "totalTraces": 1000,
  "durationMs": 466,
  "throughputPerSec": 2145.9,
  "latencyMsP50": 0,
  "latencyMsP95": 0,
  "latencyMsMax": 1,
  "totalInputTokens": 198033,
  "totalOutputTokens": 50000,
  "totalCostUsd": null,
  "deadLetterQueueDepth": 0
}
```

1,000 synthetic traces (`src/ingestion/syntheticTraces.ts`, spread evenly across all five
scenario classes with roughly a third carrying a deliberate defect), batched at 50 traces per
batch, graded by the mock judge at the default concurrency of 5, completed in 466ms with zero
failures and zero dead-lettered jobs. `totalCostUsd` is `null` because the mock judge's model
id (`mock-heuristic-v1`) has no entry in the pricing table (`src/observability/pricing.ts`)
by design — cost accounting only applies real numbers to real API calls.

**Read this number for what it is, not more.** The mock judge does no I/O and no real
inference — the 466ms is almost entirely Redis/BullMQ overhead for 1,000 small jobs, not
judge latency. This proves the pipeline's batching, concurrency, and job bookkeeping behave
correctly at this scale; it says nothing about throughput with a real LLM in the loop, where
per-call latency and provider rate limits — not queue mechanics — would dominate. The
queue-depth backpressure guard (`QUEUE_DEPTH_LIMIT`) is proven directly in
`test/queue.test.ts` rather than in this load test, because the mock judge drains jobs faster
than 1,000-trace ingestion can build up a meaningful backlog; a slower, real judge would make
that shed path visible in a load test the way it is in the unit test.

This was run against one thousand synthetic traces on a single machine. It was not run
against real production trace volume, against a real Redis cluster, or under sustained
multi-hour load, and nothing in this repo should be read as a claim that it was.
