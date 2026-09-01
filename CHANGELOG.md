# Changelog

Notable changes to this project, in the spirit of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

There are **no tagged releases yet**. `package.json` reads `0.1.0` and everything below sits
under Unreleased; security fixes land on `main` (see [SECURITY.md](./SECURITY.md)).
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) applies from the first tag onward,
and `docs/SPEC.md` is the contract a breaking change would be measured against — an eval suite
is to a judge what a migration is to a schema.

## [Unreleased]

### Added

- **The worker itself.** Batch ingestion from `fixtures/traces/*.json` or synthetic
  generation, a BullMQ producer/worker pair over Redis, and LLM-as-a-judge grading against a
  rubric pinned in `docs/SPEC.md` — written before the implementation it governs.
- **Two judge providers behind one interface.** `MockJudgeProvider` is the default and needs
  no API key; `LiveJudgeProvider` calls the Anthropic API behind `--live`, using structured
  outputs rather than hand-written JSON parsing.
- **Mutation testing.** Five hand-written mutants, each corrupting exactly one grading
  constraint, proving the suite would notice if the judge broke ([MUTATIONS.md](./MUTATIONS.md)).
- **Calibration.** Unweighted Cohen's kappa against human labels, reporting `null` rather than
  a flattering `1.0` when a rubric's labels show no variance
  ([docs/CALIBRATION.md](./docs/CALIBRATION.md)).
- **Reliability.** Retry tuning and a circuit breaker on the live judge path, a per-run cost
  ceiling that pauses the worker mid-run when tripped, a dead-letter queue with `list` and
  `requeue` tooling, queue-depth backpressure, and a shutdown grace period with a force-kill
  fallback.
- **Observability.** Structured logging, a Prometheus `/metrics` endpoint (opt-in via
  `METRICS_PORT`), per-call cost accounting, and a logging/PII policy enforced in code by a
  field whitelist rather than left to reviewer discipline.
- **Packaging and docs.** A multi-stage `Dockerfile` running as a non-root user, a fully
  containerized `docker compose up --build` demo, and a Jekyll documentation site built from
  the same markdown the repository already carries.
- **Repository baseline.** `CODEOWNERS`, Dependabot across three ecosystems, PR and issue
  templates, `CONTRIBUTING`, `SECURITY`, `.editorconfig`, `.gitattributes`, a gitleaks
  pre-commit hook, and CI running lint, format, typecheck, build, tests, CodeQL and
  full-history secret scanning.

### Changed

- **The README states the problem, not the occasion.** It was written as a job application to
  a named company; the motivation is now the technical one it always was — LLM-as-a-judge
  grading over ingested traces is post-processing, too slow and costly for the request path,
  therefore asynchronous and off a queue.
- `LICENSE` names Konrad Cinkusz rather than the `dev_insight` pseudonym it was scaffolded
  with.
- `docs/SPEC.md` is explicit that OpenTelemetry GenAI conventions are borrowed as **logging
  vocabulary only** — no OTel SDK is wired — after the document overstated what the code did.

### Fixed

- **Backpressure was untestable in the load test.** Two real bugs surfaced wiring it up: the
  producer needed its own Redis connection (sharing one silently paced production down to
  consumption speed), and `--queue-depth-limit` could not be threaded through `process.env`
  because `loadEnv()` memoizes on a call that `logger.ts` already makes at import time. Both
  are described in [FINDINGS.md](./FINDINGS.md).
- CI failed on a `pnpm/action-setup` version conflict with `package.json`'s `packageManager`
  field; the version input is now omitted so the action reads it from one place.

### Known gaps

- `LiveJudgeProvider` has never run against a real API key, so no live calibration figure
  exists. Every published kappa comes from the mock judge and is labelled as such, here and
  in [FINDINGS.md](./FINDINGS.md) and [docs/CALIBRATION.md](./docs/CALIBRATION.md).
  [#3](https://github.com/konradcinkusz/judge-worker/issues/3) and
  [#5](https://github.com/konradcinkusz/judge-worker/issues/5) are closed as _not planned_
  rather than done — they need a credential this project does not carry, so this file is
  where the gap is recorded, not the issue tracker.
- Load-test numbers are a thousand synthetic traces on one machine, not production volume.
  [FINDINGS.md](./FINDINGS.md) states what that does and does not prove.
