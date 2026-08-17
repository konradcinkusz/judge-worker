import { Redis } from "ioredis";
import { loadEnv } from "../config/env.js";

let sharedConnection: Redis | undefined;

/**
 * BullMQ requires `maxRetriesPerRequest: null` on any connection it drives (Worker/Queue use
 * blocking Redis commands that must not be preempted by ioredis's own retry logic).
 */
export function redisConnection(): Redis {
  sharedConnection ??= new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
  return sharedConnection;
}

export async function closeRedisConnection(): Promise<void> {
  if (sharedConnection) {
    await sharedConnection.quit();
    sharedConnection = undefined;
  }
}
