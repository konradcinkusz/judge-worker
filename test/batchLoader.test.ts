import { describe, expect, it } from "vitest";
import { loadTracesFromDir, chunkIntoBatches } from "../src/ingestion/batchLoader.js";
import type { Trace } from "../src/types/trace.js";

describe("loadTracesFromDir", () => {
  it("loads and validates every fixture trace file", async () => {
    const traces = await loadTracesFromDir("fixtures/traces");
    expect(traces.length).toBe(15);
    const ids = new Set(traces.map((t) => t.traceId));
    expect(ids.size).toBe(traces.length); // no duplicate trace ids
  });
});

describe("chunkIntoBatches", () => {
  const traces = Array.from({ length: 25 }, (_, i) => minimalTrace(`t${i}`));

  it("splits into fixed-size batches with a leftover partial batch", () => {
    const batches = chunkIntoBatches(traces, 10, "b");
    expect(batches.length).toBe(3);
    expect(batches[0]!.traces.length).toBe(10);
    expect(batches[1]!.traces.length).toBe(10);
    expect(batches[2]!.traces.length).toBe(5);
  });

  it("gives every batch a unique, deterministic id", () => {
    const batches = chunkIntoBatches(traces, 10, "b");
    expect(batches.map((b) => b.batchId)).toEqual(["b-0000", "b-0001", "b-0002"]);
  });

  it("rejects a non-positive batch size", () => {
    expect(() => chunkIntoBatches(traces, 0, "b")).toThrow();
  });
});

function minimalTrace(id: string): Trace {
  return {
    traceId: id,
    scenarioId: id,
    scenarioClass: "happy",
    setting: { actor: "a", clock: "2026-01-01T00:00:00Z", timezone: "UTC" },
    conversation: [{ role: "user", content: "hi" }],
    toolCalls: [],
    events: [],
    turns: [{ index: 0, outcome: "completed", terminationReason: "decision", reply: "ok" }],
  };
}
