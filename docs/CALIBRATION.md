# Calibration

Ported protocol from `agent-eval-bench/docs/CALIBRATION.md`: a small set of traces gets
labeled by a human, independently of the judge, and Cohen's kappa (unweighted) measures
agreement between the judge's scores and those labels. Below 0.6 ("substantial agreement"),
the judge's scores are reported and trended but gate nothing.

## Protocol

1. Pick a sample of traces (this repo's fixture set: 15 traces, `fixtures/traces/`).
2. Label each applicable `(trace, rubric)` pair **without reading the judge's own scores
   first** — reading them first measures agreement with the judge, not calibration of it.
   `data/calibration/human-labels.jsonl`, append-only JSONL, one label per line:
   ```
   {"traceId":"<id>","rubric":"<criterion>","score":<0-3>,"labeller":"<handle>","date":"YYYY-MM-DD"}
   ```
   `labeller` is a handle, never a name or email — this repository is public.
3. Run `pnpm run calibrate` (add `--live` to grade with the real judge instead of the mock).
   It grades every trace in `fixtures/traces/`, pairs each labeled `(trace, rubric)` against
   the judge's own score for that pair, computes Cohen's kappa (`src/calibration/cohenKappa.ts`)
   overall and per rubric, and prints/writes the gating verdict.

## Gate

```
CALIBRATION_GATE = { minimumLabels: 10, minimumKappa: 0.6 }
```

`agent-eval-bench` uses a stricter 40-labels/8-scenarios bar; this repo's own master spec
asks for a smaller 10-20 trace human-labeled sample, so the floor here is scoped to that —
an honestly smaller demo bar, not a claim that 10 labels is what a production judge should
require before it's trusted.

Kappa is **unweighted** on purpose, same reasoning as `agent-eval-bench`: a weighted kappa
gives partial credit for landing one anchor level off, and the anchors in
`src/judge/rubric.ts` are written so that one level off is a real disagreement, not a
rounding error. `cohenKappa` returns `null` — never `1.0` — when every paired rating falls in
a single shared category, because two raters who both always say "3" have demonstrated
nothing about agreement (`test/cohenKappa.test.ts` proves this directly).

## The actual run, and its honest limits

See `FINDINGS.md` for the real, mechanically-produced numbers from `pnpm run calibrate`
against this repo's fixture set, and the caveat next to them: this repo's human labels and
`MockJudgeProvider`'s heuristics were both written by the same person in the same sitting, so
a mock-mode calibration run here measures whether the calibration _machinery_ is wired up
correctly, not whether an independently-developed judge agrees with an independent human on
traces neither party designed. A live run (`pnpm run calibrate -- --live`, requires
`ANTHROPIC_API_KEY`) against the same human labels is the real test of judge quality, and this
repo's build environment does not have API credentials to run it — see `FINDINGS.md` for that
gap stated plainly rather than papered over.
