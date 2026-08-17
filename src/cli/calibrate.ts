#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { loadTracesFromDir } from "../ingestion/batchLoader.js";
import { gradeTrace } from "../judge/gradeTrace.js";
import { loadHumanLabels, buildCalibrationReport } from "../calibration/calibrate.js";
import { loadEnv } from "../config/env.js";
import { logger } from "../observability/logger.js";
import { requireApiKeyForLive } from "./liveGuard.js";
import { buildProvider } from "./buildProvider.js";

export function parseArgs(argv: string[]): { dir: string; labelsPath: string; live: boolean } {
  const dirIdx = argv.indexOf("--dir");
  const labelsIdx = argv.indexOf("--labels");
  return {
    dir: dirIdx >= 0 ? argv[dirIdx + 1]! : "fixtures/traces",
    labelsPath: labelsIdx >= 0 ? argv[labelsIdx + 1]! : "data/calibration/human-labels.jsonl",
    live: argv.includes("--live"),
  };
}

async function main(): Promise<void> {
  const env = loadEnv();
  const { dir, labelsPath, live } = parseArgs(process.argv.slice(2));
  requireApiKeyForLive(live, env.ANTHROPIC_API_KEY);
  const provider = buildProvider(live, env);

  const [traces, labels] = await Promise.all([loadTracesFromDir(dir), loadHumanLabels(labelsPath)]);
  logger.info(
    { traceCount: traces.length, labelCount: labels.length, provider: provider.name },
    "running calibration",
  );

  const results = [];
  for (const trace of traces) {
    results.push(await gradeTrace(provider, trace));
  }

  const report = buildCalibrationReport(labels, results);
  logger.info({ report }, "calibration report");

  await mkdir("reports", { recursive: true });
  await writeFile(
    `reports/calibration-${provider.name}-${Date.now()}.json`,
    JSON.stringify({ provider: provider.name, model: provider.model, ...report }, null, 2),
  );
}

// Only run when this file is the process entry point, not when imported for `parseArgs`
// (see test/cli.test.ts) -- otherwise importing it for testing would run a real calibration.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    logger.error({ err }, "calibration run failed");
    process.exitCode = 1;
  });
}
