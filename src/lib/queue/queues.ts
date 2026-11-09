import { Queue } from 'bullmq';
import { newRedisConnection } from './connection';

export const QUEUE = { scheduler: 'fc-scheduler', generate: 'fc-generate', publish: 'fc-publish' } as const;

export interface GenerateJobData { accountId: string; scheduleId?: string; productId?: string; format?: string; createdBy: string }
export interface PublishJobData { publicationJobId: string }

const queues = new Map<string, Queue>();
export function queue(name: string): Queue {
  let q = queues.get(name);
  if (!q) { q = new Queue(name, { connection: newRedisConnection(), defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 } }); queues.set(name, q); }
  return q;
}

/** BullMQ dedupes by jobId, so these are idempotent: the same key is never enqueued twice while it exists. */
export async function enqueueGenerate(data: GenerateJobData, jobId: string) {
  return queue(QUEUE.generate).add('generate', data, { jobId, attempts: 1 });
}
export async function enqueuePublish(publicationJobId: string, delayMs = 0) {
  // Unique per attempt-window: re-enqueue after a definitive non-acceptance uses a new suffix.
  return queue(QUEUE.publish).add('publish', { publicationJobId } satisfies PublishJobData, { jobId: `pub-${publicationJobId}-${Date.now()}`, delay: Math.max(0, delayMs), attempts: 1 });
}
export async function closeQueues() { await Promise.all([...queues.values()].map((q) => q.close())); queues.clear(); }

let enqueueImpl: { generate: typeof enqueueGenerate; publish: typeof enqueuePublish } = { generate: enqueueGenerate, publish: enqueuePublish };
/** Test hook — integration tests capture enqueues instead of needing a running worker. */
export function setEnqueueImpl(i: typeof enqueueImpl | null) { enqueueImpl = i ?? { generate: enqueueGenerate, publish: enqueuePublish }; }
export const enq = { generate: (d: GenerateJobData, id: string) => enqueueImpl.generate(d, id), publish: (id: string, delay = 0) => enqueueImpl.publish(id, delay) };
