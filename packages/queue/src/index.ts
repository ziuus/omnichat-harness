// packages/queue/src/index.ts
// BullMQ task queue — used for async/long-running task processing
// Note: For Phase 1 the server handles tasks inline (synchronous).
// This queue is used when tasks are submitted via POST /v1/tasks (async mode).

import { Queue, QueueEvents } from 'bullmq';

export const TASK_QUEUE_NAME = 'omni-tasks';

export interface TaskJob {
  taskId: string;
  modelId: string;
  prompt: string;
  messagesJson: string;
  executionMode: string;
}

function getRedisConnection() {
  const redisUrl = new URL(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
  return {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    username: redisUrl.username || undefined,
    password: redisUrl.password || undefined,
    db: redisUrl.pathname.length > 1 ? Number(redisUrl.pathname.slice(1)) : undefined,
    maxRetriesPerRequest: null,
  };
}

function createTaskQueue() {
  return new Queue<TaskJob>(TASK_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  });
}

function createQueueEvents() {
  return new QueueEvents(TASK_QUEUE_NAME, { connection: getRedisConnection() });
}

let _queue: ReturnType<typeof createTaskQueue> | null = null;
let _events: ReturnType<typeof createQueueEvents> | null = null;

export function getTaskQueue() {
  if (!_queue) {
    _queue = createTaskQueue();
  }
  return _queue;
}

export function getQueueEvents() {
  if (!_events) {
    _events = createQueueEvents();
  }
  return _events;
}

export async function enqueueTask(job: TaskJob): Promise<string> {
  const queue = getTaskQueue();
  const result = await queue.add('process-task', job, {
    jobId: job.taskId,
    priority: 1,
  });
  return result.id ?? job.taskId;
}

export async function getQueueStats() {
  const queue = getTaskQueue();
  const [waiting, active, completed, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
  ]);
  return { waiting, active, completed, failed };
}
