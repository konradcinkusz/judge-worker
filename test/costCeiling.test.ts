import { describe, expect, it } from "vitest";
import { RunCostTracker } from "../src/reliability/costCeiling.js";

describe("reliability/costCeiling.ts RunCostTracker", () => {
  it("is never exceeded when no ceiling is configured", () => {
    const tracker = new RunCostTracker(undefined);
    expect(tracker.record(1000)).toBe(false);
    expect(tracker.total).toBe(1000);
    expect(tracker.isExceeded()).toBe(false);
  });

  it("ignores null costs (e.g. the mock judge, which has no pricing entry)", () => {
    const tracker = new RunCostTracker(1);
    expect(tracker.record(null)).toBe(false);
    expect(tracker.record(null)).toBe(false);
    expect(tracker.total).toBe(0);
  });

  it("is not exceeded while strictly under the ceiling", () => {
    const tracker = new RunCostTracker(2);
    expect(tracker.record(1)).toBe(false);
    expect(tracker.total).toBe(1);
  });

  it("is exceeded the moment the running total reaches the ceiling", () => {
    const tracker = new RunCostTracker(2);
    tracker.record(1);
    expect(tracker.record(1)).toBe(true);
    expect(tracker.total).toBe(2);
    expect(tracker.isExceeded()).toBe(true);
  });

  it("is exceeded when a single record overshoots the ceiling", () => {
    const tracker = new RunCostTracker(2);
    expect(tracker.record(5)).toBe(true);
  });

  it("stays exceeded on subsequent records once tripped", () => {
    const tracker = new RunCostTracker(1);
    tracker.record(1);
    expect(tracker.isExceeded()).toBe(true);
    tracker.record(0.01);
    expect(tracker.isExceeded()).toBe(true);
  });
});
