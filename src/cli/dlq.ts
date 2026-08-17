#!/usr/bin/env node
import {
  deadLetterDepth,
  listDeadLetterEntries,
  requeueDeadLetterJob,
  requeueAllDeadLetterJobs,
} from "../reliability/deadLetter.js";
import { closeQueue } from "../queue/producer.js";
import { closeRedisConnection } from "../queue/connection.js";
import { logger } from "../observability/logger.js";

/**
 * Inspects and replays the dead-letter queue -- the read side (deadLetterDepth,
 * listDeadLetterEntries) has existed since the base build, but there was no way to move a
 * dead-lettered job back onto the main queue after fixing whatever caused it to fail
 * permanently (a config error, a since-fixed judge bug). See
 * reliability/deadLetter.ts's requeueDeadLetterJob for the actual requeue semantics.
 *
 * Usage:
 *   pnpm run dlq -- list [--limit N]
 *   pnpm run dlq -- requeue <jobId>
 *   pnpm run dlq -- requeue --all
 */

export type DlqCommand =
  { kind: "list"; limit: number } | { kind: "requeue"; jobId: string } | { kind: "requeue-all" };

export function parseArgs(argv: string[]): DlqCommand {
  // `pnpm run dlq -- list` forwards the "--" separator itself into argv (unlike npm, pnpm
  // does not strip it) -- harmless for the other CLIs' flag-lookup-by-indexOf parsing, but
  // this one reads position 0 as the subcommand, so a literal leading "--" must be dropped
  // first or it gets mistaken for the subcommand. Verified by actually running
  // `pnpm run dlq -- list` -- see git history for what that looked like before this fix.
  const [subcommand, ...rest] = argv.filter((arg) => arg !== "--");
  if (subcommand === "list") {
    const limitIdx = rest.indexOf("--limit");
    return { kind: "list", limit: limitIdx >= 0 ? Number(rest[limitIdx + 1]) : 50 };
  }
  if (subcommand === "requeue") {
    if (rest[0] === "--all") {
      return { kind: "requeue-all" };
    }
    const jobId = rest[0];
    if (!jobId) {
      throw new Error("dlq requeue requires a job id (or --all) -- see `pnpm run dlq -- list`");
    }
    return { kind: "requeue", jobId };
  }
  throw new Error(
    `unknown dlq subcommand ${JSON.stringify(subcommand ?? null)} -- expected "list" or "requeue"`,
  );
}

async function main(): Promise<void> {
  const command = parseArgs(process.argv.slice(2));

  if (command.kind === "list") {
    const [depth, entries] = await Promise.all([
      deadLetterDepth(),
      listDeadLetterEntries(command.limit),
    ]);
    logger.info({ depth, shown: entries.length, entries }, "dead-letter queue");
  } else if (command.kind === "requeue") {
    const entry = await requeueDeadLetterJob(command.jobId);
    logger.info({ entry }, "requeued dead-letter job");
  } else {
    const count = await requeueAllDeadLetterJobs();
    logger.info({ count }, "requeued all dead-letter entries");
  }

  await closeQueue();
  await closeRedisConnection();
}

// Only run when this file is the process entry point, not when imported for `parseArgs`
// (see test/cli.test.ts) -- otherwise importing it for testing would connect to Redis.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    logger.error({ err }, "dlq command failed");
    process.exitCode = 1;
  });
}
