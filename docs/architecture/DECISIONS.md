# Architecture decisions

Recorded per `architecture-standards`' own principle: "a document that says 'we considered X
and rejected it because Y' is worth more than a document that lists commands." Both entries
here are deviations from a default `architecture-standards` would otherwise apply — recorded
so they read as decisions, not drift.

## ADR-1: Redis + BullMQ, despite the "no event bus until earned" default

`architecture-standards/docs/architecture/00-REFERENCE-ARCHITECTURE.md` §4 states a named
non-goal: _"No event bus until there is a use case that needs one... introducing a broker is
an explicit, recorded decision, not a default."_ `SERVICE-API-PATTERNS.md` §6 gives the
in-process alternative (persist a job row, `Task.Run` the work, catch-and-record failures) and
names the exact trigger for when that pattern stops being enough: _"no durability across
restarts, no retries, no backpressure. When any of those becomes a requirement, that is the
recorded trigger to introduce a queue."_

**Decision**: use Redis + BullMQ anyway. **Why**: the workload this repo exists to
demonstrate — asynchronous post-processing of large volumes of already-ingested trace data —
is defined by the queue it runs on, so the broker is load-bearing rather than an incidental
choice this repo could avoid. Independent of that, the trigger conditions
`SERVICE-API-PATTERNS.md` §6 names are all genuinely present: **durability** (a batch of
hundreds of trace-grading jobs must survive a worker restart mid-run), **retries** (an LLM API
call fails transiently — rate limits, 5xx — far more often than a database write), and
**backpressure** (post-processing "large volumes of ingested data" is exactly the shape that
needs a depth limit and a dead-letter path, not an in-process `Task.Run`). All three triggers
apply; the in-process alternative was not silently skipped, it was evaluated and rejected on
its own stated terms.

**Alternatives considered**: the in-process job-row pattern from `SERVICE-API-PATTERNS.md`
§6 — rejected because it explicitly disclaims the three properties (durability, retries,
backpressure) this workload needs, by the guide's own words.

**Consequences**: a Redis dependency this repo would not otherwise have; `docker-compose.yml`
exists solely to provide it for local dev. Revisit if this repo's scope narrows to something
that no longer needs durability/retries/backpressure (unlikely, since that would mean
abandoning the post-processing workload this repo demonstrates).

## ADR-2: hand-written judge mutants gate every PR, not just a periodic health check

See `docs/SPEC.md` §7 for the full reasoning — condensed here as a decision record.
`E2E-ACCEPTANCE-TESTING.md` §2 recommends mutation testing as a periodic suite-health signal,
not a per-PR gate, because it's costed against automated tools (Stryker-class) that re-run an
entire suite per mutated line.

**Decision**: this repo's mutation suite (`src/mutations/mutantJudgeProviders.ts`,
`test/mutations.test.ts`) is a hard CI gate on every PR via `pnpm run test`, not a periodic
job. **Why**: it is 5 small, hand-written, deterministic test cases running in milliseconds —
not a Stryker sweep — so the cost concern the guide is protecting against does not apply here.
**Alternatives considered**: a separate scheduled workflow running the mutation suite
independently of PR checks — rejected as unnecessary ceremony for a suite this cheap.
**Consequences**: none in practice; if this suite grows to include real automated mutation
tooling later, that addition should move to a periodic job per the original guidance, and this
ADR should be updated when it does.
