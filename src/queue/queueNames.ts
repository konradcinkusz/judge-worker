import { loadEnv } from "../config/env.js";

export function judgeQueueName(): string {
  return loadEnv().JUDGE_QUEUE_NAME;
}

export function deadLetterQueueName(): string {
  return `${judgeQueueName()}-dead-letter`;
}
