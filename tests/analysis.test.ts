import assert from 'node:assert/strict';
import test from 'node:test';
import {
  candidateSegmentId,
  clipInferenceResultSchema,
  consolidateDetections,
  createChunkWindows,
  finalizationInput,
  inferenceProgress,
  sourceTimestamp,
  stageAResultSchema,
  stageBResultSchema,
  type Detection,
} from '../server/analysis/domain.ts';
import {
  queueJobId,
  vlmClipQueueJobId,
  vlmFinalizeQueueJobId,
} from '../server/analysis/queue.ts';
import { frameSamplingPlan } from '../server/analysis/openrouter.ts';
import { ingestionDedupKey, ingestionPolicy } from '../server/ingestion/adapters.ts';

test('12 second windows use a deterministic 10 second stride', () => {
  assert.deepEqual(createChunkWindows(31), [
    { index: 0, start: 0, end: 12, overlap: 0 },
    { index: 1, start: 10, end: 22, overlap: 2 },
    { index: 2, start: 20, end: 31, overlap: 2 },
  ]);
  assert.deepEqual(createChunkWindows(5), [{ index: 0, start: 0, end: 5, overlap: 0 }]);
  assert.equal(sourceTimestamp({ index: 1, start: 10, end: 22, overlap: 2 }, 3.25), 13.25);
});

test('OpenRouter frame fallback bounds sampling cost and preserves timing', () => {
  assert.deepEqual(frameSamplingPlan(12, 8), {
    durationSeconds: 12,
    maxFrames: 8,
    fps: 0.666667,
    intervalSeconds: 1.5,
  });
  assert.deepEqual(frameSamplingPlan(2, 8), {
    durationSeconds: 2,
    maxFrames: 8,
    fps: 2,
    intervalSeconds: 0.5,
  });
  assert.equal(frameSamplingPlan(120, 100).maxFrames, 16);
});

test('overlap consolidation keeps the strongest audit metadata', () => {
  const base: Detection = {
    timestamp: 11.8,
    eventStart: 11,
    eventEnd: 12,
    confidence: 0.7,
    pointAwarded: true,
    awardedSide: 'left',
    evidence: ['light'],
    rawResponses: [{ first: true }],
    clipId: 'clip-a',
    model: 'model-a',
    provider: 'provider-a',
    promptVersion: 'v1',
  };
  const consolidated = consolidateDetections([
    base,
    {
      ...base,
      timestamp: 12.1,
      confidence: 0.9,
      evidence: ['scoreboard'],
      rawResponses: [{ second: true }],
      clipId: 'clip-b',
    },
    { ...base, timestamp: 20, clipId: 'clip-c' },
  ]);
  assert.equal(consolidated.length, 2);
  assert.equal(consolidated[0].clipId, 'clip-b');
  assert.deepEqual(consolidated[0].evidence, ['light', 'scoreboard']);
  assert.equal(consolidated[0].rawResponses.length, 2);
});

test('model schemas reject unbounded or ambiguous output', () => {
  assert.equal(
    stageAResultSchema.safeParse({
      candidate_phrase_end: true,
      local_timestamp_seconds: 2.1,
      confidence: 0.8,
      observable_cues: ['halt'],
    }).success,
    true,
  );
  assert.equal(
    stageBResultSchema.safeParse({
      point_awarded: true,
      local_timestamp_seconds: 2.2,
      awarded_side: 'fencer-a',
      confidence: 1.2,
      observable_cues: [],
    }).success,
    false,
  );
});

test('queue and ingestion idempotency keys are stable', () => {
  const jobId = '9610f748-5748-4698-ae55-2b70d16a9788';
  assert.equal(queueJobId('media', jobId), queueJobId('media', jobId));
  assert.notEqual(queueJobId('media', jobId), queueJobId('vlm', jobId));
  assert.equal(
    ingestionDedupKey('youtube', ' ABC '),
    ingestionDedupKey('youtube', 'abc'),
  );
  assert.equal(ingestionPolicy('upload').enabled, true);
  assert.equal(ingestionPolicy('youtube').enabled, false);
});

test('each clip and analysis run receives a stable distinct queue id', () => {
  const jobId = '9610f748-5748-4698-ae55-2b70d16a9788';
  const runId = 'ad233d2a-a881-47d7-b188-a1cbff83816d';
  const nextRunId = '6bf843d0-d459-4101-8869-d7e739a80583';
  const clipA = '759f2a73-ea03-4855-96ef-374bc4a61077';
  const clipB = '40fc3d9e-a2f2-4fc9-b0e7-a9954880f8b0';

  assert.equal(
    vlmClipQueueJobId(jobId, runId, clipA),
    vlmClipQueueJobId(jobId, runId, clipA),
  );
  assert.notEqual(
    vlmClipQueueJobId(jobId, runId, clipA),
    vlmClipQueueJobId(jobId, runId, clipB),
  );
  assert.notEqual(
    vlmClipQueueJobId(jobId, runId, clipA),
    vlmClipQueueJobId(jobId, nextRunId, clipA),
  );
  assert.notEqual(
    vlmClipQueueJobId(jobId, runId, clipA),
    vlmFinalizeQueueJobId(jobId, runId),
  );
  assert.equal(candidateSegmentId(clipA), candidateSegmentId(clipA));
  assert.notEqual(candidateSegmentId(clipA), candidateSegmentId(clipB));
});

test('parent inference progress counts only successful clips', () => {
  assert.equal(inferenceProgress([{ status: 'ready' }, { status: 'processing' }]), 0.4);
  assert.equal(inferenceProgress([{ status: 'completed' }, { status: 'retrying' }]), 0.65);
  assert.equal(inferenceProgress([{ status: 'completed' }, { status: 'completed' }]), 0.9);
  assert.equal(inferenceProgress([{ status: 'failed' }, { status: 'completed' }]), 0.65);
});

test('finalization uses validated successful clip results in clip order', () => {
  const clipA = '759f2a73-ea03-4855-96ef-374bc4a61077';
  const clipB = '40fc3d9e-a2f2-4fc9-b0e7-a9954880f8b0';
  const negative = clipInferenceResultSchema.parse({
    kind: 'negative',
    stageA: {
      candidate_phrase_end: false,
      local_timestamp_seconds: 1,
      confidence: 0.8,
      observable_cues: ['continuous action'],
    },
    rawResponses: [{ stage: 'A' }],
    model: 'model-a',
    provider: 'provider-a',
    promptVersion: 'v1',
  });
  const detection = clipInferenceResultSchema.parse({
    kind: 'detection',
    detection: {
      timestamp: 12,
      eventStart: 11,
      eventEnd: 13,
      confidence: 0.9,
      pointAwarded: true,
      awardedSide: 'left',
      evidence: ['halt'],
      rawResponses: [{ stage: 'A' }, { stage: 'B' }],
      clipId: clipB,
      model: 'model-b',
      provider: 'provider-b',
      promptVersion: 'v1',
    },
  });
  const clips = [
    {
      id: clipB,
      index: 1,
      status: 'completed',
      resultJson: JSON.stringify(detection),
      usageJson: JSON.stringify([{ stage: 'B' }]),
      costUsd: 0.2,
    },
    {
      id: clipA,
      index: 0,
      status: 'completed',
      resultJson: JSON.stringify(negative),
      usageJson: JSON.stringify([{ stage: 'A' }]),
      costUsd: 0.1,
    },
  ];

  const input = finalizationInput(clips);
  assert(input);
  assert.deepEqual(input.usages, [{ stage: 'A' }, { stage: 'B' }]);
  assert.equal(input.costUsd, 0.3);
  assert.deepEqual(input.detections, [detection.detection]);
  assert.equal(finalizationInput([{ ...clips[0], status: 'retrying' }, clips[1]]), null);
  assert.equal(finalizationInput([{ ...clips[0], status: 'failed' }, clips[1]]), null);
});
