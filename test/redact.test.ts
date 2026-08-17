import { describe, expect, it } from "vitest";
import type { JudgeResult } from "../src/types/judge.js";
import { safeResultFields, truncateForLog, redactError } from "../src/observability/redact.js";

const SENSITIVE_RATIONALE = "The agent correctly told Jane Doe her SSN 555-12-3456 was on file.";
const SENSITIVE_JUSTIFICATION = "Confirmed the leave dates the employee mentioned: Aug 3-10.";

const RESULT: JudgeResult = {
  traceId: "t1",
  scenarioClass: "happy",
  output: {
    verdict: "pass",
    scores: [{ rubric: "grounding", score: 3, justification: SENSITIVE_JUSTIFICATION }],
    confidence: "high",
    rationale: SENSITIVE_RATIONALE,
  },
  model: "claude-haiku-4-5",
  inputTokens: 111,
  outputTokens: 22,
  costUsd: 0.001,
  durationMs: 42,
};

describe("observability/redact.ts safeResultFields", () => {
  it("includes exactly the whitelisted safe fields", () => {
    expect(safeResultFields(RESULT)).toEqual({
      traceId: "t1",
      scenarioClass: "happy",
      verdict: "pass",
      model: "claude-haiku-4-5",
      inputTokens: 111,
      outputTokens: 22,
      costUsd: 0.001,
      durationMs: 42,
    });
  });

  it("never surfaces the rationale or per-rubric justification text", () => {
    const safe = safeResultFields(RESULT);
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain(SENSITIVE_RATIONALE);
    expect(serialized).not.toContain(SENSITIVE_JUSTIFICATION);
    expect(safe).not.toHaveProperty("output");
    expect(safe).not.toHaveProperty("rationale");
    expect(safe).not.toHaveProperty("scores");
  });
});

describe("observability/redact.ts truncateForLog", () => {
  it("leaves a short string untouched", () => {
    expect(truncateForLog("short message")).toBe("short message");
  });

  it("truncates a string longer than the default 200 chars and marks it truncated", () => {
    const long = "x".repeat(500);
    const result = truncateForLog(long);
    expect(result.length).toBeLessThan(500);
    expect(result.startsWith("x".repeat(200))).toBe(true);
    expect(result).toContain("truncated");
  });

  it("honors a custom maxChars", () => {
    expect(truncateForLog("abcdefghij", 5)).toBe("abcde… (truncated)");
  });

  it("does not truncate a string exactly at the limit", () => {
    const exact = "y".repeat(200);
    expect(truncateForLog(exact)).toBe(exact);
  });
});

describe("observability/redact.ts redactError", () => {
  it("bounds a short error's message and keeps its stack's call frames intact", () => {
    const err = new Error("boom");
    const safe = redactError(err);
    expect(safe.name).toBe("Error");
    expect(safe.message).toBe("boom");
    expect(safe.stack).toContain("Error: boom");
    expect(safe.stack).toContain("at "); // at least one call frame survived
  });

  it("the rebuilt stack does not leak the untruncated message via its header line", () => {
    // This is the specific bug this function exists to close: Node's default Error.stack
    // starts with "name: message" before the call frames, so truncating only `.message` and
    // reusing the original `.stack` verbatim puts the full text right back into the log.
    const longMessage = "z".repeat(500);
    const err = new Error(longMessage);
    const safe = redactError(err);

    expect(safe.message.length).toBeLessThan(longMessage.length);
    expect(safe.stack).toBeDefined();
    expect(safe.stack).not.toContain(longMessage);
    expect(safe.stack?.split("\n")[0]).toBe(`Error: ${safe.message}`);
  });

  it("omits stack entirely when the error has none", () => {
    const err = new Error("no stack here");
    delete err.stack; // exactOptionalPropertyTypes forbids assigning `undefined` directly
    const safe = redactError(err);
    expect(safe).not.toHaveProperty("stack");
  });

  it("honors a custom maxMessageChars", () => {
    const err = new Error("abcdefghij");
    expect(redactError(err, 5).message).toBe("abcde… (truncated)");
  });
});
