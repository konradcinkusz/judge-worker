import { describe, expect, it } from "vitest";
import type { Env } from "../src/config/env.js";
import { parseArgs as parseIngestArgs } from "../src/cli/ingest.js";
import { isLive } from "../src/cli/worker.js";
import { parseArgs as parseCalibrateArgs } from "../src/cli/calibrate.js";
import { parseArgs as parseLoadtestArgs } from "../src/cli/loadtest.js";
import { parseArgs as parseDlqArgs } from "../src/cli/dlq.js";
import { requireApiKeyForLive } from "../src/cli/liveGuard.js";
import { buildProvider } from "../src/cli/buildProvider.js";
import { MockJudgeProvider } from "../src/judge/mockJudgeProvider.js";
import { CircuitBreakerJudgeProvider } from "../src/judge/circuitBreakerJudgeProvider.js";

describe("cli/ingest.ts parseArgs", () => {
  it("defaults to fixtures/traces and batch size 10", () => {
    expect(parseIngestArgs([])).toEqual({ dir: "fixtures/traces", batchSize: 10 });
  });

  it("honors --dir and --batch-size overrides", () => {
    expect(parseIngestArgs(["--dir", "my/traces", "--batch-size", "25"])).toEqual({
      dir: "my/traces",
      batchSize: 25,
    });
  });
});

describe("cli/worker.ts isLive", () => {
  it("is false with no flags", () => {
    expect(isLive([])).toBe(false);
  });

  it("is true when --live is present anywhere in argv", () => {
    expect(isLive(["--live"])).toBe(true);
    expect(isLive(["--some-other-flag", "value", "--live"])).toBe(true);
  });
});

describe("cli/calibrate.ts parseArgs", () => {
  it("defaults to the fixture traces dir, the committed label file, and mock (not live)", () => {
    expect(parseCalibrateArgs([])).toEqual({
      dir: "fixtures/traces",
      labelsPath: "data/calibration/human-labels.jsonl",
      live: false,
    });
  });

  it("honors --dir, --labels, and --live overrides", () => {
    expect(parseCalibrateArgs(["--dir", "d", "--labels", "l.jsonl", "--live"])).toEqual({
      dir: "d",
      labelsPath: "l.jsonl",
      live: true,
    });
  });
});

describe("cli/loadtest.ts parseArgs", () => {
  it("defaults to 500 synthetic traces, batch size 50, mock (not live), no latency/depth override", () => {
    expect(parseLoadtestArgs([])).toEqual({
      count: 500,
      live: false,
      batchSize: 50,
      simulateLatencyMs: 0,
      queueDepthLimit: undefined,
    });
  });

  it("honors --count, --batch-size, and --live overrides", () => {
    expect(parseLoadtestArgs(["--count", "1200", "--batch-size", "40", "--live"])).toEqual({
      count: 1200,
      live: true,
      batchSize: 40,
      simulateLatencyMs: 0,
      queueDepthLimit: undefined,
    });
  });

  it("honors --simulate-latency-ms and --queue-depth-limit overrides", () => {
    expect(
      parseLoadtestArgs(["--simulate-latency-ms", "50", "--queue-depth-limit", "100"]),
    ).toEqual({
      count: 500,
      live: false,
      batchSize: 50,
      simulateLatencyMs: 50,
      queueDepthLimit: 100,
    });
  });
});

describe("cli/dlq.ts parseArgs", () => {
  it("list defaults to limit 50", () => {
    expect(parseDlqArgs(["list"])).toEqual({ kind: "list", limit: 50 });
  });

  it("list honors --limit", () => {
    expect(parseDlqArgs(["list", "--limit", "10"])).toEqual({ kind: "list", limit: 10 });
  });

  it("requeue <jobId> targets a single job", () => {
    expect(parseDlqArgs(["requeue", "123"])).toEqual({ kind: "requeue", jobId: "123" });
  });

  it("requeue --all targets every dead-letter entry", () => {
    expect(parseDlqArgs(["requeue", "--all"])).toEqual({ kind: "requeue-all" });
  });

  it("throws when requeue is given neither a job id nor --all", () => {
    expect(() => parseDlqArgs(["requeue"])).toThrow(/requires a job id/);
  });

  it("throws on an unknown subcommand", () => {
    expect(() => parseDlqArgs(["bogus"])).toThrow(/unknown dlq subcommand/);
    expect(() => parseDlqArgs([])).toThrow(/unknown dlq subcommand/);
  });
});

const BASE_ENV: Env = {
  REDIS_URL: "redis://127.0.0.1:6379",
  JUDGE_QUEUE_NAME: "judge-grading",
  WORKER_CONCURRENCY: 5,
  QUEUE_DEPTH_LIMIT: 2000,
  JOB_ATTEMPTS: 3,
  JOB_BACKOFF_MS: 500,
  JUDGE_MODEL: "claude-haiku-4-5",
  ANTHROPIC_MAX_RETRIES: 7,
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: 5,
  CIRCUIT_BREAKER_RESET_MS: 30_000,
  SHUTDOWN_GRACE_PERIOD_MS: 30_000,
  LOG_LEVEL: "error",
};

describe("cli/buildProvider.ts buildProvider", () => {
  it("returns a bare MockJudgeProvider when not live", () => {
    const provider = buildProvider(false, BASE_ENV);
    expect(provider).toBeInstanceOf(MockJudgeProvider);
  });

  it("wraps a LiveJudgeProvider in a circuit breaker when live", () => {
    const provider = buildProvider(true, { ...BASE_ENV, JUDGE_MODEL: "claude-sonnet-5" });
    expect(provider).toBeInstanceOf(CircuitBreakerJudgeProvider);
    expect(provider.name).toBe("live+circuit-breaker");
    expect(provider.model).toBe("claude-sonnet-5");
    // The wrapped LiveJudgeProvider's own construction (apiKey/maxRetries passthrough to the
    // Anthropic client) is covered by liveJudgeProvider.test.ts via an injected fetch, without
    // a real network call; buildProvider's own job is just the wrapping shown above.
  });
});

describe("cli/liveGuard.ts requireApiKeyForLive", () => {
  it("does nothing when --live was not requested, even with no key", () => {
    expect(() => requireApiKeyForLive(false, undefined)).not.toThrow();
  });

  it("does nothing when --live was requested and a key is present", () => {
    expect(() => requireApiKeyForLive(true, "sk-ant-test")).not.toThrow();
  });

  it("throws a clear error when --live was requested with no key", () => {
    expect(() => requireApiKeyForLive(true, undefined)).toThrow(
      "--live requires ANTHROPIC_API_KEY to be set",
    );
  });
});
