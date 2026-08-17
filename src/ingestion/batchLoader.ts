import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { traceSchema, type Trace, type TraceBatch } from "../types/trace.js";

/** Reads and validates every `*.json` trace fixture in a directory (one trace per file). */
export async function loadTracesFromDir(dir: string): Promise<Trace[]> {
  const entries = await readdir(dir);
  const files = entries.filter((f) => f.endsWith(".json")).sort();
  const traces: Trace[] = [];
  for (const file of files) {
    const raw = await readFile(join(dir, file), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    traces.push(traceSchema.parse(parsed));
  }
  return traces;
}

/** Splits a flat trace list into fixed-size batches, each with a deterministic batch id. */
export function chunkIntoBatches(
  traces: readonly Trace[],
  batchSize: number,
  batchIdPrefix: string,
): TraceBatch[] {
  if (batchSize <= 0) throw new Error("batchSize must be positive");
  const batches: TraceBatch[] = [];
  for (let i = 0; i < traces.length; i += batchSize) {
    const slice = traces.slice(i, i + batchSize);
    batches.push({
      batchId: `${batchIdPrefix}-${String(batches.length).padStart(4, "0")}`,
      traces: slice,
    });
  }
  return batches;
}
