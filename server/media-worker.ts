import 'dotenv/config';
import { Worker } from 'bullmq';
import { preprocessVideo } from './analysis/preprocess.ts';
import {
  MEDIA_QUEUE,
  cancelQueuedJobs,
  enqueueVlmClips,
  parentCoordinationLockKey,
  queueDefaults,
  redisConnection,
  withRedisLock,
  type MediaJobData,
} from './analysis/queue.ts';
import {
  getJobForWorker,
  listJobClips,
  markClipsCancelled,
  sanitizedError,
  updateJob,
} from './analysis/repository.ts';

const connection = redisConnection();
if (!connection) throw new Error('REDIS_URL is required for the media worker');

async function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  let timer: NodeJS.Timeout;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Media job timed out after ${milliseconds}ms`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

const worker = new Worker<MediaJobData>(
  MEDIA_QUEUE,
  async (bullJob) => {
    const data = bullJob.data;
    const record = await getJobForWorker(data.analysisJobId, data.ownerId);
    if (
      record.runId !== data.runId ||
      record.cancelRequested ||
      ['cancelled', 'completed', 'failed'].includes(record.status)
    ) {
      return;
    }
    const shouldRun = await withRedisLock(
      parentCoordinationLockKey(data.analysisJobId, data.runId),
      async () => {
        const current = await getJobForWorker(data.analysisJobId, data.ownerId);
        if (
          current.runId !== data.runId ||
          current.cancelRequested ||
          ['cancelled', 'completed', 'failed'].includes(current.status)
        ) {
          return false;
        }
        await updateJob(data.analysisJobId, {
          status: 'processing',
          stage: current.progress >= 0.4 ? current.stage : 'preprocessing',
          progress: Math.max(current.progress, 0.05),
          attempts: bullJob.attemptsMade + 1,
          startedAt: current.startedAt ?? Date.now(),
        });
        return true;
      },
    );
    if (!shouldRun) return;
    try {
      await withTimeout(
        preprocessVideo(data),
        Number(process.env.MEDIA_JOB_TIMEOUT_MS ?? 3_900_000),
      );
      const latest = await getJobForWorker(data.analysisJobId, data.ownerId);
      if (
        latest.runId !== data.runId ||
        latest.cancelRequested ||
        ['cancelled', 'completed', 'failed'].includes(latest.status)
      ) {
        const staleClips = await listJobClips(
          data.analysisJobId,
          data.ownerId,
          data.runId,
        );
        await markClipsCancelled(staleClips);
        return;
      }
      const clips = await listJobClips(data.analysisJobId, data.ownerId, data.runId);
      if (clips.length === 0) throw new Error('Preprocessing produced no analysis clips');
      await withRedisLock(
        parentCoordinationLockKey(data.analysisJobId, data.runId),
        async () => {
          const current = await getJobForWorker(data.analysisJobId, data.ownerId);
          if (
            current.runId !== data.runId ||
            current.cancelRequested ||
            ['cancelled', 'completed', 'failed'].includes(current.status)
          ) {
            return;
          }
          await updateJob(data.analysisJobId, {
            status: 'processing',
            stage: 'inference_queued',
            progress: Math.max(current.progress, 0.4),
          });
          await enqueueVlmClips(
            {
              analysisJobId: data.analysisJobId,
              runId: data.runId,
              ownerId: data.ownerId,
              videoId: data.videoId,
            },
            clips.map((clip) => clip.id),
          );
        },
      );
    } catch (error) {
      const latest = await getJobForWorker(data.analysisJobId, data.ownerId).catch(() => null);
      if (
        latest?.runId === data.runId &&
        !latest.cancelRequested &&
        !['cancelled', 'completed', 'failed'].includes(latest.status)
      ) {
        await updateJob(data.analysisJobId, {
          status: 'retrying',
          stage: 'preprocessing',
          error: sanitizedError(error),
        });
      }
      throw error;
    }
  },
  {
    connection,
    concurrency: Number(process.env.MEDIA_WORKER_CONCURRENCY ?? 1),
    limiter: {
      max: Number(process.env.MEDIA_WORKER_RATE_MAX ?? 2),
      duration: Number(process.env.MEDIA_WORKER_RATE_WINDOW_MS ?? 60_000),
    },
    lockDuration: Number(process.env.MEDIA_WORKER_LOCK_MS ?? 300_000),
  },
);

worker.on('failed', async (job, error) => {
  if (!job || job.attemptsMade < (job.opts.attempts ?? queueDefaults.attempts)) return;
  try {
    const clips = await withRedisLock(
      parentCoordinationLockKey(job.data.analysisJobId, job.data.runId),
      async () => {
        const record = await getJobForWorker(
          job.data.analysisJobId,
          job.data.ownerId,
        ).catch(() => null);
        if (
          !record ||
          record.runId !== job.data.runId ||
          record.cancelRequested ||
          ['cancelled', 'completed', 'failed'].includes(record.status)
        ) {
          return null;
        }
        await updateJob(job.data.analysisJobId, {
          status: 'failed',
          stage: 'preprocessing',
          error: sanitizedError(error),
          completedAt: Date.now(),
        });
        const runClips = await listJobClips(
          job.data.analysisJobId,
          job.data.ownerId,
          job.data.runId,
        );
        await markClipsCancelled(runClips);
        return runClips;
      },
    );
    if (!clips) return;
    await cancelQueuedJobs({
      analysisJobId: job.data.analysisJobId,
      runId: job.data.runId,
      clipIds: clips.map((clip) => clip.id),
    });
  } catch (updateError) {
    console.error('[media-worker] final status failed', updateError);
  }
});
worker.on('error', (error) => console.error('[media-worker]', error));
console.log('[media-worker] ready');

async function shutdown() {
  await worker.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
