import { z } from "zod";

/**
 * Trace shape ported from agent-eval-bench's TraceRecording (Execution/TraceRecording.cs):
 * tool calls and events share one time-ordered `position` index so grading logic compares
 * them on a single timeline instead of two unrelated lists. Nothing here is graded from
 * free-text replies alone — replies exist only inside `turns`, and the judge only ever
 * reads them through the narrative renderer (see judge/traceNarrative.ts), never raw.
 */

export const SCENARIO_CLASSES = [
  "happy",
  "ambiguity",
  "denied",
  "adversarial",
  "degradation",
] as const;
export type ScenarioClass = (typeof SCENARIO_CLASSES)[number];

const toolCallSchema = z.object({
  position: z.number().int().nonnegative(),
  tool: z.string().min(1),
  kind: z.enum(["read", "write"]),
  outcome: z.enum(["success", "error", "timeout"]),
  arguments: z.record(z.string(), z.unknown()).default({}),
  resultSummary: z.string().optional(),
  attempts: z.number().int().positive().default(1),
});

const traceEventSchema = z.object({
  position: z.number().int().nonnegative(),
  name: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()).default({}),
});

const turnSchema = z.object({
  index: z.number().int().nonnegative(),
  outcome: z.string().min(1),
  terminationReason: z.string().min(1),
  reply: z.string(),
});

const conversationTurnSchema = z.object({
  role: z.enum(["user", "confirmation"]),
  content: z.string(),
});

export const traceSchema = z.object({
  traceId: z.string().min(1),
  scenarioId: z.string().min(1),
  scenarioClass: z.enum(SCENARIO_CLASSES),
  setting: z.object({
    actor: z.string().min(1),
    clock: z.string().min(1),
    timezone: z.string().min(1),
    locale: z.string().optional(),
  }),
  conversation: z.array(conversationTurnSchema).min(1),
  toolCalls: z.array(toolCallSchema),
  events: z.array(traceEventSchema),
  turns: z.array(turnSchema).min(1),
});

export type Trace = z.infer<typeof traceSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type TraceEvent = z.infer<typeof traceEventSchema>;
export type Turn = z.infer<typeof turnSchema>;

export const traceBatchSchema = z.object({
  batchId: z.string().min(1),
  traces: z.array(traceSchema).min(1),
});

export type TraceBatch = z.infer<typeof traceBatchSchema>;

/** Single ordered timeline of tool calls and events, sorted by `position`. */
export function mergedTimeline(
  trace: Trace,
): Array<
  | { type: "tool_call"; position: number; value: ToolCall }
  | { type: "event"; position: number; value: TraceEvent }
> {
  const calls = trace.toolCalls.map((value) => ({
    type: "tool_call" as const,
    position: value.position,
    value,
  }));
  const events = trace.events.map((value) => ({
    type: "event" as const,
    position: value.position,
    value,
  }));
  return [...calls, ...events].sort((a, b) => a.position - b.position);
}
