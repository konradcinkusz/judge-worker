import { describe, expect, it, vi } from "vitest";
import { LiveJudgeProvider } from "../src/judge/liveJudgeProvider.js";
import type { Trace } from "../src/types/trace.js";
import type { JudgeOutput } from "../src/types/judge.js";

/**
 * Covers src/judge/liveJudgeProvider.ts without a real API key or network call, by injecting
 * a fake `fetch` (the Anthropic SDK accepts one directly -- see its ClientOptions.fetch) that
 * returns a hand-built Messages API response. The response shape is not guessed: it mirrors
 * exactly what @anthropic-ai/sdk/lib/parser.js's parseMessage() reads (the first `text`
 * content block's `.text`, parsed via the Zod output format) to populate `parsed_output`.
 */

const TRACE: Trace = {
  traceId: "t1",
  scenarioId: "s1",
  scenarioClass: "happy",
  setting: { actor: "a", clock: "2026-01-01T00:00:00Z", timezone: "UTC" },
  conversation: [{ role: "user", content: "hi" }],
  toolCalls: [],
  events: [],
  turns: [{ index: 0, outcome: "completed", terminationReason: "decision", reply: "ok" }],
};

const VALID_OUTPUT: JudgeOutput = {
  verdict: "pass",
  scores: [
    { rubric: "grounding", score: 3, justification: "consistent with the trace" },
    { rubric: "tone", score: 2, justification: "appropriate register" },
  ],
  confidence: "high",
  rationale: "clean happy-path trace",
};

/** `init.body` is always the SDK's own JSON.stringify'd request in these tests. */
function parseRequestBody(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(init?.body as string) as Record<string, unknown>;
}

function messagesResponse(body: {
  content: Array<{ type: "text"; text: string }>;
  stop_reason?: string;
  usage?: { input_tokens: number; output_tokens: number };
}): Response {
  return new Response(
    JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5",
      content: body.content,
      stop_reason: body.stop_reason ?? "end_turn",
      stop_sequence: null,
      usage: body.usage ?? { input_tokens: 111, output_tokens: 22 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("LiveJudgeProvider", () => {
  it("sends the pinned model, system prompt, and a json_schema output_config, and parses a valid response", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fakeFetch: typeof fetch = (_url, init) => {
      capturedBody = parseRequestBody(init);
      return Promise.resolve(
        messagesResponse({ content: [{ type: "text", text: JSON.stringify(VALID_OUTPUT) }] }),
      );
    };

    const provider = new LiveJudgeProvider("claude-haiku-4-5", {
      apiKey: "test-key",
      fetch: fakeFetch,
    });
    const result = await provider.grade(TRACE);

    expect(result.output).toEqual(VALID_OUTPUT);
    expect(result.inputTokens).toBe(111);
    expect(result.outputTokens).toBe(22);

    expect(capturedBody?.["model"]).toBe("claude-haiku-4-5");
    expect(capturedBody?.["system"]).toContain("calibration judge");
    const outputConfig = capturedBody?.["output_config"] as { format?: { type?: string } };
    expect(outputConfig?.format?.type).toBe("json_schema");
    const messages = capturedBody?.["messages"] as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    // The judge must be shown the rendered narrative, not raw trace JSON.
    expect(messages[0]?.content).toContain("### Execution trace");
  });

  it("only requests the rubric criteria applicable to the trace's scenario class", async () => {
    const fakeFetch: typeof fetch = (_url, init) => {
      const body = parseRequestBody(init) as { messages: Array<{ content: string }> };
      const prompt = body.messages[0]?.content ?? "";
      // "happy" traces are graded on grounding + tone only (see RUBRICS_BY_CLASS).
      expect(prompt).toContain("grounding");
      expect(prompt).toContain("tone");
      expect(prompt).not.toContain("refusal-clarity");
      return Promise.resolve(
        messagesResponse({ content: [{ type: "text", text: JSON.stringify(VALID_OUTPUT) }] }),
      );
    };

    const provider = new LiveJudgeProvider("claude-haiku-4-5", {
      apiKey: "test-key",
      fetch: fakeFetch,
    });
    await provider.grade(TRACE);
  });

  it("throws a clear error when the response has no parseable text content", async () => {
    const fakeFetch: typeof fetch = () =>
      Promise.resolve(messagesResponse({ content: [], stop_reason: "max_tokens" }));

    const provider = new LiveJudgeProvider("claude-haiku-4-5", {
      apiKey: "test-key",
      fetch: fakeFetch,
    });
    await expect(provider.grade(TRACE)).rejects.toThrow(/no parseable output/);
  });

  it("propagates a schema-validation failure rather than silently returning a malformed verdict", async () => {
    const fakeFetch: typeof fetch = () =>
      Promise.resolve(
        messagesResponse({
          content: [
            { type: "text", text: JSON.stringify({ verdict: "pass" /* missing scores etc. */ }) },
          ],
        }),
      );

    const provider = new LiveJudgeProvider("claude-haiku-4-5", {
      apiKey: "test-key",
      fetch: fakeFetch,
    });
    await expect(provider.grade(TRACE)).rejects.toThrow();
  });

  it("retries a 429 up to maxRetries and eventually succeeds", async () => {
    let callCount = 0;
    const fakeFetch: typeof fetch = () => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              type: "error",
              error: { type: "rate_limit_error", message: "slow down" },
            }),
            { status: 429, headers: { "content-type": "application/json", "retry-after": "0" } },
          ),
        );
      }
      return Promise.resolve(
        messagesResponse({ content: [{ type: "text", text: JSON.stringify(VALID_OUTPUT) }] }),
      );
    };

    const provider = new LiveJudgeProvider("claude-haiku-4-5", {
      apiKey: "test-key",
      fetch: fakeFetch,
      maxRetries: 1,
    });
    const result = await provider.grade(TRACE);

    expect(result.output).toEqual(VALID_OUTPUT);
    expect(callCount).toBe(2); // one 429 + one retry that succeeds
  });

  it("does not retry when maxRetries is 0 -- a 429 surfaces immediately", async () => {
    let callCount = 0;
    const fakeFetch: typeof fetch = () => {
      callCount += 1;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            type: "error",
            error: { type: "rate_limit_error", message: "slow down" },
          }),
          { status: 429, headers: { "content-type": "application/json", "retry-after": "0" } },
        ),
      );
    };

    const provider = new LiveJudgeProvider("claude-haiku-4-5", {
      apiKey: "test-key",
      fetch: fakeFetch,
      maxRetries: 0,
    });
    await expect(provider.grade(TRACE)).rejects.toThrow();
    expect(callCount).toBe(1);
  });

  it("never calls the network when a fetch is injected (sanity: no real HTTP)", async () => {
    const fakeFetch = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        messagesResponse({ content: [{ type: "text", text: JSON.stringify(VALID_OUTPUT) }] }),
      ),
    );
    const provider = new LiveJudgeProvider("claude-haiku-4-5", {
      apiKey: "test-key",
      fetch: fakeFetch,
    });
    await provider.grade(TRACE);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });
});
