# Security policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting rather than a public issue: go to the
[Security tab](https://github.com/konradcinkusz/judge-worker/security) → "Report a
vulnerability". That opens a private advisory only the maintainer can see until it's resolved.

If that option isn't available (private reporting must be enabled per-repo, and this repo is a
solo portfolio project without a dedicated security process), open a regular issue with as
little detail as you're comfortable putting in public, and say so — the maintainer will follow
up for anything sensitive out of band.

Please don't open a public issue with exploit details, proof-of-concept code, or anything that
would let someone reproduce the problem before it's fixed.

## Scope

This is a demo/portfolio repository (see the README's "What this is not"), not a production
service with user data or a live deployment. Realistic concerns are things like: a dependency
with a known CVE, a way to make the worker execute something it shouldn't (e.g. via malformed
trace JSON — see `docs/SPEC.md` §2's anti-corruption boundary), or credential handling issues
in the `--live` path (`ANTHROPIC_API_KEY`, `.env` handling). Reports along those lines are
genuinely useful and welcome.

## What's not a vulnerability report

- The mock judge's grading logic being wrong or gameable — that's a bug, file it as one.
- The synthetic/fixture trace data containing anything sensitive — it's fictional by design
  (see `fixtures/traces/`, `src/ingestion/syntheticTraces.ts`).

## Supported versions

This repo has no tagged releases or version branches yet — security fixes land on `main`.
