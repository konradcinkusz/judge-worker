import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { traceSchema, mergedTimeline, type Trace } from "../src/types/trace.js";

describe("trace schema", () => {
  it("parses every committed fixture trace without error", async () => {
    const dir = "fixtures/traces";
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const raw = JSON.parse(await readFile(join(dir, file), "utf-8")) as unknown;
      expect(() => traceSchema.parse(raw)).not.toThrow();
    }
  });

  it("rejects a trace with a score outside the schema (missing required field)", () => {
    expect(() => traceSchema.parse({ traceId: "x" })).toThrow();
  });

  it("rejects an unknown scenario class", () => {
    const bad = { ...minimalTrace(), scenarioClass: "not-a-real-class" };
    expect(() => traceSchema.parse(bad)).toThrow();
  });
});

describe("mergedTimeline", () => {
  it("interleaves tool calls and events on one ordered timeline by position", () => {
    const trace: Trace = {
      ...minimalTrace(),
      toolCalls: [
        { position: 0, tool: "a", kind: "read", outcome: "success", arguments: {}, attempts: 1 },
        { position: 3, tool: "b", kind: "write", outcome: "success", arguments: {}, attempts: 1 },
      ],
      events: [
        { position: 1, name: "confirmation.shown", attributes: {} },
        { position: 2, name: "confirmation.received", attributes: {} },
      ],
    };
    const timeline = mergedTimeline(trace);
    expect(timeline.map((i) => i.position)).toEqual([0, 1, 2, 3]);
    expect(timeline.map((i) => i.type)).toEqual(["tool_call", "event", "event", "tool_call"]);
  });
});

function minimalTrace(): Trace {
  return {
    traceId: "t1",
    scenarioId: "s1",
    scenarioClass: "happy",
    setting: { actor: "a", clock: "2026-01-01T00:00:00Z", timezone: "UTC" },
    conversation: [{ role: "user", content: "hello" }],
    toolCalls: [],
    events: [],
    turns: [{ index: 0, outcome: "completed", terminationReason: "decision", reply: "hi" }],
  };
}
