import assert from 'node:assert/strict';
import test from 'node:test';
import { DEMO_IDS } from '../server/demo-data.ts';
import { __testing } from '../server/repository.ts';

test('memory repository preserves no-touch phrases in fencer and team aggregates', async () => {
  const repository = new __testing.MemoryRepository();
  const [fencer, team] = await Promise.all([
    repository.fencerStats(DEMO_IDS.left),
    repository.teamStats(DEMO_IDS.teamLeft),
  ]);

  assert.equal(fencer?.totals.touchesScored, 1);
  assert.equal(fencer?.totals.touchesReceived, 1);
  assert.equal(fencer?.totals.noTouch, 1);
  assert.equal(team?.totals.members, 1);
  assert.equal(team?.totals.uniqueBouts, 1);
  assert.equal(team?.totals.noTouch, 1);
});

test('event edits increment phrase revision and enforce phrase boundaries', async () => {
  const repository = new __testing.MemoryRepository();
  const event = await repository.createEvent(DEMO_IDS.phrase1, {
    timestampMs: 2_000,
    frameNumber: 120,
    kind: 'footwork',
    actor: 'right',
    actionId: null,
    actionLabel: 'Retreat',
    priorityBefore: 'left',
    priorityAfter: 'left',
    evidence: 'Right front foot moves backward before the rear foot follows.',
    ruleRefs: [],
    confidence: 1,
    source: 'human',
  });

  const bout = await repository.getBout(DEMO_IDS.bout);
  assert.equal(bout?.phrases[0]?.revision, 3);
  assert.ok(bout?.phrases[0]?.events.some((item) => item.id === event.id));
  await assert.rejects(
    repository.updateEvent(event.id, { ...event, timestampMs: 9_000 }),
    /within phrase boundaries/,
  );
});

test('pose keyframes upsert by frame, side, and track', async () => {
  const repository = new __testing.MemoryRepository();
  const first = await repository.upsertPose(DEMO_IDS.bout, {
    timestampMs: 2_000,
    frameNumber: 120,
    side: 'right',
    trackId: 'right-1',
    keypoints: [{ name: 'nose', x: 0.7, y: 0.2, visible: true, confidence: 1 }],
    weapon: { guard: null, bladeMid: null, tip: null },
    bbox: [0.6, 0.15, 0.8, 0.85],
    frontFootMeters: 7.1,
    rearFootMeters: 8,
    opponentDistanceMeters: 2.7,
    occluded: false,
    source: 'human',
  });
  const second = await repository.upsertPose(DEMO_IDS.bout, {
    ...first,
    opponentDistanceMeters: 2.5,
    source: 'corrected-model',
  });

  const bout = await repository.getBout(DEMO_IDS.bout);
  assert.equal(first.id, second.id);
  assert.equal(second.opponentDistanceMeters, 2.5);
  assert.equal(bout?.poses.filter((pose) => pose.side === 'right' && pose.frameNumber === 120).length, 1);
});
