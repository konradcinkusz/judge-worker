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
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Parsed once, memoized — call sites don't re-validate process.env on every read. */
export function loadEnv(): Env {
  cached ??= envSchema.parse(process.env);
  return cached;
}
