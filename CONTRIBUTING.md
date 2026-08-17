# Contributing

This is a solo portfolio project (see the README's "Why this exists"), but real bug reports,
questions, and small fixes are welcome.

## Before filing an issue

Check `docs/SPEC.md` first — it's this repo's contract, written before the implementation it
governs. If the behavior you're seeing matches the spec, it's working as designed even if it's
surprising; if it contradicts the spec, that's a bug; if the spec is silent on it, that's a
spec gap, which is worth reporting on its own terms.

## Local setup

```bash
pnpm install
docker compose up redis -d
pnpm run ingest && pnpm run worker   # the default demo — zero API keys needed
```

See the README's Quickstart and Local development sections for the rest, including the fully
containerized (`docker compose up --build`) alternative.

## Before opening a pull request

- `pnpm run lint`, `pnpm run typecheck`, `pnpm run test` (this includes the mutation-testing
  harness, `test/mutations.test.ts` — it's fast, not a separate slow job), `pnpm run build`,
  and `pnpm run format:check` all clean.
- For a bug fix: add the smallest failing test that proves the reported behavior, and confirm
  it fails against the buggy code before changing anything else. Extend the closest existing
  test file that owns the behavior rather than starting a new one, unless nothing does yet.
- If the change affects behavior described in `docs/SPEC.md`, update the spec in the same PR —
  see the PR template's "Spec impact" section.
- No secrets, tokens, or real personal data — this repo is public, and fixture traces are
  fictional by design (see `SECURITY.md` for what to do with anything sensitive).

## Code style

Enforced by `pnpm run lint` / `pnpm run format:check` (ESLint + Prettier), not left to review
judgment. Default to no comments; add one only when the _why_ isn't obvious from the code
itself (a hidden constraint, a workaround for a specific bug) — see any file in `src/` for the
existing tone.

## Questions

Open an issue, or see `docs/SPEC.md`'s own citations for where a given design choice came
from — most non-obvious decisions are recorded in `docs/architecture/DECISIONS.md` rather than
left implicit.
