#!/usr/bin/env node
import { startWorker } from "../queue/worker.js";
import { trackActiveJobs, shutdownWithTimeout } from "../queue/shutdown.js";
import { loadEnv } from "../config/env.js";
import { logger } from "../observability/logger.js";
import { safeResultFields } from "../observability/redact.js";
import {
  recordJobSuccess,
  recordJobRetry,
  recordDeadLetter,
} from "../observability/prometheusMetrics.js";
import { startMetricsServer } from "../observability/metricsServer.js";
import { closeRedisConnection } from "../queue/connection.js";
import { requireApiKeyForLive } from "./liveGuard.js";
import { buildProvider } from "./buildProvider.js";

export function isLive(argv: string[]): boolean {
  return argv.includes("--live");
}

function main(): void {
  const env = loadEnv();
  const live = isLive(process.argv.slice(2));
  requireApiKeyForLive(live, env.ANTHROPIC_API_KEY);
  const provider = buildProvider(live, env);

  logger.info(
    { provider: provider.name, model: provider.model, concurrency: env.WORKER_CONCURRENCY },
    "starting worker",
  );

  const worker = startWorker(provider, {
    onSuccess: (result, batchId) => {
      recordJobSuccess(result);
      // safeResultFields (not a hand-picked field list) is the enforcement point for the
      // logging policy in docs/SPEC.md §8 -- see its own doc comment for why.
      logger.info({ batchId, ...safeResultFields(result) }, "trace graded");
    },
    onRetryableFailure: () => recordJobRetry(),
    onDeadLetter: (batchId, traceId, reason) => {
      recordDeadLetter();
      logger.error({ batchId, traceId, reason }, "trace dead-lettered");
    },
  });
  const getActiveJobs = trackActiveJobs(worker);
  const metricsServer =
    env.METRICS_PORT !== undefined ? startMetricsServer(env.METRICS_PORT) : undefined;

  const shutdown = async (): Promise<void> => {
    logger.info({ gracePeriodMs: env.SHUTDOWN_GRACE_PERIOD_MS }, "shutting down worker");
    // worker.close() waits for active jobs to finish -- a single hung one (e.g. a live judge
    // call that never resolves) must not block shutdown forever, hence the race here instead
    // of a bare `await worker.close()`.
    const { forced, stillActive } = await shutdownWithTimeout(
      worker,
      env.SHUTDOWN_GRACE_PERIOD_MS,
      getActiveJobs,
    );
    if (forced) {
      logger.warn(
        { gracePeriodMs: env.SHUTDOWN_GRACE_PERIOD_MS, stillActive },
        "shutdown grace period exceeded, forcing exit with jobs still active",
      );
    }
    if (metricsServer) {
      await new Promise<void>((resolve) => metricsServer.close(() => resolve()));
    }
    await closeRedisConnection();
    process.exit(forced ? 1 : 0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

// Only run when this file is the process entry point (`tsx src/cli/worker.ts`), not when
// it's imported for its exports (e.g. `isLive` from test/cli.test.ts) -- otherwise importing
// this module for testing would connect to Redis and register signal handlers as a side effect.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    logger.error({ err }, "worker failed to start");
    process.exitCode = 1;
  }
}
