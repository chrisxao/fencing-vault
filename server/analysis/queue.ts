import crypto from 'node:crypto';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const MEDIA_QUEUE = 'fencing-analysis-media';
export const VLM_QUEUE = 'fencing-analysis-vlm';

let connection: IORedis | null | undefined;
let mediaQueue: Queue<MediaJobData> | null;
let vlmQueue: Queue<VlmJobData> | null;

export interface MediaJobData {
  analysisJobId: string;
  runId: string;
  ownerId: string;
  videoId: string;
  sourceKey: string;
}

interface VlmJobBase {
  analysisJobId: string;
  runId: string;
  ownerId: string;
  videoId: string;
}

export interface VlmClipJobData extends VlmJobBase {
  kind: 'clip';
  clipId: string;
}

export interface VlmFinalizeJobData extends VlmJobBase {
  kind: 'finalize';
}

export type VlmJobData = VlmClipJobData | VlmFinalizeJobData;

export function redisConnection() {
  if (connection !== undefined) return connection;
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    connection = null;
    return null;
  }
  connection = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? 5000),
  });
  connection.on('error', (error) => console.error('[redis]', error.message));
  return connection;
}

export function analysisQueues() {
  const redis = redisConnection();
  if (!redis) return null;
  mediaQueue ??= new Queue<MediaJobData>(MEDIA_QUEUE, { connection: redis });
  vlmQueue ??= new Queue<VlmJobData>(VLM_QUEUE, { connection: redis });
  return { media: mediaQueue, vlm: vlmQueue };
}

export function queueJobId(
  kind: 'media' | 'vlm' | 'vlm-clip' | 'vlm-finalize',
  analysisJobId: string,
  ...scope: string[]
) {
  const digest = crypto
    .createHash('sha256')
    .update([analysisJobId, ...scope].join('\0'))
    .digest('hex')
    .slice(0, 32);
  return `${kind}-${digest}`;
}

export function mediaQueueJobId(analysisJobId: string, runId: string) {
  return queueJobId('media', analysisJobId, runId);
}

export function vlmClipQueueJobId(analysisJobId: string, runId: string, clipId: string) {
  return queueJobId('vlm-clip', analysisJobId, runId, clipId);
}

export function vlmFinalizeQueueJobId(analysisJobId: string, runId: string) {
  return queueJobId('vlm-finalize', analysisJobId, runId);
}

export const queueDefaults = {
  attempts: Number(process.env.ANALYSIS_QUEUE_ATTEMPTS ?? 4),
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 86_400, count: 1_000 },
  removeOnFail: { age: 604_800, count: 5_000 },
};

export async function enqueueMedia(data: MediaJobData) {
  const queues = analysisQueues();
  if (!queues) throw new Error('Analysis is unavailable because REDIS_URL is not configured');
  return queues.media.add('preprocess', data, {
    ...queueDefaults,
    jobId: mediaQueueJobId(data.analysisJobId, data.runId),
  });
}

export async function enqueueVlmClips(
  data: Omit<VlmClipJobData, 'kind' | 'clipId'>,
  clipIds: string[],
) {
  const queues = analysisQueues();
  if (!queues) throw new Error('Analysis is unavailable because REDIS_URL is not configured');
  return queues.vlm.addBulk(
    clipIds.map((clipId) => ({
      name: 'detect-clip',
      data: { ...data, kind: 'clip' as const, clipId },
      opts: {
        ...queueDefaults,
        jobId: vlmClipQueueJobId(data.analysisJobId, data.runId, clipId),
      },
    })),
  );
}

export async function enqueueVlmFinalization(data: Omit<VlmFinalizeJobData, 'kind'>) {
  const queues = analysisQueues();
  if (!queues) throw new Error('Analysis is unavailable because REDIS_URL is not configured');
  return queues.vlm.add('finalize', { ...data, kind: 'finalize' }, {
    ...queueDefaults,
    jobId: vlmFinalizeQueueJobId(data.analysisJobId, data.runId),
  });
}

export async function cancelQueuedJobs(input: {
  analysisJobId: string;
  runId: string;
  clipIds: string[];
}) {
  const queues = analysisQueues();
  if (!queues) return;
  const jobs = [
    [queues.media, mediaQueueJobId(input.analysisJobId, input.runId)] as const,
    [queues.vlm, vlmFinalizeQueueJobId(input.analysisJobId, input.runId)] as const,
    ...input.clipIds.map(
      (clipId) =>
        [
          queues.vlm,
          vlmClipQueueJobId(input.analysisJobId, input.runId, clipId),
        ] as const,
    ),
  ];
  for (const [queue, jobId] of jobs) {
    const job = await queue.getJob(jobId);
    if (job && (await job.getState()) !== 'active') await job.remove();
  }
}

export function parentCoordinationLockKey(analysisJobId: string, runId: string) {
  return `analysis:parent:${analysisJobId}:${runId}`;
}

export function analysisLifecycleLockKey(analysisJobId: string) {
  return `analysis:lifecycle:${analysisJobId}`;
}

export function finalizationLockKey(analysisJobId: string, runId: string) {
  return `analysis:finalize:${analysisJobId}:${runId}`;
}

export async function withRedisLock<T>(
  key: string,
  action: () => Promise<T>,
  options: { ttlMs?: number; waitMs?: number } = {},
) {
  const redis = redisConnection();
  if (!redis) throw new Error('REDIS_URL is required for analysis coordination');
  const token = crypto.randomUUID();
  const ttlMs = options.ttlMs ?? 30_000;
  const deadline = Date.now() + (options.waitMs ?? 30_000);
  while ((await redis.set(key, token, 'PX', ttlMs, 'NX')) !== 'OK') {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for analysis lock ${key}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  try {
    return await action();
  } finally {
    await redis.eval(
      'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
      1,
      key,
      token,
    );
  }
}

export async function closeQueues() {
  await Promise.all([mediaQueue?.close(), vlmQueue?.close()]);
  await connection?.quit();
  mediaQueue = null;
  vlmQueue = null;
  connection = undefined;
}
