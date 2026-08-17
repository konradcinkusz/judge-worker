import type { Env } from "../config/env.js";
import type { JudgeProvider } from "../judge/judgeProvider.js";
import { MockJudgeProvider } from "../judge/mockJudgeProvider.js";
import { LiveJudgeProvider } from "../judge/liveJudgeProvider.js";
import { CircuitBreakerJudgeProvider } from "../judge/circuitBreakerJudgeProvider.js";

/**
 * Shared by every CLI that supports --live (worker, calibrate, loadtest): the live judge is
 * always wrapped in a circuit breaker (CIRCUIT_BREAKER_* env vars) so a run of failing API
 * calls trips fast instead of every job independently burning through the SDK's own per-call
 * retries (ANTHROPIC_MAX_RETRIES) against a downed or rate-limited endpoint.
 */
export function buildProvider(live: boolean, env: Env): JudgeProvider {
  if (!live) return new MockJudgeProvider();

  const liveProvider = new LiveJudgeProvider(env.JUDGE_MODEL, {
    ...(env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {}),
    maxRetries: env.ANTHROPIC_MAX_RETRIES,
  });
  return new CircuitBreakerJudgeProvider(liveProvider, {
    failureThreshold: env.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    resetTimeoutMs: env.CIRCUIT_BREAKER_RESET_MS,
  });
}
