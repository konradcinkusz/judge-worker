#!/usr/bin/env node
import { loadTracesFromDir, chunkIntoBatches } from "../ingestion/batchLoader.js";
import { enqueueBatch, closeQueue } from "../queue/producer.js";
import { closeRedisConnection } from "../queue/connection.js";
import { logger } from "../observability/logger.js";

function parseArgs(argv: string[]): { dir: string; batchSize: number } {
  const dirFlagIndex = argv.indexOf("--dir");
  const batchFlagIndex = argv.indexOf("--batch-size");
  return {
    dir: dirFlagIndex >= 0 ? argv[dirFlagIndex + 1]! : "fixtures/traces",
    batchSize: batchFlagIndex >= 0 ? Number(argv[batchFlagIndex + 1]) : 10,
  };
}

async function main(): Promise<void> {
  const { dir, batchSize } = parseArgs(process.argv.slice(2));
  logger.info({ dir, batchSize }, "loading trace fixtures");
  const traces = await loadTracesFromDir(dir);
  const batches = chunkIntoBatches(traces, batchSize, "batch");
  logger.info({ traceCount: traces.length, batchCount: batches.length }, "enqueuing batches");
  for (const batch of batches) {
    await enqueueBatch(batch);
  }
  await closeQueue();
  await closeRedisConnection();
  logger.info("ingestion complete");
}

main().catch((err: unknown) => {
  logger.error({ err }, "ingestion failed");
  process.exitCode = 1;
});
