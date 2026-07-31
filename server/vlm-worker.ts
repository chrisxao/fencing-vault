import 'dotenv/config';
import { Worker, type Job } from 'bullmq';
import { getObjectUrl } from './storage.ts';
import {
  clipInferenceResultSchema,
  consolidateDetections,
  detectionSchema,
  finalizationInput,
  inferenceProgress,
  pipelineConfig,
  sourceTimestamp,
} from './analysis/domain.ts';
import { classifyAward, detectPhraseEnd } from './analysis/openrouter.ts';
import {
  analysisLifecycleLockKey,
  cancelQueuedJobs,
  enqueueVlmFinalization,
  finalizationLockKey,
  parentCoordinationLockKey,
  queueDefaults,
  redisConnection,
  VLM_QUEUE,
  withRedisLock,
  type VlmClipJobData,
  type VlmFinalizeJobData,
  type VlmJobData,
} from './analysis/queue.ts';
import {
  getJobForWorker,
  listJobClips,
  markClipsCancelled,
  replaceCandidates,
  sanitizedError,
  updateClip,
  updateJob,
} from './analysis/repository.ts';

const connection = redisConnection();
if (!connection) throw new Error('REDIS_URL is required for the VLM worker');

function readUsages(value?: string) {
  if (!value) return [];
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error('Persisted clip usage is not an array');
  return parsed as unknown[];
}

function usageCost(usage: unknown) {
  const value = Number((usage as { cost?: number } | undefined)?.cost ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function isCurrentRunnable(data: VlmJobData) {
  const record = await getJobForWorker(data.analysisJobId, data.ownerId);
  return (
    record.runId === data.runId &&
    !record.cancelRequested &&
    !['cancelled', 'completed', 'failed'].includes(record.status)
  );
}

async function coordinateParent(data: VlmClipJobData) {
  await withRedisLock(parentCoordinationLockKey(data.analysisJobId, data.runId), async () => {
    const record = await getJobForWorker(data.analysisJobId, data.ownerId);
    if (
      record.runId !== data.runId ||
      record.cancelRequested ||
      ['cancelled', 'completed', 'failed'].includes(record.status)
    ) {
      return;
    }
    const clips = await listJobClips(data.analysisJobId, data.ownerId, data.runId);
    if (clips.some((clip) => clip.status === 'failed')) {
      await updateJob(data.analysisJobId, {
        status: 'failed',
        stage: 'inference',
        error: 'One or more analysis clips failed',
        completedAt: Date.now(),
      });
      return;
    }

    const progress = Math.max(record.progress, inferenceProgress(clips));
    const allCompleted = clips.length > 0 && clips.every((clip) => clip.status === 'completed');
    if (!allCompleted) {
      await updateJob(data.analysisJobId, {
        status: 'processing',
        stage: 'inference',
        progress,
        error: '',
      });
      return;
    }

    await enqueueVlmFinalization({
      analysisJobId: data.analysisJobId,
      runId: data.runId,
      ownerId: data.ownerId,
      videoId: data.videoId,
    });
    await updateJob(data.analysisJobId, {
      status: 'processing',
      stage: 'finalizing',
      progress: 0.9,
      error: '',
    });
  });
}

async function processClip(bullJob: Job<VlmJobData>) {
  const data = bullJob.data;
  if (data.kind !== 'clip') throw new Error('Clip processor received a finalization job');
  if (!(await isCurrentRunnable(data))) return;

  const record = await getJobForWorker(data.analysisJobId, data.ownerId);
  const model = record.model ?? pipelineConfig.model;
  const provider = record.provider ?? pipelineConfig.provider;
  const promptVersion = record.promptVersion ?? pipelineConfig.promptVersion;
  const clips = await listJobClips(data.analysisJobId, data.ownerId, data.runId);
  const clip = clips.find((item) => item.id === data.clipId);
  if (!clip) throw new Error('Analysis clip does not belong to the active job run');
  if (clip.status === 'completed') {
    await coordinateParent(data);
    return;
  }

  const usages = readUsages(clip.usageJson);
  let costUsd = clip.costUsd ?? 0;
  const attempt = bullJob.attemptsMade + 1;
  await updateClip(clip.id, {
    status: 'processing',
    attempt,
    error: '',
    startedAt: Date.now(),
  });

  try {
    const url = await getObjectUrl(clip.s3Key, 600);
    const durationSeconds = clip.sourceEnd - clip.sourceStart;
    const stageA = await detectPhraseEnd(url, {
      model,
      provider,
      promptVersion,
      durationSeconds,
    });
    if (stageA.usage !== undefined) usages.push(stageA.usage);
    costUsd += usageCost(stageA.usage);

    let result;
    if (!stageA.parsed.candidate_phrase_end) {
      result = clipInferenceResultSchema.parse({
        kind: 'negative',
        stageA: stageA.parsed,
        rawResponses: [{ stage: 'A', response: stageA.raw }],
        model: stageA.model,
        provider: stageA.provider,
        promptVersion,
      });
    } else {
      if (!(await isCurrentRunnable(data))) return;
      const stageB = await classifyAward(url, {
        model,
        provider,
        promptVersion,
        durationSeconds,
      });
      if (stageB.usage !== undefined) usages.push(stageB.usage);
      costUsd += usageCost(stageB.usage);
      const timestamp = sourceTimestamp(
        {
          index: clip.index,
          start: clip.sourceStart,
          end: clip.sourceEnd,
          overlap: clip.overlap,
        },
        stageB.parsed.local_timestamp_seconds,
      );
      const detection = detectionSchema.parse({
        timestamp,
        eventStart: Math.max(clip.sourceStart, timestamp - 1),
        eventEnd: Math.min(clip.sourceEnd, timestamp + 1),
        confidence: Math.min(stageA.parsed.confidence, stageB.parsed.confidence),
        pointAwarded: stageB.parsed.point_awarded,
        awardedSide: stageB.parsed.awarded_side,
        evidence: [...stageA.parsed.observable_cues, ...stageB.parsed.observable_cues],
        rawResponses: [
          { stage: 'A', response: stageA.raw },
          { stage: 'B', response: stageB.raw },
        ],
        clipId: clip.id,
        model: stageB.model,
        provider: stageB.provider,
        promptVersion,
      });
      result = clipInferenceResultSchema.parse({ kind: 'detection', detection });
    }

    if (!(await isCurrentRunnable(data))) return;
    await updateClip(clip.id, {
      status: 'completed',
      attempt,
      resultJson: JSON.stringify(result),
      usageJson: JSON.stringify(usages),
      costUsd: Number(costUsd.toFixed(8)),
      error: '',
      completedAt: Date.now(),
    });
  } catch (error) {
    if (await isCurrentRunnable(data).catch(() => false)) {
      await updateClip(clip.id, {
        status: 'retrying',
        attempt,
        usageJson: JSON.stringify(usages),
        costUsd: Number(costUsd.toFixed(8)),
        error: sanitizedError(error),
      });
    }
    throw error;
  }

  await coordinateParent(data);
}

async function finalizeAnalysis(data: VlmFinalizeJobData) {
  await withRedisLock(
    finalizationLockKey(data.analysisJobId, data.runId),
    async () => {
      await withRedisLock(
        analysisLifecycleLockKey(data.analysisJobId),
        async () => {
          await withRedisLock(
            parentCoordinationLockKey(data.analysisJobId, data.runId),
            async () => {
              const record = await getJobForWorker(data.analysisJobId, data.ownerId);
              if (
                record.runId !== data.runId ||
                record.cancelRequested ||
                ['cancelled', 'failed'].includes(record.status)
              ) {
                return;
              }
              if (record.status === 'completed') return;

              const clips = await listJobClips(data.analysisJobId, data.ownerId, data.runId);
              const input = finalizationInput(clips);
              if (!input) throw new Error('Cannot finalize before every analysis clip succeeds');
              const consolidated = consolidateDetections(
                input.detections,
                Number(process.env.ANALYSIS_DEDUP_TOLERANCE_SECONDS ?? 1.5),
              );
              await replaceCandidates({
                ownerId: data.ownerId,
                videoId: data.videoId,
                jobId: data.analysisJobId,
                runId: data.runId,
                detections: consolidated,
              });
              await updateJob(data.analysisJobId, {
                status: 'completed',
                stage: 'completed',
                progress: 1,
                usageJson: JSON.stringify(input.usages),
                costUsd: input.costUsd,
                completedAt: Date.now(),
                error: '',
              });
            },
            {
              ttlMs: Number(process.env.ANALYSIS_FINALIZATION_LOCK_MS ?? 300_000),
              waitMs: Number(process.env.ANALYSIS_FINALIZATION_WAIT_MS ?? 300_000),
            },
          );
        },
        {
          ttlMs: Number(process.env.ANALYSIS_FINALIZATION_LOCK_MS ?? 300_000),
          waitMs: Number(process.env.ANALYSIS_FINALIZATION_WAIT_MS ?? 300_000),
        },
      );
    },
    {
      ttlMs: Number(process.env.ANALYSIS_FINALIZATION_LOCK_MS ?? 300_000),
      waitMs: Number(process.env.ANALYSIS_FINALIZATION_WAIT_MS ?? 300_000),
    },
  );
}

const worker = new Worker<VlmJobData>(
  VLM_QUEUE,
  async (bullJob) => {
    if (bullJob.data.kind === 'clip') await processClip(bullJob);
    else await finalizeAnalysis(bullJob.data);
  },
  {
    connection,
    concurrency: Number(process.env.VLM_WORKER_CONCURRENCY ?? 2),
    limiter: {
      max: Number(process.env.VLM_WORKER_RATE_MAX ?? 20),
      duration: Number(process.env.VLM_WORKER_RATE_WINDOW_MS ?? 60_000),
    },
    lockDuration: Number(process.env.VLM_WORKER_LOCK_MS ?? 180_000),
  },
);

worker.on('failed', async (job, error) => {
  if (!job || job.attemptsMade < (job.opts.attempts ?? queueDefaults.attempts)) return;
  try {
    const data = job.data;
    const clips = await withRedisLock(
      parentCoordinationLockKey(data.analysisJobId, data.runId),
      async () => {
        const record = await getJobForWorker(data.analysisJobId, data.ownerId);
        if (
          record.runId !== data.runId ||
          record.cancelRequested ||
          ['cancelled', 'completed', 'failed'].includes(record.status)
        ) {
          return null;
        }
        if (data.kind === 'clip') {
          await updateClip(data.clipId, {
            status: 'failed',
            attempt: job.attemptsMade,
            error: sanitizedError(error),
            completedAt: Date.now(),
          });
        }
        const runClips = await listJobClips(data.analysisJobId, data.ownerId, data.runId);
        await updateJob(data.analysisJobId, {
          status: 'failed',
          stage: data.kind === 'clip' ? 'inference' : 'finalizing',
          error: sanitizedError(error),
          completedAt: Date.now(),
        });
        await markClipsCancelled(runClips);
        return runClips;
      },
    );
    if (!clips) return;
    await cancelQueuedJobs({
      analysisJobId: data.analysisJobId,
      runId: data.runId,
      clipIds: clips.map((clip) => clip.id),
    });
  } catch (updateError) {
    console.error('[vlm-worker] final status failed', updateError);
  }
});
worker.on('error', (error) => console.error('[vlm-worker]', error));
console.log('[vlm-worker] ready');

async function shutdown() {
  await worker.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
