import { id, requireAdmin } from '../auth.ts';
import {
  candidateSegmentId,
  deterministicUuid,
  planCandidateRejectionSegment,
  type Detection,
} from './domain.ts';

export interface OwnedVideo {
  id: string;
  title: string;
  s3Key: string;
  duration?: number;
}

export interface AnalysisClipRecord {
  id: string;
  runId?: string;
  index: number;
  sourceStart: number;
  sourceEnd: number;
  overlap: number;
  s3Key: string;
  status: string;
  attempt: number;
  resultJson?: string;
  usageJson?: string;
  costUsd?: number;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface AnalysisJobRecord {
  id: string;
  runId?: string;
  status: string;
  stage: string;
  progress: number;
  attempts: number;
  usageJson?: string;
  costUsd?: number;
  error?: string;
  cancelRequested: boolean;
  startedAt?: number;
  model?: string;
  provider?: string;
  promptVersion?: string;
  video: OwnedVideo;
  clips: AnalysisClipRecord[];
  candidates: Array<{ id: string; runId?: string }>;
}

export async function getOwnedVideo(ownerId: string, videoId: string): Promise<OwnedVideo | null> {
  const data = await requireAdmin().query({
    videos: { $: { where: { id: videoId, 'owner.id': ownerId } } },
  });
  return (data.videos[0] as OwnedVideo | undefined) ?? null;
}

export async function findIdempotentJob(
  ownerId: string,
  videoId: string,
  configHash: string,
  sourceChecksum: string,
) {
  const data = await requireAdmin().query({
    analysisJobs: {
      $: {
        where: {
          'owner.id': ownerId,
          'video.id': videoId,
          configHash,
          sourceChecksum,
        },
      },
    },
  });
  return data.analysisJobs[0] ?? null;
}

export async function createAnalysisJob(input: {
  ownerId: string;
  videoId: string;
  runId: string;
  configHash: string;
  sourceChecksum: string;
  model: string;
  provider: string;
  promptVersion: string;
}) {
  const admin = requireAdmin();
  const jobId = id();
  const now = Date.now();
  await admin.transact(
    admin.tx.analysisJobs[jobId]
      .update({
        status: 'queued',
        stage: 'queued',
        progress: 0,
        runId: input.runId,
        configHash: input.configHash,
        sourceChecksum: input.sourceChecksum,
        attempts: 0,
        model: input.model,
        provider: input.provider || undefined,
        promptVersion: input.promptVersion,
        cancelRequested: false,
        createdAt: now,
        updatedAt: now,
      })
      .link({ owner: input.ownerId, video: input.videoId }),
  );
  return jobId;
}

export async function getOwnedJob(ownerId: string, jobId: string) {
  const data = await requireAdmin().query({
    analysisJobs: {
      $: { where: { id: jobId, 'owner.id': ownerId } },
      video: {},
      clips: {},
      candidates: {},
    },
  });
  const job = data.analysisJobs[0] as unknown as AnalysisJobRecord | undefined;
  if (!job) return null;
  if (!job.runId) return job;
  return {
    ...job,
    clips: job.clips.filter((clip) => clip.runId === job.runId),
    candidates: job.candidates.filter((candidate) => candidate.runId === job.runId),
  };
}

export async function getJobForWorker(jobId: string, ownerId: string) {
  const data = await requireAdmin().query({
    analysisJobs: {
      $: { where: { id: jobId, 'owner.id': ownerId } },
      video: {},
    },
  });
  const job = data.analysisJobs[0] as
    | (Omit<AnalysisJobRecord, 'clips' | 'candidates'> & { video: OwnedVideo })
    | undefined;
  if (!job) throw new Error('Analysis job ownership check failed');
  return job;
}

export async function updateJob(
  jobId: string,
  fields: Partial<{
    runId: string;
    status: string;
    stage: string;
    progress: number;
    attempts: number;
    usageJson: string;
    costUsd: number;
    error: string;
    cancelRequested: boolean;
    startedAt: number;
    completedAt: number;
  }>,
) {
  await requireAdmin().transact(
    requireAdmin().tx.analysisJobs[jobId].update({ ...fields, updatedAt: Date.now() }),
  );
}

export async function listJobClips(jobId: string, ownerId: string, runId?: string) {
  const data = await requireAdmin().query({
    analysisClips: {
      $: {
        where: {
          'job.id': jobId,
          'owner.id': ownerId,
          ...(runId ? { runId } : {}),
        },
      },
    },
  });
  return (data.analysisClips as unknown as AnalysisClipRecord[]).sort(
    (left, right) => left.index - right.index,
  );
}

export async function upsertClip(input: {
  clipId: string;
  ownerId: string;
  videoId: string;
  jobId: string;
  runId: string;
  index: number;
  sourceStart: number;
  sourceEnd: number;
  overlap: number;
  s3Key: string;
  checksum: string;
  metadataJson: string;
}) {
  const admin = requireAdmin();
  const now = Date.now();
  const existing = await admin.query({
    analysisClips: {
      $: {
        where: {
          id: input.clipId,
          'owner.id': input.ownerId,
          'job.id': input.jobId,
        },
      },
    },
  });
  const initialFields =
    existing.analysisClips.length === 0
      ? {
          status: 'ready',
          attempt: 0,
          resultJson: '',
          usageJson: '[]',
          costUsd: 0,
          error: '',
          createdAt: now,
        }
      : {};
  await admin.transact(
    admin.tx.analysisClips[input.clipId]
      .update({
        runId: input.runId,
        index: input.index,
        sourceStart: input.sourceStart,
        sourceEnd: input.sourceEnd,
        normalizedStart: input.sourceStart,
        normalizedEnd: input.sourceEnd,
        overlap: input.overlap,
        s3Key: input.s3Key,
        checksum: input.checksum,
        metadataJson: input.metadataJson,
        ...initialFields,
        updatedAt: now,
      })
      .link({
        owner: input.ownerId,
        video: input.videoId,
        job: input.jobId,
      }),
  );
}

export async function updateClip(
  clipId: string,
  fields: Partial<{
    status: string;
    attempt: number;
    resultJson: string;
    usageJson: string;
    costUsd: number;
    error: string;
    startedAt: number;
    completedAt: number;
  }>,
) {
  await requireAdmin().transact(
    requireAdmin().tx.analysisClips[clipId].update({ ...fields, updatedAt: Date.now() }),
  );
}

export async function markClipsCancelled(clips: AnalysisClipRecord[]) {
  const now = Date.now();
  const transactions = clips
    .filter((clip) => !['completed', 'failed'].includes(clip.status))
    .map((clip) =>
      requireAdmin().tx.analysisClips[clip.id].update({
        status: 'cancelled',
        error: '',
        completedAt: now,
        updatedAt: now,
      }),
    );
  if (transactions.length) await requireAdmin().transact(transactions);
}

export async function replaceCandidates(input: {
  ownerId: string;
  videoId: string;
  jobId: string;
  runId: string;
  detections: Detection[];
}) {
  const admin = requireAdmin();
  const existing = await admin.query({
    analysisCandidates: {
      $: {
        where: {
          'job.id': input.jobId,
          'owner.id': input.ownerId,
          runId: input.runId,
        },
      },
    },
  });
  const candidateIds = new Set(
    input.detections.map((detection) =>
      deterministicUuid(
        `${input.jobId}:${input.runId}:candidate:${detection.timestamp.toFixed(3)}`,
      ),
    ),
  );
  const existingIds = new Set(existing.analysisCandidates.map((candidate) => candidate.id));
  const transactions = existing.analysisCandidates
    .filter((candidate) => !candidateIds.has(candidate.id))
    .map((candidate) => admin.tx.analysisCandidates[candidate.id].delete());
  const now = Date.now();
  for (const detection of input.detections) {
    const candidateId = deterministicUuid(
      `${input.jobId}:${input.runId}:candidate:${detection.timestamp.toFixed(3)}`,
    );
    if (existingIds.has(candidateId)) continue;
    transactions.push(
      admin.tx.analysisCandidates[candidateId]
        .update({
          runId: input.runId,
          eventStart: detection.eventStart,
          eventEnd: detection.eventEnd,
          eventTimestamp: detection.timestamp,
          candidatePhraseEnd: true,
          pointAwarded: detection.pointAwarded,
          awardedSide: detection.awardedSide,
          confidence: detection.confidence,
          evidenceJson: JSON.stringify(detection.evidence),
          rawResponseJson: JSON.stringify(detection.rawResponses),
          model: detection.model,
          provider: detection.provider,
          promptVersion: detection.promptVersion,
          reviewState: 'unreviewed',
          dedupKey: `${input.jobId}:${input.runId}:${detection.timestamp.toFixed(3)}`,
          createdAt: now,
          updatedAt: now,
        })
        .link({
          owner: input.ownerId,
          video: input.videoId,
          job: input.jobId,
          clip: detection.clipId,
        }),
    );
  }
  if (transactions.length) await admin.transact(transactions);
}

export const reviewResults = [
  'scored',
  'received',
  'double',
  'simultaneous',
  'no-touch',
] as const;

export type ReviewResult = (typeof reviewResults)[number];
export type CandidateReviewAction = 'accept' | 'correct' | 'reject';

export class CandidateReviewValidationError extends Error {}

interface OwnedCandidate {
  id: string;
  eventStart: number;
  eventEnd: number;
  eventTimestamp: number;
  pointAwarded?: boolean;
  awardedSide?: string;
  confidence: number;
  reviewState: string;
  reviewedAt?: number;
  updatedAt: number;
  video: { id: string; duration?: number };
  job: { id: string };
  segment?: {
    id: string;
    startTime: number;
    endTime: number;
    result: string;
    notes?: string;
    createdAt: number;
  };
}

export async function getOwnedCandidate(ownerId: string, candidateId: string) {
  const data = await requireAdmin().query({
    analysisCandidates: {
      $: { where: { id: candidateId, 'owner.id': ownerId } },
      video: {},
      job: {},
      segment: {},
    },
  });
  return (data.analysisCandidates[0] as unknown as OwnedCandidate | undefined) ?? null;
}

export async function reviewCandidate(input: {
  ownerId: string;
  candidateId: string;
  action: CandidateReviewAction;
  startTime?: number;
  endTime?: number;
  timestamp?: number;
  result?: ReviewResult;
  notes?: string;
  comment?: string;
}) {
  const candidate = await getOwnedCandidate(input.ownerId, input.candidateId);
  if (!candidate) return null;

  const admin = requireAdmin();
  const now = Date.now();
  const segmentId = candidateSegmentId(candidate.id);
  const before = {
    candidate: {
      eventStart: candidate.eventStart,
      eventEnd: candidate.eventEnd,
      eventTimestamp: candidate.eventTimestamp,
      pointAwarded: candidate.pointAwarded,
      awardedSide: candidate.awardedSide,
      confidence: candidate.confidence,
      reviewState: candidate.reviewState,
      reviewedAt: candidate.reviewedAt,
      updatedAt: candidate.updatedAt,
    },
    segment: candidate.segment
      ? {
          id: candidate.segment.id,
          startTime: candidate.segment.startTime,
          endTime: candidate.segment.endTime,
          result: candidate.segment.result,
          notes: candidate.segment.notes,
        }
      : null,
  };

  const transactions = [];
  let after: unknown;
  if (input.action === 'reject') {
    const segmentPlan = planCandidateRejectionSegment(candidate.id, candidate.segment);
    after = {
      candidate: {
        ...before.candidate,
        reviewState: 'rejected',
        reviewedAt: now,
        reviewNotes: input.notes,
      },
      segment: segmentPlan ? null : before.segment,
    };
    const candidateTransaction = admin.tx.analysisCandidates[candidate.id].update({
      reviewState: 'rejected',
      reviewedAt: now,
      updatedAt: now,
    });
    transactions.push(
      segmentPlan
        ? candidateTransaction.unlink({ segment: segmentPlan.unlinkSegmentId })
        : candidateTransaction,
    );
    if (segmentPlan) {
      transactions.push(admin.tx.segments[segmentPlan.deleteSegmentId].delete());
    }
  } else {
    if (!input.result) {
      throw new CandidateReviewValidationError('Accepted candidates require a result');
    }
    const startTime = input.startTime ?? candidate.eventStart;
    const endTime = input.endTime ?? candidate.eventEnd;
    const timestamp = input.timestamp ?? candidate.eventTimestamp;
    if (endTime <= startTime || timestamp < startTime || timestamp > endTime) {
      throw new CandidateReviewValidationError('Candidate review timestamps are invalid');
    }
    if (
      candidate.video.duration !== undefined &&
      (startTime > candidate.video.duration || endTime > candidate.video.duration)
    ) {
      throw new CandidateReviewValidationError(
        'Candidate review timestamps exceed the video duration',
      );
    }
    const reviewState = input.action === 'accept' ? 'accepted' : 'corrected';
    const segment = {
      id: segmentId,
      startTime,
      endTime,
      result: input.result,
      notes: input.notes,
    };
    after = {
      candidate: {
        ...before.candidate,
        eventStart: startTime,
        eventEnd: endTime,
        eventTimestamp: timestamp,
        reviewState,
        reviewedAt: now,
      },
      segment,
    };
    transactions.push(
      admin.tx.segments[segmentId]
        .update({
          startTime,
          endTime,
          result: input.result,
          notes: input.notes,
          createdAt: candidate.segment?.createdAt ?? now,
        })
        .link({ video: candidate.video.id }),
      admin.tx.analysisCandidates[candidate.id]
        .update({
          eventStart: startTime,
          eventEnd: endTime,
          eventTimestamp: timestamp,
          reviewState,
          reviewedAt: now,
          updatedAt: now,
        })
        .link({ segment: segmentId }),
    );
  }

  const feedbackId = id();
  transactions.push(
    admin.tx.analysisFeedback[feedbackId]
      .update({
        action: input.action,
        reason: input.action === 'reject' ? input.notes : undefined,
        comment: input.comment,
        beforeJson: JSON.stringify(before),
        afterJson: JSON.stringify(after),
        createdAt: now,
      })
      .link({
        owner: input.ownerId,
        reviewer: input.ownerId,
        video: candidate.video.id,
        job: candidate.job.id,
        candidate: candidate.id,
      }),
  );
  await admin.transact(transactions);
  return {
    candidateId: candidate.id,
    segmentId: input.action === 'reject' ? null : segmentId,
    feedbackId,
    reviewState:
      input.action === 'accept' ? 'accepted' : input.action === 'correct' ? 'corrected' : 'rejected',
  };
}

export function sanitizedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(bearer|token|key|secret|authorization)=[^\s&]+/gi, '$1=[redacted]').slice(0, 1_000);
}
