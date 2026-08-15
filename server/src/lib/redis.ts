import { Redis } from "ioredis";
import { getEnv } from "../config/env.js";

let connection: Redis | null = null;

/**
 * Shared connection for BullMQ. BullMQ requires maxRetriesPerRequest: null
 * on the connection it's given — see https://docs.bullmq.io/guide/going-to-production
 */
export function getRedisConnection(): Redis {
  if (connection) return connection;
  const env = getEnv();
  connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return connection;
}
