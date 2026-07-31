import crypto from 'node:crypto';
import { z } from 'zod';

export const awardedSideSchema = z.enum(['left', 'right', 'both', 'neither', 'unknown']);
export const stageAResultSchema = z.object({
  candidate_phrase_end: z.boolean(),
  local_timestamp_seconds: z.number().finite().nonnegative(),
  confidence: z.number().min(0).max(1),
  observable_cues: z.array(z.string().min(1).max(500)).max(12),
});
export const stageBResultSchema = z.object({
  point_awarded: z.boolean(),
  local_timestamp_seconds: z.number().finite().nonnegative(),
  awarded_side: awardedSideSchema,
  confidence: z.number().min(0).max(1),
  observable_cues: z.array(z.string().min(1).max(500)).max(12),
});

export type StageAResult = z.infer<typeof stageAResultSchema>;
export type StageBResult = z.infer<typeof stageBResultSchema>;

export interface ChunkWindow {
  index: number;
  start: number;
  end: number;
  overlap: number;
}

export function createChunkWindows(
  duration: number,
  windowSeconds = 12,
  strideSeconds = 10,
): ChunkWindow[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  if (windowSeconds <= 0 || strideSeconds <= 0 || strideSeconds > windowSeconds) {
    throw new Error('Invalid chunk window configuration');
  }
  const windows: ChunkWindow[] = [];
  for (let start = 0, index = 0; start < duration; start += strideSeconds, index += 1) {
    const end = Math.min(duration, start + windowSeconds);
    windows.push({
      index,
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      overlap: index === 0 ? 0 : Number(Math.max(0, windows[index - 1].end - start).toFixed(3)),
    });
    if (end === duration) break;
  }
  return windows;
}

export function sourceTimestamp(window: ChunkWindow, localSeconds: number) {
  return Number(Math.min(window.end, Math.max(window.start, window.start + localSeconds)).toFixed(3));
}

export const detectionSchema = z
  .object({
    timestamp: z.number().finite().nonnegative(),
    eventStart: z.number().finite().nonnegative(),
    eventEnd: z.number().finite().nonnegative(),
    confidence: z.number().min(0).max(1),
    pointAwarded: z.boolean().optional(),
    awardedSide: awardedSideSchema.optional(),
    evidence: z.array(z.string()),
    rawResponses: z.array(z.unknown()),
    clipId: z.string().uuid(),
    model: z.string().min(1),
    provider: z.string(),
    promptVersion: z.string().min(1),
  })
  .refine(
    (detection) =>
      detection.eventEnd >= detection.eventStart &&
      detection.timestamp >= detection.eventStart &&
      detection.timestamp <= detection.eventEnd,
    { message: 'Detection timestamp must fall inside its event window' },
  );

export type Detection = z.infer<typeof detectionSchema>;

export const clipInferenceResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('negative'),
    stageA: stageAResultSchema,
    rawResponses: z.array(z.unknown()),
    model: z.string().min(1),
    provider: z.string(),
    promptVersion: z.string().min(1),
  }),
  z.object({
    kind: z.literal('detection'),
    detection: detectionSchema,
  }),
]);

export type ClipInferenceResult = z.infer<typeof clipInferenceResultSchema>;

export interface FinalizationClip {
  id: string;
  index: number;
  status: string;
  resultJson?: string;
  usageJson?: string;
  costUsd?: number;
}

export interface FinalizationInput {
  detections: Detection[];
  usages: unknown[];
  costUsd: number;
}

export function inferenceProgress(clips: Pick<FinalizationClip, 'status'>[]) {
  if (clips.length === 0) return 0.4;
  const completed = clips.filter((clip) => clip.status === 'completed').length;
  return Number((0.4 + (0.5 * completed) / clips.length).toFixed(6));
}

export function finalizationInput(clips: FinalizationClip[]): FinalizationInput | null {
  const ordered = [...clips].sort((left, right) => left.index - right.index);
  if (ordered.length === 0 || ordered.some((clip) => clip.status !== 'completed')) return null;

  const detections: Detection[] = [];
  const usages: unknown[] = [];
  let costUsd = 0;
  for (const clip of ordered) {
    if (!clip.resultJson) throw new Error(`Completed analysis clip ${clip.id} has no result`);
    const result = clipInferenceResultSchema.parse(JSON.parse(clip.resultJson));
    if (result.kind === 'detection') detections.push(result.detection);
    if (clip.usageJson) {
      const usage = JSON.parse(clip.usageJson);
      if (!Array.isArray(usage)) throw new Error(`Analysis clip ${clip.id} usage is not an array`);
      usages.push(...usage);
    }
    const clipCost = clip.costUsd ?? 0;
    if (!Number.isFinite(clipCost) || clipCost < 0) {
      throw new Error(`Analysis clip ${clip.id} has invalid cost`);
    }
    costUsd += clipCost;
  }
  return { detections, usages, costUsd: Number(costUsd.toFixed(8)) };
}

export function consolidateDetections(detections: Detection[], toleranceSeconds = 1.5): Detection[] {
  const sorted = [...detections].sort((left, right) => left.timestamp - right.timestamp);
  const clusters: Detection[][] = [];
  for (const detection of sorted) {
    const current = clusters.at(-1);
    if (!current || detection.timestamp - current.at(-1)!.timestamp > toleranceSeconds) {
      clusters.push([detection]);
    } else {
      current.push(detection);
    }
  }
  return clusters.map((cluster) => {
    const strongest = cluster.reduce((best, item) =>
      item.confidence > best.confidence ? item : best,
    );
    const totalWeight = cluster.reduce((sum, item) => sum + Math.max(item.confidence, 0.01), 0);
    const timestamp =
      cluster.reduce(
        (sum, item) => sum + item.timestamp * Math.max(item.confidence, 0.01),
        0,
      ) / totalWeight;
    return {
      ...strongest,
      timestamp: Number(timestamp.toFixed(3)),
      eventStart: Math.min(...cluster.map((item) => item.eventStart)),
      eventEnd: Math.max(...cluster.map((item) => item.eventEnd)),
      confidence: Math.max(...cluster.map((item) => item.confidence)),
      evidence: [...new Set(cluster.flatMap((item) => item.evidence))],
      rawResponses: cluster.flatMap((item) => item.rawResponses),
    };
  });
}

export function stableHash(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function deterministicUuid(value: unknown) {
  const hex = stableHash(value).slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex
    .slice(12, 16)
    .join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

export function candidateSegmentId(candidateId: string) {
  return deterministicUuid(`analysis-candidate-segment:${candidateId}`);
}

export function planCandidateRejectionSegment(
  candidateId: string,
  linkedSegment?: { id: string } | null,
) {
  const generatedSegmentId = candidateSegmentId(candidateId);
  if (linkedSegment?.id !== generatedSegmentId) return null;
  return {
    unlinkSegmentId: generatedSegmentId,
    deleteSegmentId: generatedSegmentId,
  };
}

export const PIPELINE_VERSION = 'fencing-two-stage-v1';
export const DEFAULT_PROMPT_VERSION = 'phrase-end-award-v1';
export const pipelineConfig = {
  pipelineVersion: PIPELINE_VERSION,
  windowSeconds: Number(process.env.ANALYSIS_WINDOW_SECONDS ?? 12),
  strideSeconds: Number(process.env.ANALYSIS_STRIDE_SECONDS ?? 10),
  model: process.env.OPENROUTER_MODEL ?? 'google/gemini-3.1-flash-lite',
  provider: process.env.OPENROUTER_PROVIDER ?? '',
  promptVersion: process.env.ANALYSIS_PROMPT_VERSION ?? DEFAULT_PROMPT_VERSION,
};
