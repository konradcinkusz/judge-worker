# judge-worker

An async worker that pulls batches of already-ingested agent trace data off a Redis/BullMQ
queue and runs LLM-as-a-judge grading on them in the background — with the judge itself
proven reliable via mutation testing and calibrated against human labels, not just assumed to
work.

**Full documentation:** [konradcinkusz.github.io/judge-worker](https://konradcinkusz.github.io/judge-worker/)
(built from the same markdown in this repo — see `site/`, `_config.yml`, and
`.github/workflows/docs.yml`).

## Why this exists

I'm applying for **Senior Backend Engineer (Data Infrastructure)** at Langfuse — an
open-source LLM engineering platform processing terabytes of AI tracing data per day. One
bullet from the job posting, quoted verbatim:

> Build new infrastructure-heavy features: things like LLM-as-a-Judge (where we post-process
> large volumes of ingested data asynchronously), alerting at scale, client-code execution,
> or batch dataset operations.

And their stack, also quoted verbatim:

> TypeScript monorepo: Next.js on the frontend, Express workers for background jobs,
> PostgreSQL for transactional data, ClickHouse for tracing at scale, S3 for file storage,
> and Redis for queues and caching.

This repo is a small, standalone proof of that one bullet: an async worker that grades
batches of trace data against a pinned rubric, in the language and queue technology the team
actually uses (TypeScript, Redis + BullMQ) — not a smaller Langfuse, not a tracing UI, not a
ClickHouse deployment. See [FINDINGS.md](./FINDINGS.md) for what running it actually proved,
with real numbers from real runs, not projections.

## Quickstart

```bash
pnpm install
docker compose up redis -d     # Redis only
pnpm run ingest                # loads fixtures/traces/*.json, enqueues batches
pnpm run worker                # grades every job with the mock judge, no API key needed
```

That's the whole default demo — zero external API keys. To grade for real instead:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
pnpm run worker -- --live
```

Fully containerized, no local Node/pnpm at all — `docker compose up` (no service name) also
runs `ingest` and `worker` (`Dockerfile`, multi-stage: `pnpm run build`, then
`dist/cli/worker.js` in a slim runtime image), doing the same ingest-then-grade demo end to
end:

```bash
docker compose up --build
```

Other entry points:

```bash
pnpm run calibrate                    # Cohen's kappa vs. data/calibration/human-labels.jsonl
pnpm run calibrate -- --live          # same, but grades with the real LLM judge
pnpm run loadtest -- --count 1000     # synthetic-trace load test, prints a real summary
pnpm run dlq -- list                  # inspect the dead-letter queue
pnpm run dlq -- requeue <jobId>       # move one dead-lettered job back onto the main queue
pnpm run test                         # full suite, incl. the mutation-testing harness
```

## Relationship to the other two repos

- **`agent-eval-bench`** (.NET, read-only reference) is a Layer 1/Layer 2 eval harness built
  for a different application. Nothing here reuses its code — different runtime, different
  problem shape (CI-gated synchronous eval run vs. async post-processing over a queue). What's
  ported is the _design_: the judge's grading contract (verdict, per-rubric score,
  justification), the calibration protocol (Cohen's kappa, unweighted, `null` rather than a
  fake `1.0` on a degenerate sample), and the mutation-testing discipline (deliberately break
  the thing under test, prove the harness notices). Every file that ports a specific pattern
  says so in a comment citing the source.
- **`architecture-standards`** (read-only reference) supplies the constraints this repo was
  built against — most directly `AI-EVALS.md`'s spec-first-evals discipline and five-class
  scenario taxonomy (adapted here to _judge_ behavior instead of _agent_ behavior, see
  [docs/SPEC.md](./docs/SPEC.md) §4), and the general architecture principles in
  `00-REFERENCE-ARCHITECTURE.md`. Two places where this repo's choices needed reconciling
  against that guide rather than silently picking a side are recorded in
  [docs/architecture/DECISIONS.md](./docs/architecture/DECISIONS.md).

## What this is not

- **Not a tracing platform, not a ClickHouse deployment, not a competitor to Langfuse.**
- **Not evidence of TypeScript seniority.** It's evidence that I can build correct, tested,
  production-shaped async infrastructure in a language that isn't my primary one, using
  patterns — spec-first evals, mutation-tested judges, calibration against human labels — I
  already use in production-adjacent work elsewhere.
- **Not built for or endorsed by Langfuse.** Built after reading one specific bullet in their
  public job posting, stated as fact.
- **Not a claim of production-scale throughput.** The load test in `FINDINGS.md` ran a
  thousand synthetic traces on a laptop-sized Redis instance, not terabytes-per-day. The code
  is structured so scaling up is a matter of tuning (concurrency, queue depth limits, judge
  model), not rearchitecting — but scaling it up was not tested, and this repo doesn't claim
  it was.

## What's in here

| Phase                 | What it covers                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| 0 — Baseline          | TS/lint/test tooling, `docker-compose.yml`, [docs/SPEC.md](./docs/SPEC.md)                             |
| 1 — Ingestion & queue | `src/ingestion/`, `src/queue/` — batch loading, BullMQ producer/worker                                 |
| 2 — Judge             | `src/judge/` — mock provider (default) and live Anthropic-API provider (`--live`)                      |
| 3 — Mutation testing  | `src/mutations/`, [MUTATIONS.md](./MUTATIONS.md) — 5 deliberate judge mutants, all caught              |
| 4 — Calibration       | `src/calibration/`, [docs/CALIBRATION.md](./docs/CALIBRATION.md) — Cohen's kappa vs. human labels      |
| 5 — Scale             | `src/reliability/`, `src/cli/loadtest.ts` — backpressure, retries, dead-letter, real load-test numbers |
| 6 — Findings          | [FINDINGS.md](./FINDINGS.md) — what this proves, honestly, with real numbers                           |

Optional Phase 7 (wiring judge output back into a self-hosted Langfuse fork via its SDK/OTLP
endpoint) is out of scope for this repo — see the master build prompt for context if you have
it; it's a stretch target for later, not a dependency the base repo needs.

## Local development

```bash
pnpm install
pnpm run lint
pnpm run typecheck
pnpm run test            # spins up nothing extra; the integration test needs a local Redis
pnpm run build
```

The queue integration test (`test/queue.test.ts`) needs a reachable Redis
(`REDIS_URL`, default `redis://127.0.0.1:6379`) — `docker compose up redis -d` or a local
`redis-server` both work; CI runs it against a `redis:7-alpine` service container.
