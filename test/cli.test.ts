import { describe, expect, it } from "vitest";
import { parseArgs as parseIngestArgs } from "../src/cli/ingest.js";
import { isLive } from "../src/cli/worker.js";
import { parseArgs as parseCalibrateArgs } from "../src/cli/calibrate.js";
import { parseArgs as parseLoadtestArgs } from "../src/cli/loadtest.js";
import { requireApiKeyForLive } from "../src/cli/liveGuard.js";

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
