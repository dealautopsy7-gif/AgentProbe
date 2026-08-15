import { Queue } from "bullmq";
import { getRedisConnection } from "./redis.js";

export const RUN_QUEUE_NAME = "agent-run";

export interface RunJobData {
  runId: string;
  siteId: string;
  userId: string;
  url: string;
  goal: string;
  attempts: number;
  /** 'schedule' runs are the only ones checked for a score-drop alert — see runWorker.ts. */
  source: "manual" | "schedule";
}

let queue: Queue<RunJobData> | null = null;

export function getRunQueue(): Queue<RunJobData> {
  if (queue) return queue;
  queue = new Queue<RunJobData>(RUN_QUEUE_NAME, { connection: getRedisConnection() });
  return queue;
}

export const SCHEDULE_TICK_QUEUE_NAME = "schedule-tick";

let scheduleQueue: Queue<Record<string, never>> | null = null;

export function getScheduleTickQueue(): Queue<Record<string, never>> {
  if (scheduleQueue) return scheduleQueue;
  scheduleQueue = new Queue(SCHEDULE_TICK_QUEUE_NAME, { connection: getRedisConnection() });
  return scheduleQueue;
}
