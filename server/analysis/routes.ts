import crypto from 'node:crypto';
import type { Express, Response } from 'express';
import { z } from 'zod';
import { requireUser, type AuthedRequest } from '../auth-middleware.ts';
import { headObject } from '../storage.ts';
import { pipelineConfig, stableHash } from './domain.ts';
import {
  analysisLifecycleLockKey,
  cancelQueuedJobs,
  analysisQueues,
  enqueueMedia,
  parentCoordinationLockKey,
  withRedisLock,
} from './queue.ts';
import {
  CandidateReviewValidationError,
  createAnalysisJob,
  findIdempotentJob,
  getOwnedJob,
  getOwnedVideo,
  markClipsCancelled,
  reviewCandidate,
  reviewResults,
  sanitizedError,
  updateJob,
  type AnalysisJobRecord,
} from './repository.ts';

const videoInput = z.object({ videoId: z.string().uuid() });
const jobParams = z.object({ jobId: z.string().uuid() });
const candidateParams = z.object({ candidateId: z.string().uuid() });
export const candidateReviewSchema = z
  .object({
    action: z.enum(['accept', 'correct', 'reject']),
    startTime: z.number().finite().nonnegative().optional(),
    endTime: z.number().finite().nonnegative().optional(),
    timestamp: z.number().finite().nonnegative().optional(),
    result: z.enum(reviewResults).optional(),
    notes: z.string().max(5_000).optional(),
    comment: z.string().max(5_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === 'reject') {
      for (const field of ['startTime', 'endTime', 'timestamp', 'result'] as const) {
        if (value[field] !== undefined) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} is not valid when rejecting a candidate`,
          });
        }
      }
      return;
    }
    if (!value.result) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'A result is required when accepting or correcting a candidate',
      });
    }
    if (value.action === 'correct') {
      for (const field of ['startTime', 'endTime', 'timestamp'] as const) {
        if (value[field] === undefined) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} is required when correcting a candidate`,
          });
        }
      }
    } else if (
      value.startTime !== undefined ||
      value.endTime !== undefined ||
      value.timestamp !== undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['action'],
        message: 'Use action "correct" when changing candidate timestamps',
      });
    }
    if (
      value.startTime !== undefined &&
      value.endTime !== undefined &&
      value.endTime <= value.startTime
    ) {
      context.addIssue({
        code: 'custom',
        path: ['endTime'],
        message: 'endTime must be greater than startTime',
      });
    }
    if (
      value.startTime !== undefined &&
      value.endTime !== undefined &&
      value.timestamp !== undefined &&
      (value.timestamp < value.startTime || value.timestamp > value.endTime)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['timestamp'],
        message: 'timestamp must fall between startTime and endTime',
      });
    }
  });

function unavailable(res: Response) {
  res.status(503).json({
    error: 'Video analysis is unavailable because REDIS_URL is not configured',
    code: 'ANALYSIS_UNAVAILABLE',
  });
}

async function withOwnedJobLock<T>(
  ownerId: string,
  jobId: string,
  action: (job: AnalysisJobRecord) => Promise<T>,
) {
  return withRedisLock(
    analysisLifecycleLockKey(jobId),
    async () => {
      const preliminary = await getOwnedJob(ownerId, jobId);
      if (!preliminary) return null;
      return withRedisLock(
        parentCoordinationLockKey(jobId, preliminary.runId ?? 'legacy'),
        async () => {
          const job = await getOwnedJob(ownerId, jobId);
          if (!job) return null;
          if (job.runId !== preliminary.runId) {
            throw new Error('Analysis run changed while acquiring its lifecycle lock');
          }
          return action(job);
        },
        { waitMs: Number(process.env.ANALYSIS_FINALIZATION_WAIT_MS ?? 300_000) },
      );
    },
    { waitMs: Number(process.env.ANALYSIS_FINALIZATION_WAIT_MS ?? 300_000) },
  );
}

export function registerAnalysisRoutes(app: Express) {
  app.post('/api/analysis/start', requireUser, async (req: AuthedRequest, res) => {
    if (!analysisQueues()) return unavailable(res);
    const parsed = videoInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'A valid videoId is required' });
      return;
    }
    try {
      const ownerId = req.instantUser!.id;
      const video = await getOwnedVideo(ownerId, parsed.data.videoId);
      if (!video) {
        res.status(404).json({ error: 'Video not found' });
        return;
      }
      const source = await headObject(video.s3Key);
      const sourceChecksum =
        source.ChecksumSHA256 ?? source.ETag?.replaceAll('"', '') ?? stableHash({
          key: video.s3Key,
          length: source.ContentLength,
          modified: source.LastModified?.toISOString(),
        });
      const configHash = stableHash(pipelineConfig);
      const runId = crypto.randomUUID();
      const existing = await findIdempotentJob(
        ownerId,
        video.id,
        configHash,
        sourceChecksum,
      );
      if (existing) {
        res.status(200).json({ job: existing, idempotent: true });
        return;
      }
      const jobId = await createAnalysisJob({
        ownerId,
        videoId: video.id,
        runId,
        configHash,
        sourceChecksum,
        model: pipelineConfig.model,
        provider: pipelineConfig.provider,
        promptVersion: pipelineConfig.promptVersion,
      });
      try {
        await enqueueMedia({
          analysisJobId: jobId,
          runId,
          ownerId,
          videoId: video.id,
          sourceKey: video.s3Key,
        });
      } catch (error) {
        await updateJob(jobId, { status: 'failed', stage: 'queue', error: sanitizedError(error) });
        throw error;
      }
      res.status(202).json({ jobId, idempotent: false });
    } catch (error) {
      console.error('analysis start failed', error);
      res.status(500).json({ error: sanitizedError(error) });
    }
  });

  app.get('/api/analysis/:jobId', requireUser, async (req: AuthedRequest, res) => {
    if (!analysisQueues()) return unavailable(res);
    const parsed = jobParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid analysis job id' });
      return;
    }
    const job = await getOwnedJob(req.instantUser!.id, parsed.data.jobId);
    if (!job) {
      res.status(404).json({ error: 'Analysis job not found' });
      return;
    }
    res.json({ job });
  });

  app.post('/api/analysis/:jobId/retry', requireUser, async (req: AuthedRequest, res) => {
    if (!analysisQueues()) return unavailable(res);
    const parsed = jobParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid analysis job id' });
      return;
    }
    const ownerId = req.instantUser!.id;
    const retry = await withOwnedJobLock(ownerId, parsed.data.jobId, async (job) => {
      if (!['failed', 'cancelled'].includes(job.status)) {
        return { kind: 'conflict' as const, status: job.status };
      }
      const clips = job.runId
        ? job.clips.filter((clip) => clip.runId === job.runId)
        : job.clips;
      const runId = crypto.randomUUID();
      await updateJob(job.id, {
        runId,
        status: 'queued',
        stage: 'queued',
        progress: 0,
        cancelRequested: false,
        error: '',
        usageJson: '[]',
        costUsd: 0,
        startedAt: undefined,
        completedAt: undefined,
      });
      return {
        kind: 'retry' as const,
        jobId: job.id,
        runId,
        previousRunId: job.runId,
        previousClipIds: clips.map((clip) => clip.id),
        videoId: job.video.id,
        sourceKey: job.video.s3Key,
      };
    });
    if (!retry) {
      res.status(404).json({ error: 'Analysis job not found' });
      return;
    }
    if (retry.kind === 'conflict') {
      res.status(409).json({ error: 'Only failed or cancelled jobs can be retried' });
      return;
    }
    try {
      if (retry.previousRunId) {
        await cancelQueuedJobs({
          analysisJobId: retry.jobId,
          runId: retry.previousRunId,
          clipIds: retry.previousClipIds,
        });
      }
      await enqueueMedia({
        analysisJobId: retry.jobId,
        runId: retry.runId,
        ownerId,
        videoId: retry.videoId,
        sourceKey: retry.sourceKey,
      });
    } catch (error) {
      await withOwnedJobLock(ownerId, retry.jobId, async (job) => {
        if (job.runId === retry.runId && job.status === 'queued') {
          await updateJob(job.id, {
            status: 'failed',
            stage: 'queue',
            error: sanitizedError(error),
            completedAt: Date.now(),
          });
        }
      });
      res.status(500).json({ error: sanitizedError(error) });
      return;
    }
    res.status(202).json({ jobId: retry.jobId });
  });

  app.post('/api/analysis/:jobId/cancel', requireUser, async (req: AuthedRequest, res) => {
    if (!analysisQueues()) return unavailable(res);
    const parsed = jobParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid analysis job id' });
      return;
    }
    const cancellation = await withOwnedJobLock(
      req.instantUser!.id,
      parsed.data.jobId,
      async (job) => {
        if (job.status === 'completed') {
          return {
            jobId: job.id,
            status: job.status,
            runId: undefined,
            clipIds: [] as string[],
          };
        }
        const clips = job.runId
          ? job.clips.filter((clip) => clip.runId === job.runId)
          : job.clips;
        if (job.status === 'cancelled') {
          return {
            jobId: job.id,
            status: job.status,
            runId: job.runId,
            clipIds: clips.map((clip) => clip.id),
          };
        }
        await updateJob(job.id, {
          status: 'cancelled',
          stage: 'cancelled',
          cancelRequested: true,
          completedAt: Date.now(),
        });
        await markClipsCancelled(clips);
        return {
          jobId: job.id,
          status: 'cancelled',
          runId: job.runId,
          clipIds: clips.map((clip) => clip.id),
        };
      },
    );
    if (!cancellation) {
      res.status(404).json({ error: 'Analysis job not found' });
      return;
    }
    if (cancellation.runId) {
      await cancelQueuedJobs({
        analysisJobId: cancellation.jobId,
        runId: cancellation.runId,
        clipIds: cancellation.clipIds,
      });
    }
    res.json({ jobId: cancellation.jobId, status: cancellation.status });
  });

  app.post(
    '/api/analysis/candidates/:candidateId/review',
    requireUser,
    async (req: AuthedRequest, res) => {
      const params = candidateParams.safeParse(req.params);
      if (!params.success) {
        res.status(400).json({ error: 'Invalid analysis candidate id' });
        return;
      }
      const parsed = candidateReviewSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid candidate review', details: parsed.error.issues });
        return;
      }
      try {
        const review = await reviewCandidate({
          ownerId: req.instantUser!.id,
          candidateId: params.data.candidateId,
          ...parsed.data,
          notes: parsed.data.notes?.trim() || undefined,
          comment: parsed.data.comment?.trim() || undefined,
        });
        if (!review) {
          res.status(404).json({ error: 'Analysis candidate not found' });
          return;
        }
        res.json({ review });
      } catch (error) {
        if (error instanceof CandidateReviewValidationError) {
          res.status(400).json({ error: error.message });
          return;
        }
        console.error('candidate review failed', error);
        res.status(500).json({ error: sanitizedError(error) });
      }
    },
  );
}
