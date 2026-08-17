<!--
  Delete the sections that genuinely do not apply -- but delete them, don't leave them
  blank. A blank checklist reads as "not checked", not "not applicable".
-->

## What changed

<!-- One paragraph: what behavior is different after this PR than before it? -->

## Why

<!-- The reasoning, not a restatement of the diff. Link the issue this closes, if any. -->

## Spec impact

<!-- docs/SPEC.md is this repo's contract -- written before the implementation it governs. -->

- [ ] No behavior change — `docs/SPEC.md` untouched
- [ ] Behavior change, and `docs/SPEC.md` is amended in this PR
- [ ] New architectural decision, recorded in `docs/architecture/DECISIONS.md`

## Verification

<!--
  What did you actually run, and what did it print? "Tests pass" is not evidence; the
  output is. Quote each check's summary line.
-->

- [ ] `pnpm run lint` clean
- [ ] `pnpm run typecheck` clean
- [ ] `pnpm run test` green, including the mutation suite (`test/mutations.test.ts`)
- [ ] `pnpm run build` clean
- [ ] `pnpm run format:check` clean
- [ ] Tested against a real local run where relevant (not just unit tests) — e.g. an actual
      `pnpm run worker` / `pnpm run dlq -- list` invocation, not only what vitest covers

## Public-repo checks

<!-- This repository is public. Every commit is disclosed the moment it is pushed. -->

- [ ] No secrets, tokens, or credentials — including in comments, commit messages, and test
      fixtures
- [ ] No internal-only identifiers (ticket IDs, private URLs) that mean nothing to an outside
      reader
- [ ] Fresh-clone check still true: `pnpm install && pnpm run ingest && pnpm run worker`
      works with **zero** credentials
