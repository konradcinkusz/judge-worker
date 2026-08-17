import { z } from "zod";

const envSchema = z.object({
  REDIS_URL: z.string().min(1).default("redis://127.0.0.1:6379"),
  JUDGE_QUEUE_NAME: z.string().min(1).default("judge-grading"),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  QUEUE_DEPTH_LIMIT: z.coerce.number().int().positive().default(2000),
  JOB_ATTEMPTS: z.coerce.number().int().positive().default(3),
  JOB_BACKOFF_MS: z.coerce.number().int().positive().default(500),
  JUDGE_MODEL: z.string().min(1).default("claude-haiku-4-5"),
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Anthropic SDK's own retry budget for a single live judge call, distinct from BullMQ's
   *  job-level JOB_ATTEMPTS -- this covers 429s/5xxs within one call before the job even fails. */
  ANTHROPIC_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
  /** Consecutive live-call failures (after the SDK's own retries are exhausted) before the
   *  circuit breaker stops calling the API and fails fast instead. */
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
  /** How long the circuit stays open before letting one trial call through. */
  CIRCUIT_BREAKER_RESET_MS: z.coerce.number().int().positive().default(30_000),
  /** Optional per-run spend cap; unset means unlimited. Only non-null JudgeResult.costUsd
   *  values count, so this has no effect against the mock judge. */
  MAX_RUN_COST_USD: z.coerce.number().positive().optional(),
  /** How long worker.ts's SIGINT/SIGTERM handler waits for active jobs to finish before
   *  force-exiting -- default matches Kubernetes' own terminationGracePeriodSeconds default. */
  SHUTDOWN_GRACE_PERIOD_MS: z.coerce.number().int().positive().default(30_000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Parsed once, memoized — call sites don't re-validate process.env on every read. */
export function loadEnv(): Env {
  cached ??= envSchema.parse(process.env);
  return cached;
}
