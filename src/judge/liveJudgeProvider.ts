import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Trace } from "../types/trace.js";
import { judgeOutputSchema, RUBRICS_BY_CLASS, type JudgeOutput } from "../types/judge.js";
import { JUDGE_SYSTEM_PROMPT, buildUserPrompt } from "./rubric.js";
import { renderTraceNarrative } from "./traceNarrative.js";
import type { JudgeProvider } from "./judgeProvider.js";

/**
 * Real LLM-as-judge call, enabled only behind --live. Ported grading contract (see
 * types/judge.ts), but the mechanism for enforcing it is `output_config.format` with a Zod
 * schema (Anthropic structured outputs) rather than agent-eval-bench's manual JSON-object
 * parse-and-reject loop — the newer API feature does the same job (reject malformed shape)
 * without hand-written parsing code.
 *
 * Model defaults to Claude Haiku 4.5: cheap and fast for a bounded per-criterion scoring
 * task with a fixed anchor scale, matching the job bullet's "cost efficiency" framing for
 * post-processing large volumes of traces. Override with JUDGE_MODEL for a stronger judge
 * (e.g. claude-sonnet-5) when the calibration report says Haiku's agreement with human
 * labels doesn't clear the bar.
 */
export interface LiveJudgeProviderOptions {
  apiKey?: string;
  /** Injectable so tests can intercept requests without a real network call or API key. */
  fetch?: typeof fetch;
  /** SDK-level retry budget for 429s/5xxs on a single call, distinct from BullMQ's job-level
   *  retry (JOB_ATTEMPTS) -- defaults to the SDK's own default (2) when omitted. */
  maxRetries?: number;
}

export class LiveJudgeProvider implements JudgeProvider {
  readonly name = "live";
  readonly model: string;
  private readonly client: Anthropic;

  constructor(model: string, options: LiveJudgeProviderOptions = {}) {
    this.model = model;
    this.client = new Anthropic({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
    });
  }

  async grade(
    trace: Trace,
  ): Promise<{ output: JudgeOutput; inputTokens: number; outputTokens: number }> {
    const criteria = RUBRICS_BY_CLASS[trace.scenarioClass];
    const narrative = renderTraceNarrative(trace);
    const userPrompt = buildUserPrompt(criteria, narrative);

    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 1024,
      system: JUDGE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      output_config: { format: zodOutputFormat(judgeOutputSchema) },
    });

    if (!response.parsed_output) {
      throw new Error(
        `live judge returned no parseable output for trace ${trace.traceId} (stop_reason=${response.stop_reason})`,
      );
    }

    return {
      output: response.parsed_output,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}
