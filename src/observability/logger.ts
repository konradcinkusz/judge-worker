import pino from "pino";
import { loadEnv } from "../config/env.js";

/**
 * Structured logging per trace vocabulary borrowed from OTel GenAI semantic conventions
 * (architecture-standards/docs/guides/AI-EVALS.md §4): one log line per job carrying model,
 * token, and latency attributes, plus batch-level throughput lines. A worker that instruments
 * what it processes but not itself is a named anti-pattern in that guide — every batch and
 * job log line below is emitted regardless of whether the traces inside are interesting.
 */
const baseOptions: pino.LoggerOptions = { level: loadEnv().LOG_LEVEL };
const prettyOptions: pino.LoggerOptions = {
  ...baseOptions,
  transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } },
};

export const logger = pino(process.env["NODE_ENV"] === "production" ? baseOptions : prettyOptions);

export function childLogger(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(bindings);
}
