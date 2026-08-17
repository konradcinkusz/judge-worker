import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Trace } from "../src/types/trace.js";
import type { JudgeProvider } from "../src/judge/judgeProvider.js";
import {
  CircuitBreakerJudgeProvider,
  CircuitOpenError,
} from "../src/judge/circuitBreakerJudgeProvider.js";

const trace = { traceId: "t1" } as Trace;

/** A provider whose grade() outcome is scripted call-by-call: throws while `failing` is true. */
function makeInner(): JudgeProvider & { calls: number; failing: boolean } {
  return {
    name: "fake",
    model: "fake-model",
    calls: 0,
    failing: false,
    grade(): ReturnType<JudgeProvider["grade"]> {
      this.calls += 1;
      if (this.failing) {
        return Promise.reject(new Error("simulated failure"));
      }
      return Promise.resolve({
        output: { verdict: "pass" },
        inputTokens: 1,
        outputTokens: 1,
      } as never);
    },
  };
}

describe("judge/circuitBreakerJudgeProvider.ts CircuitBreakerJudgeProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes calls through to the inner provider while closed", async () => {
    const inner = makeInner();
    const breaker = new CircuitBreakerJudgeProvider(inner, {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
    });
    await breaker.grade(trace);
    await breaker.grade(trace);
    expect(inner.calls).toBe(2);
  });

  it("stays closed below the failure threshold", async () => {
    const inner = makeInner();
    inner.failing = true;
    const breaker = new CircuitBreakerJudgeProvider(inner, {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
    });
    await expect(breaker.grade(trace)).rejects.toThrow("simulated failure");
    await expect(breaker.grade(trace)).rejects.toThrow("simulated failure");
    expect(inner.calls).toBe(2);
  });

  it("opens after consecutive failures reach the threshold and fails fast without calling inner", async () => {
    const inner = makeInner();
    inner.failing = true;
    const breaker = new CircuitBreakerJudgeProvider(inner, {
      failureThreshold: 2,
      resetTimeoutMs: 1000,
    });
    await expect(breaker.grade(trace)).rejects.toThrow("simulated failure");
    await expect(breaker.grade(trace)).rejects.toThrow("simulated failure");
    expect(inner.calls).toBe(2);

    await expect(breaker.grade(trace)).rejects.toThrow(CircuitOpenError);
    expect(inner.calls).toBe(2); // the third call never reached the inner provider
  });

  it("a success resets the consecutive-failure count", async () => {
    const inner = makeInner();
    const breaker = new CircuitBreakerJudgeProvider(inner, {
      failureThreshold: 2,
      resetTimeoutMs: 1000,
    });
    inner.failing = true;
    await expect(breaker.grade(trace)).rejects.toThrow("simulated failure");
    inner.failing = false;
    await breaker.grade(trace); // success in between -- should reset the streak
    inner.failing = true;
    await expect(breaker.grade(trace)).rejects.toThrow("simulated failure");
    // Only one consecutive failure since the reset, so still below threshold=2 -- stays closed.
    expect(inner.calls).toBe(3);
  });

  it("after resetTimeoutMs elapses, allows one half-open trial call through", async () => {
    const inner = makeInner();
    inner.failing = true;
    const breaker = new CircuitBreakerJudgeProvider(inner, {
      failureThreshold: 1,
      resetTimeoutMs: 1000,
    });
    await expect(breaker.grade(trace)).rejects.toThrow("simulated failure");
    // Circuit is open; an immediate retry fails fast without touching inner.
    await expect(breaker.grade(trace)).rejects.toThrow(CircuitOpenError);
    expect(inner.calls).toBe(1);

    vi.advanceTimersByTime(1000);
    inner.failing = false;
    await breaker.grade(trace); // half-open trial call reaches inner and succeeds
    expect(inner.calls).toBe(2);

    // Circuit closed again -- a normal call goes straight through, no CircuitOpenError.
    await breaker.grade(trace);
    expect(inner.calls).toBe(3);
  });

  it("a failed half-open trial call re-opens the circuit", async () => {
    const inner = makeInner();
    inner.failing = true;
    const breaker = new CircuitBreakerJudgeProvider(inner, {
      failureThreshold: 1,
      resetTimeoutMs: 1000,
    });
    await expect(breaker.grade(trace)).rejects.toThrow("simulated failure");
    vi.advanceTimersByTime(1000);
    await expect(breaker.grade(trace)).rejects.toThrow("simulated failure"); // half-open trial fails
    expect(inner.calls).toBe(2);

    // Still open immediately after -- fails fast again.
    await expect(breaker.grade(trace)).rejects.toThrow(CircuitOpenError);
    expect(inner.calls).toBe(2);
  });

  it("names itself after the wrapped provider", () => {
    const inner = makeInner();
    const breaker = new CircuitBreakerJudgeProvider(inner, {
      failureThreshold: 1,
      resetTimeoutMs: 1000,
    });
    expect(breaker.name).toBe("fake+circuit-breaker");
    expect(breaker.model).toBe("fake-model");
  });
});
